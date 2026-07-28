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

    // on the user list the cell overlays the row's right edge as fixed-width columns
    // matching the injected header; elsewhere (faction page) it stays inline after the name
    const row = target.closest<HTMLElement>('li, tr');
    const isUserList = !!row?.querySelector('.level-icons-wrap');
    if (isUserList && row) {
        cell.classList.add('recruiter-cols');
        row.appendChild(cell);
    } else {
        target.insertAdjacentElement('afterend', cell);
    }
    if (!key) {
        return;
    }

    enqueue(async () => {
        try {
            const s = await getUserStats(userId, key);
            if (isUserList) {
                cell.innerHTML = `<span class="torn-divider divider-vertical">${s.hoursPlayed.toLocaleString('en-US')}</span>`
                    + `<span class="torn-divider divider-vertical">${s.xanaxPerDay.toFixed(1)}</span>`
                    + `<span class="torn-divider divider-vertical">${s.streak}d</span>`;
            } else {
                cell.innerHTML = `<span class="bold">${s.hoursPlayed.toLocaleString('en-US')}</span> hrs`
                    + ` · <span class="bold">${s.xanaxPerDay.toFixed(1)}</span> xan/d`
                    + ` · <span class="bold">${s.streak}</span>d streak`;
            }
        } catch (e) {
            cell.textContent = 'API error';
            cell.title = String(e);
        }
    });
}
