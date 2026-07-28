import { getApiKey } from './apiKey';
import { getUserStats } from './tornApi';
import { setStatus } from './panel';

export async function showProfileStats(userId: number): Promise<void> {
    const key = getApiKey();
    if (!key) {
        setStatus('paste an API key to load stats');
        return;
    }

    try {
        const s = await getUserStats(userId, key);
        setStatus(`${s.hoursPerDay.toFixed(1)} hrs/day | ${s.xanaxPerDay.toFixed(2)} xan/day | ${s.streak} d streak`);
    } catch (e) {
        setStatus(String(e));
    }
}
