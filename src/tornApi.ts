import { UserStats } from './types';

const DAY_SECONDS = 86400;
const STATS = 'xantaken,timeplayed,activestreak';

// Torn allows 100 calls/min per key. The budget starts conservative and auto-adjusts:
// every 30s we check /v2/key/log for calls made by OTHER tools sharing this key and
// shrink/grow our share accordingly (95 target leaves a small safety margin).
const WINDOW_MS = 60_000;
const TARGET_CALLS_PER_WINDOW = 95;
const MIN_CALLS_PER_WINDOW = 10;
const BUDGET_SYNC_MS = 30_000;
const MAX_ATTEMPTS = 3;

const callTimes: number[] = [];
let maxCalls = 80;
let lastBudgetSync = 0;

interface StatEntry {
    name: string;
    value: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rateLimit(): Promise<void> {
    for (;;) {
        const now = Date.now();
        while (callTimes.length && now - callTimes[0] > WINDOW_MS) {
            callTimes.shift();
        }
        if (callTimes.length < maxCalls) {
            callTimes.push(now);
            return;
        }
        await sleep(callTimes[0] + WINDOW_MS - now + 50);
    }
}

async function apiCall(url: URL): Promise<any> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await rateLimit();
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!json.error) {
                return json;
            }
            if (json.error.code !== 5) {
                // bad key, wrong id etc. — retrying won't fix it
                throw new Error(`Torn API: ${json.error.error}`);
            }
            lastError = new Error('Torn API: too many requests');
        } catch (e) {
            if (e instanceof Error && e.message.startsWith('Torn API:')) {
                throw e;
            }
            lastError = e;
        }
        await sleep(2000 * attempt);
    }
    throw lastError;
}

async function fetchStats(userId: number, key: string, timestamp?: number): Promise<Record<string, number>> {
    const url = new URL(`https://api.torn.com/v2/user/${userId}/personalstats`);
    url.searchParams.set('stat', STATS);
    url.searchParams.set('key', key);
    if (timestamp) {
        url.searchParams.set('timestamp', String(timestamp));
    }

    const json = await apiCall(url);

    // personalstats is null for e.g. timestamps before the account existed
    return Object.fromEntries(((json.personalstats ?? []) as StatEntry[]).map(s => [s.name, s.value]));
}

/** Adjusts the limiter budget based on what other tools sharing this key are consuming. */
async function syncBudget(key: string): Promise<void> {
    if (Date.now() - lastBudgetSync < BUDGET_SYNC_MS) {
        return;
    }
    lastBudgetSync = Date.now();

    try {
        const totalOnKey = await getRecentCallCount(key);
        const ours = callTimes.filter(t => Date.now() - t < WINDOW_MS).length;
        const others = Math.max(0, totalOnKey - ours);
        maxCalls = Math.max(MIN_CALLS_PER_WINDOW, TARGET_CALLS_PER_WINDOW - others);
    } catch {
        // key/log unavailable — keep the current budget
    }
}

/** Counts this key's API calls in the last minute via /v2/key/log (the call itself included). */
export async function getRecentCallCount(key: string): Promise<number> {
    const url = new URL('https://api.torn.com/v2/key/log');
    url.searchParams.set('key', key);

    const json = await apiCall(url);
    const cutoff = Date.now() / 1000 - 60;
    const entries: Array<{ timestamp: number }> = json.log ?? [];

    return entries.filter(e => e.timestamp > cutoff).length;
}

const CACHE_TTL_MS = 24 * 3600 * 1000;

// version suffix invalidates entries cached under older stat formats
function cacheKey(userId: number): string {
    return `recruiter-stats-v5-${userId}`;
}

function readCache(userId: number): UserStats | null {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) {
        return null;
    }
    try {
        const { at, stats } = JSON.parse(raw);
        if (Date.now() - at < CACHE_TTL_MS) {
            return stats;
        }
    } catch {
        // old/corrupt format falls through to refetch
    }
    localStorage.removeItem(cacheKey(userId));
    return null;
}

export async function getUserStats(userId: number, key: string): Promise<UserStats> {
    const cached = readCache(userId);
    if (cached) {
        return cached;
    }

    await syncBudget(key);

    const now = await fetchStats(userId, key);
    if (now.timeplayed === undefined) {
        console.warn('[recruiter] timeplayed missing from personalstats response', now);
    }

    const streak = now.activestreak ?? 0;
    // window = the current streak, capped at 30 days; the historical snapshot is taken
    // at the start of that window so diff and divisor cover the same period.
    // streak 0 means not currently active — show 0/day.
    const days = Math.min(streak, 30);
    const past = days > 0
        ? await fetchStats(userId, key, Math.floor(Date.now() / 1000) - days * DAY_SECONDS)
        : now;

    const stats: UserStats = {
        hoursPerDay: streak === 0 ? 0 : ((now.timeplayed ?? 0) - (past.timeplayed ?? 0)) / 3600 / days,
        xanaxPerDay: streak === 0 ? 0 : ((now.xantaken ?? 0) - (past.xantaken ?? 0)) / days,
        streak
    };

    localStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), stats }));
    return stats;
}
