import { attachStats } from './statsCell';
import { ensurePlainNames } from './names';

const seen = new Set<HTMLElement>();

function scan(): void {
    if (document.documentElement.classList.contains('recruiter-plain-names')) {
        ensurePlainNames();
    }

    document.querySelectorAll<HTMLAnchorElement>('a[href*="profiles.php?XID="]').forEach(anchor => {
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
export function watchProfileLinks(): void {
    let pending: number | undefined;
    new MutationObserver(() => {
        clearTimeout(pending);
        pending = setTimeout(scan, 400);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
}
