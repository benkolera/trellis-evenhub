import type { RenderPlan } from "../glasses";
import { formatHhMm } from "../timer";
import type { TrellisState } from "../types";

export function renderHome(state: TrellisState): RenderPlan {
  const lines: string[] = [];

  if (state.now) {
    lines.push(`Now: ${truncate(state.now.title, 32)}`);
    lines.push(`  ${formatHhMm(state.now.ends_in_s)} left`);
  } else {
    lines.push("Now: —");
  }

  lines.push("");

  if (state.next) {
    lines.push(`Next: ${truncate(state.next.title, 32)}`);
    lines.push(`  in ${formatHhMm(state.next.starts_in_s)}`);
  } else {
    lines.push("Next: —");
  }

  return { lines };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
