import type { RenderPlan } from "../glasses";
import type { HabitToday } from "../types";

// 64-char limit per list item per the SDK docs.
const MAX_LINE = 64;

export function renderHabits(habits: HabitToday[]): RenderPlan {
  if (habits.length === 0) {
    return { lines: ["Habits today", "", "All done. Nice."] };
  }

  const items = habits.slice(0, 20).map(formatHabit);
  return {
    lines: ["Habits today"],
    list: { items },
  };
}

function formatHabit(h: HabitToday): string {
  const prefix = h.period === "day" ? "·" : periodLabel(h.period);
  const progress = `${h.done}/${h.target}`;
  const raw = `${prefix} ${h.title} ${progress}`;
  return raw.length <= MAX_LINE ? raw : raw.slice(0, MAX_LINE - 1) + "…";
}

function periodLabel(p: "week" | "month"): string {
  return p === "week" ? "w" : "m";
}
