// Glasses HUD controller. Subscribes to the shared Trellis store
// and pushes the right RenderPlan to the SDK whenever state changes.
// Input rotates the visible screen (home → focus → habits → home).

import { onInput, render, type InputEvent } from "./glasses";
import { renderFocus } from "./screens/focus";
import { renderHabits } from "./screens/habits";
import { renderHome } from "./screens/home";
import { renderNotPaired } from "./screens/pair";
import { store, type Snapshot } from "./store";
import type { Screen } from "./types";

export function startHud(): void {
  let screen: Screen = "home";
  let snapshot: Snapshot = {
    state: null,
    paired: false,
    lastFetchedAt: null,
    lastError: null,
    isPolling: false,
  };

  const draw = () => {
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

  onInput((event: InputEvent) => {
    if (!snapshot.paired) return;
    switch (event) {
      case "swipe_up":
        screen = previousScreen(screen);
        break;
      case "swipe_down":
        screen = nextScreen(screen);
        break;
      case "double_press":
        void store.forceRefresh();
        return;
      case "press":
        return;
    }
    draw();
  });

  store.subscribe((next) => {
    snapshot = next;
    draw();
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
