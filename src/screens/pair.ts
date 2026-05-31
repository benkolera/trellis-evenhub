import type { RenderPlan } from "../glasses";

// When the plugin is launched from the glasses menu but no token is
// stored yet, this is what we show on the HUD. Pairing itself happens
// on the phone (the glasses have no alphanumeric input).
export function renderNotPaired(): RenderPlan {
  return {
    lines: [
      "Trellis: not paired",
      "",
      "Open the Trellis plugin",
      "in the Even App to pair.",
    ],
  };
}
