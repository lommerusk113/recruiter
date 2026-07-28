/**
 * Plain-names support: Torn draws names as an honor-bar image + per-char svg spans.
 * We inject a real text span next to each honor wrap; CSS swaps them when the toggle is on.
 */
export function ensurePlainNames(): void {
    document.querySelectorAll<HTMLElement>('.honor-text-wrap').forEach(wrap => {
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
