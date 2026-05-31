// Glasses HUD controller.
//
// Auto-sleep: 10 seconds after the last user input or wake-worthy
// state change, the HUD renders a blank frame so the display dims.
// The text container stays mounted with isEventCapture=1 so a single
// tap (CLICK_EVENT) wakes it for another 10s.
//
// "Push" is approximated by polling — the store assigns a `changeSeq`
// that bumps when a material field (focus state, current/next entry)
// changes server-side. The HUD wakes on every bump, even mid-sleep.
// For sub-15s latency you'd add an SSE endpoint to Trellis and have
// the store subscribe to it; the wake path here would be the same.

import { onInput, render, type InputEvent } from "./glasses";
import { renderFocus } from "./screens/focus";
import { renderHabits } from "./screens/habits";
import { renderHome } from "./screens/home";
import { renderNotPaired } from "./screens/pair";
import { store, type Snapshot } from "./store";
import type { Screen } from "./types";

const AWAKE_MS = 10_000;

export function startHud(): void {
  let screen: Screen = "home";
  let snapshot: Snapshot = {
    state: null,
    paired: false,
    lastFetchedAt: null,
    lastError: null,
    isPolling: false,
    changeSeq: 0,
    streamStatus: "disconnected",
  };
  let lastSeenSeq = 0;
  let asleep = false;
  let sleepTimer: number | null = null;

  const scheduleSleep = () => {
    if (sleepTimer !== null) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      asleep = true;
      drawSleep();
    }, AWAKE_MS) as unknown as number;
  };

  const wake = () => {
    asleep = false;
    drawAwake();
    scheduleSleep();
  };

  const drawAwake = () => {
    if (!snapshot.paired || !snapshot.state) {
      render(renderNotPaired());
      return;
    }
    switch (screen) {
      case "pair":
      case "home":
        render(renderHome(snapshot.state));
        return;
      case "focus":
        render(renderFocus(snapshot.state.focus));
        return;
      case "habits":
        render(renderHabits(snapshot.state.habits_today));
        return;
    }
  };

  const drawSleep = () => {
    // A single-space content keeps the text container mounted (so
    // taps still route to us via isEventCapture=1) while leaving the
    // HUD effectively dark. We avoid shutDownPageContainer — that
    // would exit the plugin entirely and the user would need to
    // re-launch from the glasses menu to come back.
    render({ lines: [" "] });
  };

  onInput((event: InputEvent) => {
    // Any input wakes the HUD; the press that woke it is then
    // "consumed" — we don't also act on it. This avoids surprises
    // (e.g. a sleep-wake tap accidentally toggling something).
    if (asleep) {
      wake();
      return;
    }

    if (!snapshot.paired) {
      scheduleSleep();
      return;
    }

    switch (event) {
      case "swipe_up":
        screen = previousScreen(screen);
        break;
      case "swipe_down":
        screen = nextScreen(screen);
        break;
      case "double_press":
        void store.forceRefresh();
        break;
      case "press":
        break;
    }
    drawAwake();
    scheduleSleep();
  });

  store.subscribe((next) => {
    const wokeByChange = next.changeSeq !== lastSeenSeq;
    lastSeenSeq = next.changeSeq;
    snapshot = next;

    if (wokeByChange) {
      wake();
      return;
    }

    // Local-tick path: keep the countdown visible while awake; stay
    // dark while asleep.
    if (!asleep) drawAwake();
  });
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
