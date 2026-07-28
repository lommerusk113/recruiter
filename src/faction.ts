import { attachStats } from './statsCell';

const seen = new Set<number>();

function scan(): void {
    document.querySelectorAll<HTMLAnchorElement>('a.user.name[href*="XID="]').forEach(anchor => {
        const id = Number(new URL(anchor.href, location.origin).searchParams.get('XID'));
        if (!id || seen.has(id)) {
            return;
        }
        seen.add(id);
        attachStats(anchor, id);
    });
}

/** Faction member lists render via ajax, so watch the DOM and decorate member links as they appear. */
export function watchFactionMembers(): void {
    let pending: number | undefined;
    new MutationObserver(() => {
        clearTimeout(pending);
        pending = setTimeout(scan, 300);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
}
