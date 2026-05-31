// Trellis Even Hub plugin entry point.
//
// The plugin runs in two surfaces — a phone-side HTML UI and the
// glasses HUD — and we don't actually know up front which one the
// user will be looking at (the Even App's onLaunchSource push has
// proven unreliable in practice). We just start both: the phone UI
// is invisible when launched from the glasses menu, and the HUD
// calls are harmless background no-ops when launched from the app
// menu. Both surfaces share a single `store` so they always agree.

import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

import { startHud } from "./hud";
import { mountPhoneUi } from "./phone";
import { store } from "./store";

void boot();

async function boot(): Promise<void> {
  // Backend polling starts immediately. The phone UI is also safe to
  // mount before the bridge resolves (it only touches the DOM).
  store.start();
  mountPhoneUi();

  // The HUD needs the SDK bridge; if it never resolves (browser
  // preview, simulator without a launch push), we just stay phone-only.
  try {
    await waitForEvenAppBridge();
    startHud();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trellis] SDK bridge unavailable, running phone-only", err);
  }
}
