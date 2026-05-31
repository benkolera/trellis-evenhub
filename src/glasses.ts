// Thin wrapper over @evenrealities/even_hub_sdk. The rest of the
// plugin imports from here so the SDK's surface stays in one place.
//
// Lifecycle:
//   1. `waitForEvenAppBridge()` resolves once the host (Even App
//      WebView) is ready to receive messages.
//   2. First call to `render` issues `createStartUpPageContainer`.
//   3. Subsequent renders pick between `textContainerUpgrade`
//      (cheap, flicker-free, text-only change) and
//      `rebuildPageContainer` (layout change, list contents change).
//
// Layout primitives: see `TextContainerProperty` / `ListContainerProperty`
// in @evenrealities/even_hub_sdk/dist/index.d.ts. Page limits
// (per SDK): max 8 text containers, max 4 images, 1–12 total.
//
// Input: the SDK delivers a single `EvenHubEvent` per host event;
// the field that's populated (`textEvent` / `listEvent` / `sysEvent`)
// tells you which container raised it. Only the container with
// `isEventCapture: 1` raises events for that page.

import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";

// ---- canvas + layout constants ----

// G2 HUD per the Even Hub docs: 576×288, 4-bit greyscale per eye.
const SCREEN_W = 576;
const SCREEN_H = 288;
const PADDING = 8;

// Reserved container IDs — chosen by us and kept stable for the
// lifetime of the page so `textContainerUpgrade` knows what to update.
const TEXT_ID = 1;
const LIST_ID = 2;

// Geometry presets. Text-only fills the page; text+list shrinks the
// text to a header strip on top and gives the list everything below.
const TEXT_FULL = {
  xPosition: 0,
  yPosition: 0,
  width: SCREEN_W,
  height: SCREEN_H,
  paddingLength: PADDING,
};

const TEXT_HEADER = {
  xPosition: 0,
  yPosition: 0,
  width: SCREEN_W,
  height: 48,
  paddingLength: PADDING,
};

const LIST_BELOW_HEADER = {
  xPosition: 0,
  yPosition: 48,
  width: SCREEN_W,
  height: SCREEN_H - 48,
  paddingLength: PADDING,
};

// ---- public types ----

export interface RenderPlan {
  /** Text lines, top-to-bottom. Joined with "\n"; firmware wraps. */
  lines: string[];
  /** Optional native scrollable list. ≤20 items × ≤64 chars (SDK). */
  list?: { items: string[] };
}

export type InputEvent = "press" | "double_press" | "swipe_up" | "swipe_down";
export type InputHandler = (event: InputEvent) => void;

// ---- bridge bootstrap ----

let bridgePromise: Promise<EvenAppBridge> | null = null;

function bridge(): Promise<EvenAppBridge> {
  if (!bridgePromise) bridgePromise = waitForEvenAppBridge();
  return bridgePromise;
}

// ---- input ----

let currentHandler: InputHandler | null = null;
let unsubscribe: (() => void) | null = null;

export function onInput(handler: InputHandler): void {
  currentHandler = handler;
  if (unsubscribe) return;

  void bridge().then((b) => {
    unsubscribe = b.onEvenHubEvent((event: EvenHubEvent) => {
      const mapped = mapInput(event);
      if (mapped && currentHandler) currentHandler(mapped);
    });
  });
}

function mapInput(event: EvenHubEvent): InputEvent | null {
  // Sys events (foreground enter/exit, IMU, system exit) aren't user
  // input — drop them at this layer.
  if (event.sysEvent) return null;

  const userEvent = event.textEvent ?? event.listEvent;
  if (!userEvent) return null;

  // Per the Even Hub docs, a single tap may arrive with `eventType`
  // unset; that case is equivalent to CLICK_EVENT and must be
  // handled, otherwise pressing the touchpad does nothing.
  switch (userEvent.eventType) {
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

// ---- render ----
//
// State machine — `null` means the page hasn't been created yet; the
// first render must use `createStartUpPageContainer` rather than
// `rebuildPageContainer`. After that, we diff against `lastPlan` to
// decide between the cheap text upgrade and a full rebuild.

type MountState =
  | { kind: "unmounted" }
  | { kind: "text"; lastText: string }
  | { kind: "text+list"; lastText: string; lastItems: string[] };

let mount: MountState = { kind: "unmounted" };

// Serialize renders so two `render()` calls in the same tick don't
// race the SDK (each method is a postMessage round-trip).
let pending: Promise<void> = Promise.resolve();

export function render(plan: RenderPlan): void {
  pending = pending.then(() => doRender(plan)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[glasses.render] failed", err);
  });
}

async function doRender(plan: RenderPlan): Promise<void> {
  const b = await bridge();
  const text = plan.lines.join("\n");
  const targetKind = plan.list ? "text+list" : "text";

  if (mount.kind === "unmounted") {
    const res = await b.createStartUpPageContainer(buildCreate(text, plan.list?.items));
    if (res !== StartUpPageCreateResult.success) {
      // eslint-disable-next-line no-console
      console.warn("[glasses] createStartUpPageContainer:", res);
      return;
    }
    mount = plan.list
      ? { kind: "text+list", lastText: text, lastItems: plan.list.items }
      : { kind: "text", lastText: text };
    return;
  }

  // Layout changed (added/removed list, or list contents changed) →
  // full rebuild. The SDK doesn't expose a list-items upgrade, so
  // any list change is structural.
  const needsRebuild =
    mount.kind !== targetKind ||
    (mount.kind === "text+list" &&
      plan.list &&
      !arrayEqual(mount.lastItems, plan.list.items));

  if (needsRebuild) {
    await b.rebuildPageContainer(buildRebuild(text, plan.list?.items));
    mount = plan.list
      ? { kind: "text+list", lastText: text, lastItems: plan.list.items }
      : { kind: "text", lastText: text };
    return;
  }

  // Same layout, possibly new text — cheap upgrade.
  if (text !== mount.lastText) {
    await b.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: TEXT_ID, content: text }),
    );
    mount = { ...mount, lastText: text };
  }
}

// ---- builders ----

function buildCreate(text: string, items?: string[]): CreateStartUpPageContainer {
  return new CreateStartUpPageContainer({
    containerTotalNum: items ? 2 : 1,
    textObject: [textContainer(text, items !== undefined)],
    listObject: items ? [listContainer(items)] : undefined,
  });
}

function buildRebuild(text: string, items?: string[]): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: items ? 2 : 1,
    textObject: [textContainer(text, items !== undefined)],
    listObject: items ? [listContainer(items)] : undefined,
  });
}

function textContainer(content: string, withList: boolean): TextContainerProperty {
  const geo = withList ? TEXT_HEADER : TEXT_FULL;
  return new TextContainerProperty({
    ...geo,
    containerID: TEXT_ID,
    containerName: "trellis-text",
    // Capture input on the text container so swipes always switch
    // screens. We forgo native list scrolling — habits are capped at
    // 10 items by the server, so the whole list fits the HUD anyway.
    isEventCapture: 1,
    content,
  });
}

function listContainer(items: string[]): ListContainerProperty {
  // SDK: max 20 items, max 64 chars each.
  const trimmed = items.slice(0, 20).map((s) => s.slice(0, 64));
  return new ListContainerProperty({
    ...LIST_BELOW_HEADER,
    containerID: LIST_ID,
    containerName: "trellis-list",
    isEventCapture: 0,
    itemContainer: new ListItemContainerProperty({
      itemCount: trimmed.length,
      itemName: trimmed,
    }),
  });
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
