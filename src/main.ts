// Trellis Even Hub plugin entry point.
//
// The plugin has two surfaces depending on how the user launched it:
//
//   * **appMenu** — opened from the Even App's plugin list. The
//     phone screen is visible; we render an HTML form for entering
//     the pairing code (the HUD has no keyboard).
//
//   * **glassesMenu** — opened from the glasses wheel. The WebView
//     runs in the background; we drive the HUD via the SDK.
//
// `bridge.onLaunchSource(...)` fires exactly once after the WebView
// loads, so we register the listener immediately. If it never fires
// (e.g. dev preview in a browser, or the simulator running without
// a launch-source push), we fall back to phone-UI mode after a
// short grace period so the app isn't blank.

import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

import {
  ApiError,
  fetchState,
} from "./api";
import { onInput, render, type InputEvent } from "./glasses";
import { mountPhoneUi } from "./phone";
import { renderFocus } from "./screens/focus";
import { renderHabits } from "./screens/habits";
import { renderHome } from "./screens/home";
import { renderNotPaired } from "./screens/pair";
import { Ticker } from "./timer";
import type { Screen, TrellisState } from "./types";
import { isPaired } from "./storage";

const POLL_MS_IDLE = 30_000;
const POLL_MS_FOCUS = 5_000;
const LAUNCH_SOURCE_FALLBACK_MS = 1500;

void boot();

async function boot(): Promise<void> {
  const bridge = await waitForEvenAppBridge();

  let started = false;
  const start = (mode: "phone" | "glasses") => {
    if (started) return;
    started = true;
    if (mode === "phone") {
      mountPhoneUi();
    } else {
      new HudController().start();
    }
  };

  bridge.onLaunchSource((source) => {
    start(source === "glassesMenu" ? "glasses" : "phone");
  });

  // Fallback for environments without a launch-source push.
  setTimeout(() => start("phone"), LAUNCH_SOURCE_FALLBACK_MS);
}

class HudController {
  private screen: Screen = isPaired() ? "home" : "pair";
  private trellis: TrellisState | null = null;
  private pollHandle: number | null = null;
  private pollMs = POLL_MS_IDLE;
  private readonly ticker = new Ticker(() => this.onTick(), 1000);

  start(): void {
    onInput((e) => this.onInput(e));
    this.ticker.start();
    void this.poll();
    this.schedulePoll();
    this.draw();
  }

  private onInput(event: InputEvent): void {
    if (this.screen === "pair") return; // Nothing actionable from the HUD here.

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
        // Reserved for screen-specific action later (e.g. break/skip).
        break;
    }
    this.draw();
  }

  private async poll(): Promise<void> {
    if (!isPaired()) {
      this.screen = "pair";
      this.draw();
      return;
    }

    try {
      this.trellis = await fetchState();
      if (this.screen === "pair") this.screen = "home";
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

  private draw(): void {
    if (this.screen === "pair" || !this.trellis) {
      render(renderNotPaired());
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
