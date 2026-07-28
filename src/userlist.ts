import { UserListEntry, UserListResponse } from './types';
import { attachStats } from './statsCell';
import { setStatus } from './panel';

function isRecruitable(u: UserListEntry): boolean {
    const icons = u.userTags + u.IconsList;
    return /Donator|Subscriber/i.test(icons) && !/Fedded|Federal|Fallen/i.test(icons);
}

function findRow(userId: number): HTMLElement | null {
    const anchor = document.querySelector(`a.user.name[href$="XID=${userId}"]`);
    return anchor?.closest<HTMLElement>('li') ?? null;
}

/** Rows render right after the XHR we intercepted, so poll briefly until they exist. */
function waitForRows(list: UserListEntry[], done: () => void, tries = 20): void {
    if (list.some(u => findRow(u.userID)) || tries <= 0) {
        done();
        return;
    }
    setTimeout(() => waitForRows(list, done, tries - 1), 150);
}

export function handleUserList(data: UserListResponse): void {
    const recruitable = data.list.filter(isRecruitable);
    console.log('[recruiter] recruitable:', recruitable.map(u => `${u.playername} [${u.userID}]`));

    waitForRows(data.list, () => {
        for (const u of data.list) {
            const row = findRow(u.userID);
            if (!row) {
                continue;
            }
            if (isRecruitable(u)) {
                attachStats(row.querySelector<HTMLElement>('a.user.name') ?? row, u.userID);
            } else {
                row.style.display = 'none';
            }
        }
        setStatus(`${recruitable.length}/${data.list.length} recruitable on this page`);
    });
}
