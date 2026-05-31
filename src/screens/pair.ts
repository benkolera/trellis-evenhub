import type { RenderPlan } from "../glasses";

export interface PairScreenState {
  step: "intro" | "entering" | "verifying" | "error";
  code: string;
  error?: string;
}

export function renderPair(state: PairScreenState): RenderPlan {
  switch (state.step) {
    case "intro":
      return {
        lines: [
          "Pair with Trellis",
          "",
          "Open Settings on Trellis",
          "and generate a code.",
          "",
          "Press to enter code.",
        ],
      };

    case "entering":
      return {
        lines: [
          "Enter pairing code",
          "",
          state.code.padEnd(6, "_"),
          "",
          "Press: confirm",
          "Swipe: cancel",
        ],
      };

    case "verifying":
      return { lines: ["Pairing…"] };

    case "error":
      return {
        lines: [
          "Pairing failed",
          "",
          state.error ?? "Unknown error",
          "",
          "Press to retry.",
        ],
      };
  }
}
