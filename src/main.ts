// Trellis Even Hub plugin entry point.
//
// State machine:
//   * No token → Pair screen until a code is redeemed.
//   * Token present → Home (Now/Next) by default; cycle Home ↔ Focus
//     ↔ Habits via swipe up/down. Double-press forces a poll.
//
// Polling:
//   * 30s by default. Drops to 5s while a focus session is active so
//     the countdown reconciles often. Between polls, the local Ticker
//     decrements ends_in_s / starts_in_s every second.

import { ApiError, fetchState, pair as apiPair, unpair as apiUnpair } from "./api";
import { onInput, render, type InputEvent } from "./glasses";
import { renderFocus } from "./screens/focus";
import { renderHabits } from "./screens/habits";
import { renderHome } from "./screens/home";
import { renderPair, type PairScreenState } from "./screens/pair";
import { Ticker } from "./timer";
import type { Screen, TrellisState } from "./types";
import { isPaired } from "./storage";

const POLL_MS_IDLE = 30_000;
const POLL_MS_FOCUS = 5_000;

class App {
  private screen: Screen = isPaired() ? "home" : "pair";
  private trellis: TrellisState | null = null;
  private pollHandle: number | null = null;
  private pollMs = POLL_MS_IDLE;
  private pair: PairScreenState = { step: "intro", code: "" };

  private readonly ticker = new Ticker(() => this.onTick(), 1000);

  start(): void {
    onInput((e) => this.onInput(e));
    this.ticker.start();
    void this.poll();
    this.schedulePoll();
    this.draw();
  }

  // ---- input ----

  private onInput(event: InputEvent): void {
    if (this.screen === "pair") {
      this.handlePairInput(event);
      return;
    }

    switch (event) {
      case "swipe_up":
        this.screen = previousScreen(this.screen);
        break;
      case "swipe_down":
        this.screen = nextScreen(this.screen);
        break;
      case "double_press":
        void this.poll();
        break;
      case "press":
        // Reserved for screen-specific action (e.g. start a break).
        break;
    }
    this.draw();
  }

  private handlePairInput(event: InputEvent): void {
    switch (this.pair.step) {
      case "intro":
        if (event === "press") this.pair = { step: "entering", code: "" };
        break;
      case "entering":
        if (event === "press" && this.pair.code.length === 6) {
          void this.submitPair();
        } else if (event === "swipe_up" || event === "swipe_down") {
          this.pair = { step: "intro", code: "" };
        }
        // TODO: glasses don't have alphanumeric entry — final UX is
        // that the user types the code on the Even companion app's
        // pairing screen, not on the HUD. Keeping `entering` here
        // for completeness; it'll be driven by the phone-side UI.
        break;
      case "error":
        if (event === "press") this.pair = { step: "intro", code: "" };
        break;
      case "verifying":
        break;
    }
    this.draw();
  }

  private async submitPair(): Promise<void> {
    this.pair = { step: "verifying", code: this.pair.code };
    this.draw();
    try {
      await apiPair(this.pair.code, "Even Hub");
      this.screen = "home";
      this.pair = { step: "intro", code: "" };
      await this.poll();
    } catch (err) {
      const msg = err instanceof ApiError ? errorMessage(err) : "Network error";
      this.pair = { step: "error", code: "", error: msg };
    }
    this.draw();
  }

  // ---- polling ----

  private async poll(): Promise<void> {
    if (!isPaired()) {
      this.screen = "pair";
      this.draw();
      return;
    }

    try {
      this.trellis = await fetchState();
      this.adjustPollCadence();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.screen = "pair";
        this.trellis = null;
      }
    }
    this.draw();
  }

  private schedulePoll(): void {
    if (this.pollHandle !== null) clearTimeout(this.pollHandle);
    this.pollHandle = setTimeout(() => {
      void this.poll().finally(() => this.schedulePoll());
    }, this.pollMs) as unknown as number;
  }

  private adjustPollCadence(): void {
    const target = this.trellis?.focus ? POLL_MS_FOCUS : POLL_MS_IDLE;
    if (target !== this.pollMs) {
      this.pollMs = target;
      this.schedulePoll();
    }
  }

  // ---- local ticker (between polls) ----

  private onTick(): void {
    if (!this.trellis) return;
    let changed = false;

    if (this.trellis.now) {
      this.trellis.now.ends_in_s = Math.max(0, this.trellis.now.ends_in_s - 1);
      changed = true;
    }
    if (this.trellis.next) {
      this.trellis.next.starts_in_s = Math.max(
        0,
        this.trellis.next.starts_in_s - 1,
      );
      changed = true;
    }
    if (this.trellis.focus) {
      this.trellis.focus.ends_in_s = Math.max(
        0,
        this.trellis.focus.ends_in_s - 1,
      );
      changed = true;
    }

    if (changed) this.draw();
  }

  // ---- rendering ----

  private draw(): void {
    if (this.screen === "pair" || !this.trellis) {
      render(renderPair(this.pair));
      return;
    }

    switch (this.screen) {
      case "home":
        render(renderHome(this.trellis));
        return;
      case "focus":
        render(renderFocus(this.trellis.focus));
        return;
      case "habits":
        render(renderHabits(this.trellis.habits_today));
        return;
    }
  }

  // Test hook — not used in prod.
  async unpair(): Promise<void> {
    await apiUnpair();
    this.screen = "pair";
    this.trellis = null;
    this.draw();
  }
}

function nextScreen(s: Screen): Screen {
  const order: Screen[] = ["home", "focus", "habits"];
  const i = order.indexOf(s);
  return order[(i + 1) % order.length] ?? "home";
}

function previousScreen(s: Screen): Screen {
  const order: Screen[] = ["home", "focus", "habits"];
  const i = order.indexOf(s);
  return order[(i - 1 + order.length) % order.length] ?? "home";
}

function errorMessage(err: ApiError): string {
  if (err.status === 422) {
    const body = err.body as { error?: string } | null;
    if (body?.error === "expired_code") return "Code expired";
    if (body?.error === "invalid_code") return "Invalid code";
  }
  if (err.status === 401) return "Unauthorised";
  return `Error ${err.status}`;
}

new App().start();
