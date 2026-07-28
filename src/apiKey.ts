const STORAGE_KEY = 'recruiter-api-key';

export function getApiKey(): string {
    // sessionStorage fallback migrates keys saved by older versions
    return localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY) ?? '';
}

export function setApiKey(key: string): void {
    localStorage.setItem(STORAGE_KEY, key);
}
