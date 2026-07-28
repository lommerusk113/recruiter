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

/**
 * Inserts a "hours · xan/day · streak" cell and fills it from the API.
 * The cell is a link to the user's profile. On the classic user list it goes on the
 * game's own Level/Status line (.level-icons-wrap) so it reads as native; elsewhere
 * it sits right after the name link.
 */
export function attachStats(target: HTMLElement, userId: number): void {
    const cell = document.createElement('a');
    cell.className = 'recruiter-stats';
    cell.href = `/profiles.php?XID=${userId}`;
    cell.title = 'hours played · xanax per day (last 30d) · activity streak — click for profile';

    const key = getApiKey();
    cell.textContent = key ? '…' : 'no API key';

    const levelWrap = target.closest('li, tr')?.querySelector('.level-icons-wrap');
    if (levelWrap) {
        levelWrap.insertBefore(cell, levelWrap.firstChild);
    } else {
        target.insertAdjacentElement('afterend', cell);
    }
    if (!key) {
        return;
    }

    enqueue(async () => {
        try {
            const s = await getUserStats(userId, key);
            cell.innerHTML = `<span class="bold">${s.hoursPlayed.toLocaleString('en-US')}</span> hrs`
                + ` · <span class="bold">${s.xanaxPerDay.toFixed(1)}</span> xan/d`
                + ` · <span class="bold">${s.streak}</span>d streak`;
        } catch (e) {
            cell.textContent = 'API error';
            cell.title = String(e);
        }
    });
}
