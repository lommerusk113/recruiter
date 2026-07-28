import { getApiKey, setApiKey } from './apiKey';
import { getRecentCallCount } from './tornApi';
import { ensurePlainNames } from './names';

const PLAIN_NAMES_KEY = 'recruiter-plain-names';

let statusEl: HTMLElement | undefined;

export function mountPanel(): void {
    const style = document.createElement('style');
    style.textContent = `
        #recruiter-fab { cursor: pointer; user-select: none; background: #333; color: #9c9; border: 1px solid #555;
            font: bold 12px/20px Arial, sans-serif; }
        #recruiter-fab.in-header { float: right; margin: 2px 8px 0 0; border-radius: 4px; padding: 0 8px; }
        #recruiter-fab.floating { position: fixed; top: 12px; right: 12px; z-index: 999999; border-radius: 50%;
            width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; }
        #recruiter-panel { display: none; position: fixed; z-index: 999999; background: #222; border: 1px solid #444;
            border-radius: 6px; padding: 8px 10px; font: 12px/1.4 Arial, sans-serif; color: #ddd; }
        #recruiter-panel.open { display: block; }
        #recruiter-panel input[type=password] { margin-left: 6px; width: 150px; background: #111; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 2px 4px; }
        #recruiter-panel .recruiter-toggle { display: block; margin-top: 4px; cursor: pointer; }
        #recruiter-panel .recruiter-status { margin-top: 4px; color: #9c9; }
        #recruiter-panel .recruiter-usage { margin-top: 4px; color: #99c; cursor: pointer; text-decoration: underline; }
        a.recruiter-stats { margin: 0 8px; white-space: nowrap; color: inherit; text-decoration: none;
            font-size: 12px; line-height: 2; vertical-align: middle; display: inline-block; }
        a.recruiter-stats:hover { text-decoration: underline; }
        /* fixed-width column overlay on the user list's right edge; header and rows share widths */
        .users-list-title, .user-info-list-wrap > li { position: relative; }
        .recruiter-cols { position: absolute; right: 0; top: 0; bottom: 0; display: flex; align-items: stretch;
            white-space: nowrap; color: inherit; text-decoration: none; font-size: 12px; margin: 0; line-height: normal; }
        .recruiter-cols > span { width: 66px; display: flex; align-items: center; justify-content: center; text-align: center; }
        a.recruiter-cols:hover { text-decoration: underline; }
        /* BSP overlays its badge on the honor-bar area; shift plain names clear of it */
        .recruiter-plain-names .TDup_ColoredStatsInjectionDiv ~ a .honor-text-wrap[data-recruiter-name] {
            display: inline-block; margin-left: 44px; }
        /* plain names: hide the honor-bar graphic, render the name via ::after; the wrap stays in the layout */
        .recruiter-plain-names .honor-text-wrap[data-recruiter-name] { background: none !important; width: auto !important; min-width: 0 !important; height: auto !important; }
        .recruiter-plain-names .honor-text-wrap[data-recruiter-name] > * { display: none !important; }
        .recruiter-plain-names .honor-text-wrap[data-recruiter-name]::after { content: attr(data-recruiter-name); font-weight: bold; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'recruiter-panel';
    panel.innerHTML = '<label>Torn API key<input type="password" placeholder="paste API key"></label>'
        + '<label class="recruiter-toggle"><input type="checkbox"> plain names (no backdrop)</label>'
        + '<div class="recruiter-status"></div>'
        + '<div class="recruiter-usage">check API usage</div>';

    const fab = document.createElement('div');
    fab.id = 'recruiter-fab';
    fab.textContent = 'TR';
    fab.title = 'Torn Recruiter';
    fab.addEventListener('click', () => {
        if (panel.classList.toggle('open')) {
            const rect = fab.getBoundingClientRect();
            panel.style.top = `${rect.bottom + 8}px`;
            panel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
        }
    });
    placeFab(fab);

    const keyInput = panel.querySelector<HTMLInputElement>('input[type=password]')!;
    keyInput.value = getApiKey();
    keyInput.addEventListener('input', () => setApiKey(keyInput.value.trim()));

    const toggle = panel.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    toggle.checked = localStorage.getItem(PLAIN_NAMES_KEY) === '1';
    applyPlainNames(toggle.checked);
    toggle.addEventListener('change', () => {
        localStorage.setItem(PLAIN_NAMES_KEY, toggle.checked ? '1' : '0');
        applyPlainNames(toggle.checked);
    });

    const usage = panel.querySelector<HTMLElement>('.recruiter-usage')!;
    usage.addEventListener('click', async () => {
        const key = getApiKey();
        if (!key) {
            usage.textContent = 'no API key';
            return;
        }
        usage.textContent = 'checking…';
        try {
            const used = await getRecentCallCount(key);
            usage.textContent = `${used}/100 calls used last minute`;
        } catch (e) {
            usage.textContent = String(e);
        }
    });

    statusEl = panel.querySelector<HTMLElement>('.recruiter-status')!;
    document.body.appendChild(panel);
}

function findVisibleHeader(): HTMLElement | null {
    // legacy pages use .content-title; React pages (factions) keep an #skip-to-content anchor in their header
    const el = document.querySelector<HTMLElement>('.content-title')
        ?? document.getElementById('skip-to-content')?.parentElement
        ?? null;

    return el?.offsetParent ? el : null;
}

/** Prefers the page header; React pages render it late, so retry before falling back to a floating button. */
function placeFab(fab: HTMLElement, tries = 10): void {
    const header = findVisibleHeader();
    if (header) {
        fab.classList.add('in-header');
        fab.classList.remove('floating');
        header.insertBefore(fab, header.firstChild);
    } else if (tries > 0) {
        setTimeout(() => placeFab(fab, tries - 1), 300);
        return;
    } else {
        fab.classList.remove('in-header');
        fab.classList.add('floating');
        document.body.appendChild(fab);
    }

    // React re-renders can drop injected nodes — re-place the button if that happens
    const guard = setInterval(() => {
        if (!fab.isConnected) {
            clearInterval(guard);
            placeFab(fab);
        }
    }, 2000);
}

function applyPlainNames(enabled: boolean): void {
    document.documentElement.classList.toggle('recruiter-plain-names', enabled);
    if (enabled) {
        ensurePlainNames();
    }
}

export function setStatus(text: string): void {
    if (statusEl) {
        statusEl.textContent = text;
    }
}
