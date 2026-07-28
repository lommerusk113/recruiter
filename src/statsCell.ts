import { getApiKey } from './apiKey';
import { getUserStats } from './tornApi';

// Sequential queue so cells fill top-down one user at a time; actual pacing and
// retries live in tornApi's rate limiter.
const queue: Array<() => Promise<void>> = [];
let running = false;

function enqueue(job: () => Promise<void>): void {
    queue.push(job);
    if (!running) {
        void run();
    }
}

async function run(): Promise<void> {
    running = true;
    while (queue.length) {
        await queue.shift()!();
        await new Promise(r => setTimeout(r, 100));
    }
    running = false;
}

/** Inserts a "hours | xan/day | streak" cell right after the target element and fills it from the API. */
export function attachStats(target: HTMLElement, userId: number): void {
    const span = document.createElement('span');
    span.className = 'recruiter-stats';

    const key = getApiKey();
    span.textContent = key ? '…' : 'no API key';
    target.insertAdjacentElement('afterend', span);
    if (!key) {
        return;
    }

    enqueue(async () => {
        try {
            const s = await getUserStats(userId, key);
            span.textContent = `${s.hoursPlayed}h · ${s.xanaxPerDay.toFixed(1)} xan/d · ${s.streak}d`;
            span.title = 'hours played · xanax per day (last 30d / streak) · activity streak';
        } catch (e) {
            span.textContent = String(e);
        }
    });
}
