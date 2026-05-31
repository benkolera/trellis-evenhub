// Persistent settings — base URL + bearer token. Survives plugin restarts
// via localStorage on the phone-side runtime.

const KEY_BASE_URL = "trellis.base_url";
const KEY_TOKEN = "trellis.token";

const DEFAULT_BASE_URL = "https://trellis.benkolera.com";

export function getBaseUrl(): string {
  return localStorage.getItem(KEY_BASE_URL) || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  localStorage.setItem(KEY_BASE_URL, url.replace(/\/+$/, ""));
}

export function getToken(): string | null {
  return localStorage.getItem(KEY_TOKEN);
}

export function setToken(token: string): void {
  localStorage.setItem(KEY_TOKEN, token);
}

export function clearToken(): void {
  localStorage.removeItem(KEY_TOKEN);
}

export function isPaired(): boolean {
  return getToken() !== null;
}
