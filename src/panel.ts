import { getApiKey, setApiKey } from './apiKey';
import { getRecentCallCount } from './tornApi';

const PLAIN_NAMES_KEY = 'recruiter-plain-names';

let statusEl: HTMLElement | undefined;

export function mountPanel(): void {
    const style = document.createElement('style');
    style.textContent = `
        #recruiter-panel { position: fixed; bottom: 12px; right: 12px; z-index: 999999; background: #222; color: #ddd;
            border: 1px solid #444; border-radius: 6px; padding: 8px 10px; font: 12px/1.4 Arial, sans-serif; }
        #recruiter-panel input[type=password] { margin-left: 6px; width: 150px; background: #111; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 2px 4px; }
        #recruiter-panel .recruiter-toggle { display: block; margin-top: 4px; cursor: pointer; }
        #recruiter-panel .recruiter-status { margin-top: 4px; color: #9c9; }
        #recruiter-panel .recruiter-usage { margin-top: 4px; color: #99c; cursor: pointer; text-decoration: underline; }
        .recruiter-stats { margin-left: 8px; font: 11px/1.2 Arial, sans-serif; color: #7a7; white-space: nowrap; }
        /* plain names: drop the honor-bar backdrop, show just the text name */
        .recruiter-plain-names .honor-text-wrap img,
        .recruiter-plain-names .honor-text-wrap .honor-text-svg { display: none !important; }
        .recruiter-plain-names .honor-text-wrap { background: none !important; width: auto !important; min-width: 0 !important; height: auto !important; }
        .recruiter-plain-names .honor-text-wrap .honor-text:not(.honor-text-svg) {
            position: static !important; display: inline !important;
            width: auto !important; height: auto !important;
            clip: auto !important; clip-path: none !important;
            overflow: visible !important; text-indent: 0 !important;
            opacity: 1 !important; font-size: 12px;
        }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'recruiter-panel';
    box.innerHTML = '<label>Torn API key<input type="password" placeholder="paste API key"></label>'
        + '<label class="recruiter-toggle"><input type="checkbox"> plain names (no backdrop)</label>'
        + '<div class="recruiter-status"></div>'
        + '<div class="recruiter-usage">check API usage</div>';

    const keyInput = box.querySelector<HTMLInputElement>('input[type=password]')!;
    keyInput.value = getApiKey();
    keyInput.addEventListener('input', () => setApiKey(keyInput.value.trim()));

    const toggle = box.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    toggle.checked = localStorage.getItem(PLAIN_NAMES_KEY) === '1';
    applyPlainNames(toggle.checked);
    toggle.addEventListener('change', () => {
        localStorage.setItem(PLAIN_NAMES_KEY, toggle.checked ? '1' : '0');
        applyPlainNames(toggle.checked);
    });

    const usage = box.querySelector<HTMLElement>('.recruiter-usage')!;
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

    statusEl = box.querySelector<HTMLElement>('.recruiter-status')!;
    document.body.appendChild(box);
}

function applyPlainNames(enabled: boolean): void {
    document.documentElement.classList.toggle('recruiter-plain-names', enabled);
}

export function setStatus(text: string): void {
    if (statusEl) {
        statusEl.textContent = text;
    }
}
