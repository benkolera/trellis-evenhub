// Thin abstraction over @evenrealities/even_hub_sdk. All other modules
// import from here, so when the upstream SDK API shape is verified
// against actual hardware, only this file changes.
//
// Confirmed from the published docs (hub.evenrealities.com/docs):
//   * Input subscription: `bridge.onEvenHubEvent(event => { ... })`
//     with `event.textEvent.eventType` discriminated by
//     `OsEventTypeList.{CLICK_EVENT|DOUBLE_CLICK_EVENT|
//      SCROLL_TOP_EVENT|SCROLL_BOTTOM_EVENT}`.
//   * Render primitives: TextContainerProperty, scrollable list (≤20
//     items × 64 chars), textContainerUpgrade / rebuildPageContainer
//     for updates. Containers carry `isEventCapture: 1` when they own
//     input focus.
//   * Display: 576×288 px, 4-bit greyscale.
//
// TODO(SDK): the exact import paths and constructor shapes below are
// inferred from the docs' prose and need to be checked against the
// installed package once `npm install` runs. Adjust the imports and
// the bodies of the `render*` functions — keep the exported function
// signatures stable so the screens don't need to change.

// @ts-expect-error — SDK types may not match this import shape; verify
// after `npm install` and adjust here only.
import { bridge, OsEventTypeList } from "@evenrealities/even_hub_sdk";

export type InputEvent = "press" | "double_press" | "swipe_up" | "swipe_down";

export type InputHandler = (event: InputEvent) => void;

let currentHandler: InputHandler | null = null;
let subscribed = false;

export function onInput(handler: InputHandler): void {
  currentHandler = handler;
  if (subscribed) return;
  subscribed = true;

  bridge.onEvenHubEvent((event: { textEvent?: { eventType?: number } }) => {
    const eventType = event.textEvent?.eventType;
    const mapped = mapEventType(eventType);
    if (mapped && currentHandler) currentHandler(mapped);
  });
}

function mapEventType(eventType: number | undefined): InputEvent | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      return "press";
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "double_press";
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "swipe_up";
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "swipe_down";
    default:
      return null;
  }
}

// ---- rendering ----
//
// A "render plan" is a flat description of what should appear on the
// HUD; screens build one and pass it here. This module is responsible
// for diffing against the current frame and calling the right SDK
// upgrade function. For v1, just full-rebuild every render — the SDK
// docs say textContainerUpgrade is flicker-free, but we'll wire that
// in once we can measure flicker on hardware.

export interface RenderPlan {
  // Lines of text, top to bottom. Wraps automatically at container width.
  lines: string[];
  // Optional scrollable list (used by the Habits screen).
  list?: { items: string[] };
}

export function render(plan: RenderPlan): void {
  // TODO(SDK): replace with the actual rebuildPageContainer +
  // TextContainerProperty composition. Until then, this is a no-op
  // shim that still lets the rest of the app compile and run in dev.
  // eslint-disable-next-line no-console
  console.log("[glasses.render]", plan);
}
