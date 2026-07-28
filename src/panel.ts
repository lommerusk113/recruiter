import { getApiKey, setApiKey } from './apiKey';
import { getRecentCallCount } from './tornApi';
import { ensurePlainNames } from './names';

const PLAIN_NAMES_KEY = 'recruiter-plain-names';

let statusEl: HTMLElement | undefined;

export function mountPanel(): void {
    const style = document.createElement('style');
    style.textContent = `
        #recruiter-panel { position: fixed; bottom: 12px; right: 12px; z-index: 999999; font: 12px/1.4 Arial, sans-serif; color: #ddd; text-align: right; }
        #recruiter-panel .recruiter-fab { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
            border-radius: 50%; background: #333; border: 1px solid #555; color: #9c9; font-weight: bold; cursor: pointer; user-select: none; }
        #recruiter-panel .recruiter-body { display: none; background: #222; border: 1px solid #444; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; text-align: left; }
        #recruiter-panel.open .recruiter-body { display: block; }
        #recruiter-panel input[type=password] { margin-left: 6px; width: 150px; background: #111; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 2px 4px; }
        #recruiter-panel .recruiter-toggle { display: block; margin-top: 4px; cursor: pointer; }
        #recruiter-panel .recruiter-status { margin-top: 4px; color: #9c9; }
        #recruiter-panel .recruiter-usage { margin-top: 4px; color: #99c; cursor: pointer; text-decoration: underline; }
        .recruiter-stats { margin-left: 6px; padding: 1px 5px; border-radius: 3px; background: rgba(0, 0, 0, 0.55);
            color: #7fd67f; font: 11px/1.5 Arial, sans-serif; white-space: nowrap; vertical-align: middle; display: inline-block; }
        /* plain names: swap the honor-bar graphic for the injected text span */
        .recruiter-name { display: none; font-weight: bold; vertical-align: middle; }
        .recruiter-plain-names .honor-text-wrap { display: none !important; }
        .recruiter-plain-names .recruiter-name { display: inline !important; }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'recruiter-panel';
    box.innerHTML = '<div class="recruiter-body">'
        + '<label>Torn API key<input type="password" placeholder="paste API key"></label>'
        + '<label class="recruiter-toggle"><input type="checkbox"> plain names (no backdrop)</label>'
        + '<div class="recruiter-status"></div>'
        + '<div class="recruiter-usage">check API usage</div>'
        + '</div>'
        + '<div class="recruiter-fab" title="Torn Recruiter">TR</div>';

    box.querySelector<HTMLElement>('.recruiter-fab')!.addEventListener('click', () => box.classList.toggle('open'));

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
    if (enabled) {
        ensurePlainNames();
    }
}

export function setStatus(text: string): void {
    if (statusEl) {
        statusEl.textContent = text;
    }
}
