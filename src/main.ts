// Trellis Even Hub plugin entry point.
//
// The plugin runs in two surfaces — a phone-side HTML UI and the
// glasses HUD — and we don't actually know up front which one the
// user will be looking at (the Even App's onLaunchSource push has
// proven unreliable in practice). We just start both: the phone UI
// is invisible when launched from the glasses menu, and the HUD
// calls are harmless background no-ops when launched from the app
// menu. Both surfaces share a single `store` so they always agree.

import { startHud } from "./hud";
import { mountPhoneUi } from "./phone";
import { load as loadStorage } from "./storage";
import { store } from "./store";

void boot();

async function boot(): Promise<void> {
  // Hydrate the bearer token + base URL from the Even App's native
  // storage (which survives plugin reinstalls — the WebView's
  // own localStorage does NOT). Falls back to localStorage if the
  // SDK bridge isn't available within a couple of seconds.
  const { bridgeReady } = await loadStorage();

  store.start();
  mountPhoneUi();

  if (bridgeReady) startHud();
}
