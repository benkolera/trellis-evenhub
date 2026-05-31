// Local countdown ticker. Between server polls, decrement the
// `ends_in_s` / `starts_in_s` fields locally each second so the HUD
// looks live. On every poll, the server's value reconciles drift.

export type TickHandler = () => void;

export class Ticker {
  private handle: number | null = null;

  constructor(
    private readonly onTick: TickHandler,
    private readonly intervalMs = 1000,
  ) {}

  start(): void {
    if (this.handle !== null) return;
    this.handle = setInterval(this.onTick, this.intervalMs) as unknown as number;
  }

  stop(): void {
    if (this.handle === null) return;
    clearInterval(this.handle);
    this.handle = null;
  }
}

export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatHhMm(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}`;
}
