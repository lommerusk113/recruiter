import { UserListResponse } from './types';

type Listener = (data: UserListResponse) => void;

const listeners: Listener[] = [];

export function onUserList(fn: Listener): void {
    listeners.push(fn);
}

/** Patches XMLHttpRequest so we see the UserListAjax responses the page fetches itself. Must run at document-start. */
export function installInterceptor(): void {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
        (this as any).__recruiterUrl = String(args[1] ?? '');
        return (origOpen as any).apply(this, args);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const url: string = (this as any).__recruiterUrl ?? '';
        if (url.includes('page.php') && typeof body === 'string' && body.includes('sid=UserListAjax')) {
            this.addEventListener('load', () => {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data?.list) {
                        listeners.forEach(fn => fn(data));
                    }
                } catch {
                    // not JSON, ignore
                }
            });
        }
        return origSend.call(this, body);
    };
}
