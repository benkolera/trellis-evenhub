import type { RenderPlan } from "../glasses";
import { formatMmSs } from "../timer";
import type { FocusState } from "../types";

export function renderFocus(focus: FocusState | null): RenderPlan {
  if (!focus) {
    return { lines: ["No active focus", "", "Start one on Trellis."] };
  }

  const label = focus.state === "work" ? "FOCUS" : "BREAK";
  const target = focus.target ? truncate(focus.target, 36) : "";

  const lines = [
    label,
    "",
    formatMmSs(focus.ends_in_s),
  ];

  if (target) lines.push("", target);
  return { lines };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
