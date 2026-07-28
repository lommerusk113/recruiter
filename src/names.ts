/**
 * Plain-names support: Torn draws names as an honor-bar image + per-char svg spans.
 * We stamp the real name onto the wrap as a data attribute; CSS hides the graphic and
 * renders the name via ::after. The wrap element stays in the layout, so other scripts
 * (e.g. BSP) that anchor their badges to it keep their positioning.
 */
export function ensurePlainNames(): void {
    document.querySelectorAll<HTMLElement>('.honor-text-wrap:not([data-recruiter-name])').forEach(wrap => {
        const name = (wrap.querySelector('img')?.alt ?? '').replace(/\s*\[\d+\]$/, '');
        if (name) {
            wrap.dataset.recruiterName = name;
        }
    });
}
