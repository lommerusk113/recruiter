import { installInterceptor, onUserList } from './intercept';
import { handleUserList } from './userlist';
import { mountPanel } from './panel';
import { showProfileStats } from './profile';
import { watchProfileLinks } from './decorate';

installInterceptor();
onUserList(handleUserList);

function start(): void {
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
} else {
    start();
}
