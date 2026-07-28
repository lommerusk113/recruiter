const STORAGE_KEY = 'recruiter-api-key';

export function getApiKey(): string {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
}

export function setApiKey(key: string): void {
    sessionStorage.setItem(STORAGE_KEY, key);
}
