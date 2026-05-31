// Single source of truth for the user-visible Trellis state.
// Both the phone-side debug panel and the glasses HUD subscribe
// here so we only hit the backend once per poll interval, and so
// the phone view shows exactly what the HUD is seeing.

import { ApiError, fetchState } from "./api";
import { connectStream, type StreamHandle, type StreamStatus } from "./sse";
import { isPaired } from "./storage";
import type { TrellisState } from "./types";

const POLL_MS_IDLE = 15_000;
const POLL_MS_FOCUS = 5_000;

export interface Snapshot {
  state: TrellisState | null;
  paired: boolean;
  lastFetchedAt: Date | null;
  lastError: { status?: number; message: string } | null;
  isPolling: boolean;
  /**
   * Incremented every time a wake-worthy change is detected on the
   * server (new now/next entry, focus session transition). Subscribers
   * compare against the previously-seen value to know whether the
   * update is "user-noticeable" (wake the HUD) vs. just a local tick
   * (silent re-render). Habit progress is excluded — not urgent.
   */
  changeSeq: number;
  /**
   * State of the long-lived SSE connection used for push. Polling
   * continues as a safety net regardless of this value — it's
   * displayed in the phone debug panel for diagnostics.
   */
  streamStatus: StreamStatus;
}

type Listener = (snapshot: Snapshot) => void;

class Store {
  private snapshot: Snapshot = {
    state: null,
    paired: isPaired(),
    lastFetchedAt: null,
    lastError: null,
    isPolling: false,
    changeSeq: 0,
    streamStatus: "disconnected",
  };
  private readonly listeners = new Set<Listener>();
  private pollHandle: number | null = null;
  private tickHandle: number | null = null;
  private pollMs = POLL_MS_IDLE;
  private prevFingerprint: string = "";
  private stream: StreamHandle | null = null;

  start(): void {
    if (this.tickHandle === null) {
      this.tickHandle = setInterval(() => this.tick(), 1000) as unknown as number;
    }
    void this.poll();
    this.schedulePoll();
    this.openStream();
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
    this.openStream();
  }

  /** Call after an unpair so listeners drop back to the "not paired" view. */
  notifyUnpaired(): void {
    this.closeStream();
    this.set({ paired: false, state: null, lastFetchedAt: null, lastError: null });
  }

  // ---- SSE wiring ----

  private openStream(): void {
    this.closeStream();
    if (!isPaired()) return;
    this.stream = connectStream({
      onChange: () => this.notifyPush(),
      onStatus: (streamStatus) => this.set({ streamStatus }),
    });
  }

  private closeStream(): void {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
    this.set({ streamStatus: "disconnected" });
  }

  /** User-triggered refresh (double-press on the HUD, button on the phone). */
  forceRefresh(): Promise<void> {
    return this.poll();
  }

  /**
   * Called by the SSE client on any server-pushed event. Bumps
   * `changeSeq` directly (so HUD subscribers wake even if the state
   * diff hasn't moved — e.g. a "Send test push" from Settings) AND
   * kicks off a refresh so any real change is reflected.
   */
  notifyPush(): void {
    this.set({ changeSeq: this.snapshot.changeSeq + 1 });
    void this.poll();
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
      const fp = wakeFingerprint(state);
      const isFirst = this.prevFingerprint === "";
      const isWake = !isFirst && fp !== this.prevFingerprint;
      this.prevFingerprint = fp;

      this.set({
        state,
        paired: true,
        lastFetchedAt: new Date(),
        lastError: null,
        isPolling: false,
        // First-ever fetch counts as a wake too — gets the HUD onto
        // the home screen instead of leaving "Trellis: not paired".
        changeSeq:
          isWake || isFirst ? this.snapshot.changeSeq + 1 : this.snapshot.changeSeq,
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

/**
 * Stable string capturing only the fields whose change should wake
 * the HUD. Habits are excluded — completing a habit on the web UI
 * shouldn't pop the display up while you're driving.
 */
function wakeFingerprint(state: TrellisState | null): string {
  if (!state) return "null";
  return JSON.stringify({
    now: state.now && { title: state.now.title, ends_at: state.now.ends_at },
    next:
      state.next && { title: state.next.title, starts_at: state.next.starts_at },
    focus:
      state.focus && {
        state: state.focus.state,
        target: state.focus.target,
        ends_at: state.focus.ends_at,
      },
  });
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
