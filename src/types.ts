// Mirrors the JSON contract of /api/g2/state from the Trellis backend
// (electricbrain repo, ElectricbrainWeb.G2Controller.state).

export interface NowEntry {
  title: string;
  ends_at: string; // ISO8601
  ends_in_s: number;
}

export interface NextEntry {
  title: string;
  starts_at: string;
  starts_in_s: number;
}

export interface FocusState {
  state: "work" | "break";
  target: string | null;
  ends_at: string;
  ends_in_s: number;
}

export interface HabitToday {
  title: string;
  done: number;
  target: number;
  period: "day" | "week" | "month";
}

export interface TrellisState {
  now: NowEntry | null;
  next: NextEntry | null;
  focus: FocusState | null;
  habits_today: HabitToday[];
}

export type Screen = "pair" | "home" | "focus" | "habits";
