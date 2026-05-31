// Persistent settings — base URL + bearer token.
//
// Two backing stores:
//
//   * **Bridge storage** (`bridge.setLocalStorage`) — owned by the
//     Even App, scoped to our package_id. Survives plugin reinstalls.
//     Async, occasionally slow to come ready.
//
//   * **Native localStorage** — fast and synchronous, but the Even
//     App wipes it on every plugin reinstall. Used as a session-local
//     fallback when the bridge hasn't come ready yet and for dev
//     preview in a desktop browser.
//
// Strategy: read from bridge if it's available within ~2s, otherwise
// fall back to localStorage and keep waiting for the bridge in the
// background. Persists are *dual-written* — localStorage immediately
// for fast read-after-write, and bridge once it's ready. When the
// bridge becomes ready late, we backfill anything currently in cache
// so reinstalls pick it up next launch.

import {
  waitForEvenAppBridge,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

const KEY_BASE_URL = "trellis.base_url";
const KEY_TOKEN = "trellis.token";

const DEFAULT_BASE_URL = "https://electricbrain.benkolera.com";

// Initial-read budget — phone UI sees the right paired state within
// this window or briefly flashes the pair view while we hydrate.
const LOAD_TIMEOUT_MS = 2_000;

// Writes can afford to wait longer — the bridge usually shows up
// within a few seconds even on a cold install.
const PERSIST_TIMEOUT_MS = 8_000;

export type StorageMode = "loading" | "bridge" | "local-only";

interface Cache {
  baseUrl: string;
  token: string | null;
}

let cache: Cache | null = null;
let bridge: EvenAppBridge | null = null;
let mode: StorageMode = "loading";
const modeListeners = new Set<(mode: StorageMode) => void>();

/**
 * One-time boot hydration. Returns when the cache is hot enough for
 * the rest of the app to read. If the bridge takes longer than
 * `LOAD_TIMEOUT_MS`, we fall back to localStorage for the initial
 * read but keep waiting in the background — when the bridge does
 * arrive, we both start using it AND backfill whatever's currently
 * in cache, so a token that was paired in this session against
 * localStorage won't be lost on the next reinstall.
 */
export async function load(): Promise<void> {
  const initial = await waitWithTimeout(waitForEvenAppBridge(), LOAD_TIMEOUT_MS);

  if (initial) {
    bridge = initial;
    setMode("bridge");
    const [baseUrl, token] = await Promise.all([
      initial.getLocalStorage(KEY_BASE_URL),
      initial.getLocalStorage(KEY_TOKEN),
    ]);
    cache = {
      baseUrl:
        nonEmpty(baseUrl) ??
        nonEmpty(localStorage.getItem(KEY_BASE_URL)) ??
        DEFAULT_BASE_URL,
      token: nonEmpty(token) ?? nonEmpty(localStorage.getItem(KEY_TOKEN)),
    };
    return;
  }

  // Bridge hasn't come ready in time — initial cache from localStorage.
  setMode("local-only");
  cache = {
    baseUrl:
      nonEmpty(localStorage.getItem(KEY_BASE_URL)) ?? DEFAULT_BASE_URL,
    token: nonEmpty(localStorage.getItem(KEY_TOKEN)),
  };

  // Keep waiting for the bridge in the background. When it shows up,
  // copy whatever's in cache (including a token paired in this
  // session) into bridge storage so the next launch finds it.
  void waitForEvenAppBridge()
    .then((b) => {
      bridge = b;
      setMode("bridge");
      void backfill();
    })
    .catch(() => {
      // Bridge truly unavailable (dev preview); stay in local-only.
    });
}

async function backfill(): Promise<void> {
  if (!bridge || !cache) return;
  try {
    await Promise.all([
      bridge.setLocalStorage(KEY_BASE_URL, cache.baseUrl),
      bridge.setLocalStorage(KEY_TOKEN, cache.token ?? ""),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[storage] backfill to bridge failed", err);
  }
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

export function getStorageMode(): StorageMode {
  return mode;
}

export function onStorageModeChange(
  listener: (mode: StorageMode) => void,
): () => void {
  modeListeners.add(listener);
  listener(mode);
  return () => modeListeners.delete(listener);
}

// ---- internals ----

function ensureCache(): Cache {
  if (!cache) cache = { baseUrl: DEFAULT_BASE_URL, token: null };
  return cache;
}

function setMode(next: StorageMode): void {
  if (mode === next) return;
  mode = next;
  for (const listener of modeListeners) listener(mode);
}

/**
 * Dual-write: localStorage immediately for fast read-after-write,
 * bridge as soon as it's available (waiting up to PERSIST_TIMEOUT_MS).
 * Writes can land out of order across the two stores; that's fine
 * because reads always prefer bridge if it has a value.
 */
async function persist(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort; the cache still has the value for this session.
  }

  const b = bridge ?? (await waitWithTimeout(waitForEvenAppBridge(), PERSIST_TIMEOUT_MS));
  if (b) {
    if (!bridge) {
      bridge = b;
      setMode("bridge");
    }
    try {
      await b.setLocalStorage(key, value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[storage] bridge.setLocalStorage failed", err);
    }
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
