import { UserStats } from './types';

const DAY_SECONDS = 86400;
const STATS = 'xantaken,useractivity,activestreak';

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

    return Object.fromEntries((json.personalstats as StatEntry[]).map(s => [s.name, s.value]));
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

function cacheKey(userId: number): string {
    return `recruiter-stats-${userId}`;
}

export async function getUserStats(userId: number, key: string): Promise<UserStats> {
    const cached = sessionStorage.getItem(cacheKey(userId));
    if (cached) {
        return JSON.parse(cached);
    }

    await syncBudget(key);

    const monthAgo = Math.floor(Date.now() / 1000) - 30 * DAY_SECONDS;
    const now = await fetchStats(userId, key);
    const past = await fetchStats(userId, key, monthAgo);

    const streak = now.activestreak ?? 0;
    const stats: UserStats = {
        hoursPlayed: Math.round((now.useractivity ?? 0) / 3600),
        // ponytail: per spec — (xanax now - xanax a month ago) / current activity streak days
        xanaxPerDay: ((now.xantaken ?? 0) - (past.xantaken ?? 0)) / Math.max(streak, 1),
        streak
    };

    sessionStorage.setItem(cacheKey(userId), JSON.stringify(stats));
    return stats;
}
