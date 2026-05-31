// Trellis Even Hub plugin entry point.
//
// The plugin runs in two surfaces — a phone-side HTML UI and the
// glasses HUD — and we don't actually know up front which one the
// user will be looking at (the Even App's onLaunchSource push has
// proven unreliable in practice). We just start both: the phone UI
// is invisible when launched from the glasses menu, and the HUD
// calls are harmless background no-ops when launched from the app
// menu. Both surfaces share a single `store` so they always agree.
//
// Critically, the HUD is started without waiting on the storage
// timeout — the SDK bridge can take longer than a couple of seconds
// to come ready on a fresh install, and `glasses.ts` already waits
// on the bridge internally with no timeout of its own.

import { startHud } from "./hud";
import { mountPhoneUi } from "./phone";
import { load as loadStorage } from "./storage";
import { store } from "./store";

void boot();

async function boot(): Promise<void> {
  // Mount the phone UI and start the HUD immediately. The phone UI
  // will re-render once the store hydrates; the HUD just queues its
  // first frame behind `waitForEvenAppBridge()`.
  mountPhoneUi();
  startHud();

  // Hydrate token + base URL from the Even App's native storage
  // (which survives reinstalls; the WebView's own localStorage does
  // not). Falls back to localStorage if the bridge times out.
  await loadStorage();

  // Now that the token is in cache, polling and the SSE stream can
  // start using it.
  store.start();
}
