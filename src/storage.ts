// Persistent settings — base URL + bearer token.
//
// Critically: we go through `bridge.setLocalStorage` /
// `bridge.getLocalStorage`, NOT the WebView's native `localStorage`.
// The WebView's storage is wiped every time the user reinstalls the
// plugin via the dev portal, but the bridge storage is owned by the
// Even App itself (scoped to our package_id) and survives reinstalls.
//
// The bridge API is async; rather than make every consumer async too,
// we read once at boot via `load()`, cache in memory, and persist
// writes back to the bridge (best-effort). All reads stay synchronous.

import {
  waitForEvenAppBridge,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

const KEY_BASE_URL = "trellis.base_url";
const KEY_TOKEN = "trellis.token";

const DEFAULT_BASE_URL = "https://electricbrain.benkolera.com";

// Bridge gets up to 2s to come ready before we give up and fall back
// to native localStorage. Dev preview in a desktop browser will hit
// this — we still want the app to work for iteration.
const BRIDGE_TIMEOUT_MS = 2_000;

interface Cache {
  baseUrl: string;
  token: string | null;
}

let cache: Cache | null = null;
let bridge: EvenAppBridge | null = null;

/**
 * Boot-time hydration. Resolves once the persisted state has been
 * loaded (or the bridge timed out and we fell back to localStorage).
 * Returns whether the SDK bridge is available — the HUD path needs
 * that and there's no point starting it if it isn't.
 */
export async function load(): Promise<{ bridgeReady: boolean }> {
  bridge = await waitWithTimeout(waitForEvenAppBridge(), BRIDGE_TIMEOUT_MS);

  if (bridge) {
    const [baseUrl, token] = await Promise.all([
      bridge.getLocalStorage(KEY_BASE_URL),
      bridge.getLocalStorage(KEY_TOKEN),
    ]);
    cache = {
      baseUrl: nonEmpty(baseUrl) ?? DEFAULT_BASE_URL,
      token: nonEmpty(token),
    };
  } else {
    cache = {
      baseUrl: nonEmpty(localStorage.getItem(KEY_BASE_URL)) ?? DEFAULT_BASE_URL,
      token: nonEmpty(localStorage.getItem(KEY_TOKEN)),
    };
  }

  return { bridgeReady: bridge !== null };
}

export function getBaseUrl(): string {
  return cache?.baseUrl ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  const cleaned = url.replace(/\/+$/, "");
  ensureCache().baseUrl = cleaned;
  await persist(KEY_BASE_URL, cleaned);
}

export function getToken(): string | null {
  return cache?.token ?? null;
}

export async function setToken(token: string): Promise<void> {
  ensureCache().token = token;
  await persist(KEY_TOKEN, token);
}

export async function clearToken(): Promise<void> {
  ensureCache().token = null;
  await persist(KEY_TOKEN, "");
}

export function isPaired(): boolean {
  return !!cache?.token;
}

// ---- internals ----

function ensureCache(): Cache {
  if (!cache) cache = { baseUrl: DEFAULT_BASE_URL, token: null };
  return cache;
}

async function persist(key: string, value: string): Promise<void> {
  if (bridge) {
    try {
      await bridge.setLocalStorage(key, value);
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[storage] bridge.setLocalStorage failed, using localStorage", err);
    }
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort; if even localStorage is denied, we keep the
    // in-memory cache for this session and lose it on next launch.
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
