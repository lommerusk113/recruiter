// ==UserScript==
// @name         Torn Recruiter
// @namespace    torn-recruiter
// @version      0.1.1
// @description  Filters the Torn user search to recruitable players (donator/subscriber, not fedded/fallen) and shows hours played, xanax/day and activity streak.
// @match        https://www.torn.com/page.php*
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/userlist.php*
// @match        https://www.torn.com/factions.php*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const listeners = [];
    function onUserList(fn) {
        listeners.push(fn);
    }
    /** Patches XMLHttpRequest so we see the UserListAjax responses the page fetches itself. Must run at document-start. */
    function installInterceptor() {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (...args) {
            this.__recruiterUrl = String(args[1] ?? '');
            return origOpen.apply(this, args);
        };
        XMLHttpRequest.prototype.send = function (body) {
            const url = this.__recruiterUrl ?? '';
            if (url.includes('page.php') && typeof body === 'string' && body.includes('sid=UserListAjax')) {
                this.addEventListener('load', () => {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data?.list) {
                            listeners.forEach(fn => fn(data));
                        }
                    }
                    catch {
                        // not JSON, ignore
                    }
                });
            }
            return origSend.call(this, body);
        };
    }

    const STORAGE_KEY = 'recruiter-api-key';
    function getApiKey() {
        // sessionStorage fallback migrates keys saved by older versions
        return localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY) ?? '';
    }
    function setApiKey(key) {
        localStorage.setItem(STORAGE_KEY, key);
    }

    const DAY_SECONDS = 86400;
    const STATS = 'xantaken,useractivity,activestreak';
    // Torn allows 100 calls/min per key. The budget starts conservative and auto-adjusts:
    // every 30s we check /v2/key/log for calls made by OTHER tools sharing this key and
    // shrink/grow our share accordingly (95 target leaves a small safety margin).
    const WINDOW_MS = 60000;
    const TARGET_CALLS_PER_WINDOW = 95;
    const MIN_CALLS_PER_WINDOW = 10;
    const BUDGET_SYNC_MS = 30000;
    const MAX_ATTEMPTS = 3;
    const callTimes = [];
    let maxCalls = 80;
    let lastBudgetSync = 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function rateLimit() {
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
    async function apiCall(url) {
        let lastError;
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
            }
            catch (e) {
                if (e instanceof Error && e.message.startsWith('Torn API:')) {
                    throw e;
                }
                lastError = e;
            }
            await sleep(2000 * attempt);
        }
        throw lastError;
    }
    async function fetchStats(userId, key, timestamp) {
        const url = new URL(`https://api.torn.com/v2/user/${userId}/personalstats`);
        url.searchParams.set('stat', STATS);
        url.searchParams.set('key', key);
        if (timestamp) {
            url.searchParams.set('timestamp', String(timestamp));
        }
        const json = await apiCall(url);
        return Object.fromEntries(json.personalstats.map(s => [s.name, s.value]));
    }
    /** Adjusts the limiter budget based on what other tools sharing this key are consuming. */
    async function syncBudget(key) {
        if (Date.now() - lastBudgetSync < BUDGET_SYNC_MS) {
            return;
        }
        lastBudgetSync = Date.now();
        try {
            const totalOnKey = await getRecentCallCount(key);
            const ours = callTimes.filter(t => Date.now() - t < WINDOW_MS).length;
            const others = Math.max(0, totalOnKey - ours);
            maxCalls = Math.max(MIN_CALLS_PER_WINDOW, TARGET_CALLS_PER_WINDOW - others);
        }
        catch {
            // key/log unavailable — keep the current budget
        }
    }
    /** Counts this key's API calls in the last minute via /v2/key/log (the call itself included). */
    async function getRecentCallCount(key) {
        const url = new URL('https://api.torn.com/v2/key/log');
        url.searchParams.set('key', key);
        const json = await apiCall(url);
        const cutoff = Date.now() / 1000 - 60;
        const entries = json.log ?? [];
        return entries.filter(e => e.timestamp > cutoff).length;
    }
    const CACHE_TTL_MS = 24 * 3600 * 1000;
    function cacheKey(userId) {
        return `recruiter-stats-${userId}`;
    }
    function readCache(userId) {
        const raw = localStorage.getItem(cacheKey(userId));
        if (!raw) {
            return null;
        }
        try {
            const { at, stats } = JSON.parse(raw);
            if (Date.now() - at < CACHE_TTL_MS) {
                return stats;
            }
        }
        catch {
            // old/corrupt format falls through to refetch
        }
        localStorage.removeItem(cacheKey(userId));
        return null;
    }
    async function getUserStats(userId, key) {
        const cached = readCache(userId);
        if (cached) {
            return cached;
        }
        await syncBudget(key);
        const monthAgo = Math.floor(Date.now() / 1000) - 30 * DAY_SECONDS;
        const now = await fetchStats(userId, key);
        const past = await fetchStats(userId, key, monthAgo);
        const streak = now.activestreak ?? 0;
        const stats = {
            hoursPlayed: Math.round((now.useractivity ?? 0) / 3600),
            // xanax diff covers the last 30 days, so cap the divisor at 30 for longer streaks
            xanaxPerDay: ((now.xantaken ?? 0) - (past.xantaken ?? 0)) / Math.min(Math.max(streak, 1), 30),
            streak
        };
        localStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), stats }));
        return stats;
    }

    /**
     * Plain-names support: Torn draws names as an honor-bar image + per-char svg spans.
     * We inject a real text span next to each honor wrap; CSS swaps them when the toggle is on.
     */
    function ensurePlainNames() {
        document.querySelectorAll('.honor-text-wrap').forEach(wrap => {
            if (wrap.dataset.recruiterNamed) {
                return;
            }
            wrap.dataset.recruiterNamed = '1';
            const name = (wrap.querySelector('img')?.alt ?? '').replace(/\s*\[\d+\]$/, '');
            if (!name) {
                return;
            }
            const span = document.createElement('span');
            span.className = 'recruiter-name';
            span.textContent = name;
            wrap.insertAdjacentElement('afterend', span);
        });
    }

    const PLAIN_NAMES_KEY = 'recruiter-plain-names';
    let statusEl;
    function mountPanel() {
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
        box.querySelector('.recruiter-fab').addEventListener('click', () => box.classList.toggle('open'));
        const keyInput = box.querySelector('input[type=password]');
        keyInput.value = getApiKey();
        keyInput.addEventListener('input', () => setApiKey(keyInput.value.trim()));
        const toggle = box.querySelector('input[type=checkbox]');
        toggle.checked = localStorage.getItem(PLAIN_NAMES_KEY) === '1';
        applyPlainNames(toggle.checked);
        toggle.addEventListener('change', () => {
            localStorage.setItem(PLAIN_NAMES_KEY, toggle.checked ? '1' : '0');
            applyPlainNames(toggle.checked);
        });
        const usage = box.querySelector('.recruiter-usage');
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
            }
            catch (e) {
                usage.textContent = String(e);
            }
        });
        statusEl = box.querySelector('.recruiter-status');
        document.body.appendChild(box);
    }
    function applyPlainNames(enabled) {
        document.documentElement.classList.toggle('recruiter-plain-names', enabled);
        if (enabled) {
            ensurePlainNames();
        }
    }
    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    function isRecruitable(u) {
        const icons = u.userTags + u.IconsList;
        return /Donator|Subscriber/i.test(icons) && !/Fedded|Federal|Fallen/i.test(icons);
    }
    function findRow(userId) {
        const anchor = document.querySelector(`a[href$="profiles.php?XID=${userId}"]`);
        return anchor?.closest('li, tr') ?? null;
    }
    /** Rows render right after the XHR we intercepted, so poll briefly until they exist. */
    function waitForRows(list, done, tries = 20) {
        if (list.some(u => findRow(u.userID)) || tries <= 0) {
            done();
            return;
        }
        setTimeout(() => waitForRows(list, done, tries - 1), 150);
    }
    /** Hides non-recruitable rows; stats cells are added separately by the decorate scan. */
    function handleUserList(data) {
        const recruitable = data.list.filter(isRecruitable);
        console.log('[recruiter] recruitable:', recruitable.map(u => `${u.playername} [${u.userID}]`));
        waitForRows(data.list, () => {
            for (const u of data.list) {
                if (!isRecruitable(u)) {
                    const row = findRow(u.userID);
                    if (row) {
                        row.style.display = 'none';
                    }
                }
            }
            setStatus(`${recruitable.length}/${data.list.length} recruitable on this page`);
        });
    }

    async function showProfileStats(userId) {
        const key = getApiKey();
        if (!key) {
            setStatus('paste an API key to load stats');
            return;
        }
        try {
            const s = await getUserStats(userId, key);
            setStatus(`${s.hoursPlayed} h played | ${s.xanaxPerDay.toFixed(2)} xan/day | ${s.streak} d streak`);
        }
        catch (e) {
            setStatus(String(e));
        }
    }

    // Sequential queue so cells fill top-down one user at a time; actual pacing and
    // retries live in tornApi's rate limiter.
    const queue = [];
    let running = false;
    function enqueue(job) {
        queue.push(job);
        if (!running) {
            void run();
        }
    }
    async function run() {
        running = true;
        while (queue.length) {
            await queue.shift()();
            await new Promise(r => setTimeout(r, 100));
        }
        running = false;
    }
    /** Inserts a "hours | xan/day | streak" cell right after the target element and fills it from the API. */
    function attachStats(target, userId) {
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
            }
            catch (e) {
                span.textContent = String(e);
            }
        });
    }

    const seen = new Set();
    function scan() {
        ensurePlainNames();
        document.querySelectorAll('a[href*="profiles.php?XID="]').forEach(anchor => {
            if (seen.has(anchor) || anchor.closest('#recruiter-panel')) {
                return;
            }
            // skip rows the recruitable filter already hid — no point burning API calls on them
            if (!anchor.offsetParent) {
                return;
            }
            // only decorate actual name links, not icon links that happen to point at a profile
            if (!anchor.querySelector('.honor-text-wrap')) {
                return;
            }
            const id = Number(new URL(anchor.href, location.origin).searchParams.get('XID'));
            if (!id) {
                return;
            }
            seen.add(anchor);
            attachStats(anchor, id);
        });
    }
    /** Member/search lists render via ajax, so watch the DOM and decorate profile links as they appear. */
    function watchProfileLinks() {
        let pending;
        new MutationObserver(() => {
            clearTimeout(pending);
            pending = setTimeout(scan, 400);
        }).observe(document.body, { childList: true, subtree: true });
        scan();
    }

    installInterceptor();
    onUserList(handleUserList);
    function start() {
        mountPanel();
        const params = new URLSearchParams(location.search);
        const xid = params.get('XID');
        if (location.pathname === '/profiles.php' && xid) {
            void showProfileStats(Number(xid));
        }
        const isSearchPage = location.pathname === '/userlist.php'
            || (location.pathname === '/page.php' && params.get('sid') === 'UserList');
        if (location.pathname === '/factions.php' || isSearchPage) {
            watchProfileLinks();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    }
    else {
        start();
    }

})();
