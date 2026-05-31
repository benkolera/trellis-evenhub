// Single source of truth for the user-visible Trellis state.
// Both the phone-side debug panel and the glasses HUD subscribe
// here so we only hit the backend once per poll interval, and so
// the phone view shows exactly what the HUD is seeing.

import { ApiError, fetchState } from "./api";
import { isPaired } from "./storage";
import type { TrellisState } from "./types";

const POLL_MS_IDLE = 30_000;
const POLL_MS_FOCUS = 5_000;

export interface Snapshot {
  state: TrellisState | null;
  paired: boolean;
  lastFetchedAt: Date | null;
  lastError: { status?: number; message: string } | null;
  isPolling: boolean;
}

type Listener = (snapshot: Snapshot) => void;

class Store {
  private snapshot: Snapshot = {
    state: null,
    paired: isPaired(),
    lastFetchedAt: null,
    lastError: null,
    isPolling: false,
  };
  private readonly listeners = new Set<Listener>();
  private pollHandle: number | null = null;
  private tickHandle: number | null = null;
  private pollMs = POLL_MS_IDLE;

  start(): void {
    if (this.tickHandle === null) {
      this.tickHandle = setInterval(() => this.tick(), 1000) as unknown as number;
    }
    void this.poll();
    this.schedulePoll();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Call after a successful pair so we re-read storage and refresh. */
  notifyPaired(): void {
    this.set({ paired: isPaired(), lastError: null });
    void this.poll();
  }

  /** Call after an unpair so listeners drop back to the "not paired" view. */
  notifyUnpaired(): void {
    this.set({ paired: false, state: null, lastFetchedAt: null, lastError: null });
  }

  /** User-triggered refresh (double-press on the HUD, button on the phone). */
  forceRefresh(): Promise<void> {
    return this.poll();
  }

  private tick(): void {
    const s = this.snapshot.state;
    if (!s) return;
    let changed = false;
    if (s.now) {
      s.now.ends_in_s = Math.max(0, s.now.ends_in_s - 1);
      changed = true;
    }
    if (s.next) {
      s.next.starts_in_s = Math.max(0, s.next.starts_in_s - 1);
      changed = true;
    }
    if (s.focus) {
      s.focus.ends_in_s = Math.max(0, s.focus.ends_in_s - 1);
      changed = true;
    }
    if (changed) this.set({ state: { ...s } });
  }

  private async poll(): Promise<void> {
    if (!isPaired()) {
      this.set({ paired: false, state: null });
      return;
    }
    this.set({ isPolling: true });
    try {
      const state = await fetchState();
      this.set({
        state,
        paired: true,
        lastFetchedAt: new Date(),
        lastError: null,
        isPolling: false,
      });
      this.adjustPollCadence();
    } catch (err) {
      const error = toError(err);
      // 401 means our token is gone server-side; drop into unpaired state.
      const paired = !(err instanceof ApiError && err.status === 401);
      this.set({
        paired,
        lastError: error,
        isPolling: false,
        state: paired ? this.snapshot.state : null,
      });
    }
  }

  private schedulePoll(): void {
    if (this.pollHandle !== null) clearTimeout(this.pollHandle);
    this.pollHandle = setTimeout(() => {
      void this.poll().finally(() => this.schedulePoll());
    }, this.pollMs) as unknown as number;
  }

  private adjustPollCadence(): void {
    const target = this.snapshot.state?.focus ? POLL_MS_FOCUS : POLL_MS_IDLE;
    if (target !== this.pollMs) {
      this.pollMs = target;
      this.schedulePoll();
    }
  }

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function toError(err: unknown): { status?: number; message: string } {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    const detail = body?.error ? ` (${body.error})` : "";
    return { status: err.status, message: `HTTP ${err.status}${detail}` };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

export const store = new Store();
