import { UserListEntry, UserListResponse } from './types';
import { setStatus } from './panel';

function isRecruitable(u: UserListEntry): boolean {
    const icons = u.userTags + u.IconsList;
    return /Donator|Subscriber/i.test(icons) && !/Fedded|Federal|Fallen/i.test(icons);
}

function findRow(userId: number): HTMLElement | null {
    const anchor = document.querySelector(`a[href$="profiles.php?XID=${userId}"]`);
    return anchor?.closest<HTMLElement>('li, tr') ?? null;
}

/** Rows render right after the XHR we intercepted, so poll briefly until they exist. */
function waitForRows(list: UserListEntry[], done: () => void, tries = 20): void {
    if (list.some(u => findRow(u.userID)) || tries <= 0) {
        done();
        return;
    }
    setTimeout(() => waitForRows(list, done, tries - 1), 150);
}

/** Hides non-recruitable rows; stats cells are added separately by the decorate scan. */
export function handleUserList(data: UserListResponse): void {
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
