import { installInterceptor, onUserList } from './intercept';
import { handleUserList } from './userlist';
import { mountPanel } from './panel';
import { showProfileStats } from './profile';
import { watchProfileLinks } from './decorate';

const params = new URLSearchParams(location.search);
const isProfile = location.pathname === '/profiles.php';
const isSearch = location.pathname === '/userlist.php'
    || (location.pathname === '/page.php' && params.get('sid') === 'UserList');

// active only on profiles and the (advanced) search page — inert everywhere else
if (isProfile || isSearch) {
    if (isSearch) {
        installInterceptor();
        onUserList(handleUserList);
    }

    const start = () => {
        mountPanel();

        const xid = params.get('XID');
        if (isProfile && xid) {
            void showProfileStats(Number(xid));
        }
        if (isSearch) {
            watchProfileLinks();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}
