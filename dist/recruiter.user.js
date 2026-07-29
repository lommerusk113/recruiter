// ==UserScript==
// @name         Torn Recruiter
// @namespace    torn-recruiter
// @version      0.1.15
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
    const STATS = 'xantaken,timeplayed,activestreak';
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
        // personalstats is null for e.g. timestamps before the account existed
        return Object.fromEntries((json.personalstats ?? []).map(s => [s.name, s.value]));
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
    // version suffix invalidates entries cached under older stat formats
    function cacheKey(userId) {
        return `recruiter-stats-v5-${userId}`;
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
        const stats = {
            hoursPerDay: streak === 0 ? 0 : ((now.timeplayed ?? 0) - (past.timeplayed ?? 0)) / 3600 / days,
            xanaxPerDay: streak === 0 ? 0 : ((now.xantaken ?? 0) - (past.xantaken ?? 0)) / days,
            streak
        };
        localStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), stats }));
        return stats;
    }

    /**
     * Plain-names support: Torn draws names as an honor-bar image + per-char svg spans.
     * We stamp the real name onto the wrap as a data attribute; CSS hides the graphic and
     * renders the name via ::after. The wrap element stays in the layout, so other scripts
     * (e.g. BSP) that anchor their badges to it keep their positioning.
     */
    function ensurePlainNames() {
        document.querySelectorAll('.honor-text-wrap:not([data-recruiter-name])').forEach(wrap => {
            const name = (wrap.querySelector('img')?.alt ?? '').replace(/\s*\[\d+\]$/, '');
            if (name) {
                wrap.dataset.recruiterName = name;
            }
        });
    }

    const PLAIN_NAMES_KEY = 'recruiter-plain-names';
    let statusEl;
    function mountPanel() {
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
        a.recruiter-stats.member-cell { display: block; clear: both; font-size: 11px; line-height: 1.5;
            margin: 0; padding: 0 10px 3px; }
        /* fixed-width column overlay on the user list's right edge; header and rows share widths */
        .users-list-title, .user-info-list-wrap > li { position: relative; }
        .recruiter-cols, a.recruiter-stats.recruiter-cols { position: absolute; right: 0; top: 0; bottom: 0;
            display: flex; align-items: stretch; white-space: nowrap; color: inherit; text-decoration: none;
            font-size: 12px; margin: 0; line-height: normal; }
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
        const keyInput = panel.querySelector('input[type=password]');
        keyInput.value = getApiKey();
        keyInput.addEventListener('input', () => setApiKey(keyInput.value.trim()));
        const toggle = panel.querySelector('input[type=checkbox]');
        toggle.checked = localStorage.getItem(PLAIN_NAMES_KEY) === '1';
        applyPlainNames(toggle.checked);
        toggle.addEventListener('change', () => {
            localStorage.setItem(PLAIN_NAMES_KEY, toggle.checked ? '1' : '0');
            applyPlainNames(toggle.checked);
        });
        const usage = panel.querySelector('.recruiter-usage');
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
        statusEl = panel.querySelector('.recruiter-status');
        document.body.appendChild(panel);
    }
    function findVisibleHeader() {
        // legacy pages use .content-title; React pages (factions) keep an #skip-to-content anchor in their header
        const el = document.querySelector('.content-title')
            ?? document.getElementById('skip-to-content')?.parentElement
            ?? null;
        return el?.offsetParent ? el : null;
    }
    /** Prefers the page header; React pages render it late, so retry before falling back to a floating button. */
    function placeFab(fab, tries = 10) {
        const header = findVisibleHeader();
        if (header) {
            fab.classList.add('in-header');
            fab.classList.remove('floating');
            header.insertBefore(fab, header.firstChild);
        }
        else if (tries > 0) {
            setTimeout(() => placeFab(fab, tries - 1), 300);
            return;
        }
        else {
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
            setStatus(`${s.hoursPerDay.toFixed(1)} hrs/day | ${s.xanaxPerDay.toFixed(2)} xan/day | ${s.streak} d streak`);
        }
        catch (e) {
            setStatus(String(e));
        }
    }

    // Small worker pool: cells still fill roughly top-down, but 4 users load concurrently.
    // Rate pacing and retries live in tornApi's limiter, so this only bounds burstiness.
    const CONCURRENCY = 4;
    const queue = [];
    let active = 0;
    function enqueue(job) {
        queue.push(job);
        pump();
    }
    function pump() {
        while (active < CONCURRENCY && queue.length) {
            active++;
            void queue.shift()().finally(() => {
                active--;
                pump();
            });
        }
    }
    /**
     * Inserts a "hours · xan/day · streak" cell and fills it from the API.
     * The cell is a link to the user's profile. On the classic user list it goes on the
     * game's own Level/Status line (.level-icons-wrap) so it reads as native; elsewhere
     * it sits right after the name link.
     */
    function attachStats(target, userId) {
        const cell = document.createElement('a');
        cell.className = 'recruiter-stats';
        cell.href = `/profiles.php?XID=${userId}`;
        cell.title = 'hours per day · xanax per day (both last 30d) · activity streak — click for profile';
        const key = getApiKey();
        cell.textContent = key ? '…' : 'no API key';
        // on the user list the cell overlays the row's right edge as fixed-width columns
        // matching the injected header; elsewhere (faction page) it stays inline after the name
        const row = target.closest('li, tr');
        const isUserList = !!row?.querySelector('.level-icons-wrap');
        const memberCell = target.closest('.table-cell.member');
        if (isUserList && row) {
            cell.classList.add('recruiter-cols');
            row.appendChild(cell);
        }
        else if (memberCell) {
            // faction member table: the name wrapper is a clipping flex box, so the cell
            // goes on its own line at the bottom of the member cell
            cell.classList.add('member-cell');
            memberCell.appendChild(cell);
        }
        else {
            target.insertAdjacentElement('afterend', cell);
        }
        if (!key) {
            return;
        }
        enqueue(async () => {
            try {
                const s = await getUserStats(userId, key);
                if (isUserList) {
                    cell.innerHTML = `<span class="torn-divider divider-vertical">${s.hoursPerDay.toFixed(1)}</span>`
                        + `<span class="torn-divider divider-vertical">${s.xanaxPerDay.toFixed(1)}</span>`
                        + `<span class="torn-divider divider-vertical">${s.streak}d</span>`;
                }
                else {
                    cell.innerHTML = `<span class="bold">${s.hoursPerDay.toFixed(1)}</span> hrs/d`
                        + ` · <span class="bold">${s.xanaxPerDay.toFixed(1)}</span> xan/d`
                        + ` · <span class="bold">${s.streak}</span>d streak`;
                }
            }
            catch (e) {
                cell.textContent = 'API error';
                cell.title = String(e);
            }
        });
    }

    const seen = new Set();
    function ensureHeaderColumns() {
        const header = document.querySelector('.users-list-title');
        if (!header || header.querySelector('.recruiter-cols')) {
            return;
        }
        const cols = document.createElement('div');
        cols.className = 'recruiter-cols';
        cols.innerHTML = '<span class="title-divider divider-spiky">Hrs / day</span>'
            + '<span class="title-divider divider-spiky">Xan / day</span>'
            + '<span class="title-divider divider-spiky">Streak</span>';
        header.appendChild(cols);
    }
    function scan() {
        ensureHeaderColumns();
        if (document.documentElement.classList.contains('recruiter-plain-names')) {
            ensurePlainNames();
        }
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
