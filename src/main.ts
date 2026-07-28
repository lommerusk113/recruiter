import { installInterceptor, onUserList } from './intercept';
import { handleUserList } from './userlist';
import { mountPanel } from './panel';
import { showProfileStats } from './profile';
import { watchFactionMembers } from './faction';

installInterceptor();
onUserList(handleUserList);

function start(): void {
    mountPanel();

    const xid = new URLSearchParams(location.search).get('XID');
    if (location.pathname === '/profiles.php' && xid) {
        void showProfileStats(Number(xid));
    }

    if (location.pathname === '/factions.php') {
        watchFactionMembers();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
