// Phone-side UI. Two modes:
//   * Not paired → show the 6-char code form.
//   * Paired    → show live state cards (the same data the HUD renders).
// Both modes subscribe to the shared store so we surface whatever
// the API last returned, including errors and stale state.

import { ApiError, pair as apiPair, unpair as apiUnpair } from "./api";
import {
  clearToken,
  getBaseUrl,
  setBaseUrl,
} from "./storage";
import { store, type Snapshot } from "./store";
import { formatHhMm, formatMmSs } from "./timer";
import type { FocusState, HabitToday, NextEntry, NowEntry } from "./types";

export function mountPhoneUi(): void {
  const app = document.getElementById("app");
  if (!app) return;

  bindPairForm();
  bindBaseUrl();
  bindUnpair();
  bindRefresh();

  store.subscribe((snapshot) => {
    showView("view-pair", !snapshot.paired);
    showView("view-paired", snapshot.paired);
    if (snapshot.paired) renderStatePanel(snapshot);
  });

  app.hidden = false;
}

// ---- pairing ----

function bindPairForm(): void {
  const form = document.getElementById("pair-form") as HTMLFormElement | null;
  const code = document.getElementById("pair-code") as HTMLInputElement | null;
  const submit = document.getElementById("pair-submit") as HTMLButtonElement | null;
  if (!form || !code || !submit) return;

  code.addEventListener("input", () => {
    const cleaned = code.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (cleaned !== code.value) code.value = cleaned;
    submit.disabled = cleaned.length !== 6;
    setPairError(null);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (code.value.length !== 6 || submit.disabled) return;
    submit.disabled = true;
    submit.textContent = "Pairing…";
    setPairError(null);

    try {
      await apiPair(code.value, deviceLabel());
      code.value = "";
      store.notifyPaired();
    } catch (err) {
      setPairError(humanError(err));
    } finally {
      submit.textContent = "Pair";
      submit.disabled = code.value.length !== 6;
    }
  });
}

function bindBaseUrl(): void {
  const input = document.getElementById("base-url") as HTMLInputElement | null;
  const save = document.getElementById("base-url-save") as HTMLButtonElement | null;
  if (!input || !save) return;
  input.value = getBaseUrl();
  save.addEventListener("click", () => {
    if (input.value) {
      setBaseUrl(input.value);
      save.textContent = "Saved";
      setTimeout(() => (save.textContent = "Save"), 1200);
    }
  });
}

function bindUnpair(): void {
  const btn = document.getElementById("unpair") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Unpairing…";
    try {
      await apiUnpair();
    } catch {
      clearToken();
    }
    store.notifyUnpaired();
    btn.textContent = "Unpair this device";
    btn.disabled = false;
  });
}

function bindRefresh(): void {
  const btn = document.getElementById("refresh") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", () => void store.forceRefresh());
}

// ---- live state rendering ----

function renderStatePanel(snapshot: Snapshot): void {
  setText("status-line", statusLine(snapshot));
  setText("status-error", snapshot.lastError?.message ?? "");
  showView("status-error", snapshot.lastError !== null);

  renderNow(snapshot.state?.now ?? null);
  renderNext(snapshot.state?.next ?? null);
  renderFocus(snapshot.state?.focus ?? null);
  renderHabits(snapshot.state?.habits_today ?? []);

  const refresh = document.getElementById("refresh") as HTMLButtonElement | null;
  if (refresh) {
    refresh.disabled = snapshot.isPolling;
    refresh.textContent = snapshot.isPolling ? "Refreshing…" : "Refresh now";
  }
}

function statusLine(snapshot: Snapshot): string {
  if (snapshot.lastError) return "Last fetch failed";
  if (!snapshot.lastFetchedAt) return snapshot.isPolling ? "Loading…" : "Waiting for first fetch…";
  return `Last fetched ${formatRelative(snapshot.lastFetchedAt)}`;
}

function renderNow(now: NowEntry | null): void {
  if (!now) {
    setText("now-title", "—");
    setText("now-meta", "Nothing in progress");
    return;
  }
  setText("now-title", now.title);
  setText("now-meta", `${formatHhMm(now.ends_in_s)} left`);
}

function renderNext(next: NextEntry | null): void {
  if (!next) {
    setText("next-title", "—");
    setText("next-meta", "Nothing upcoming");
    return;
  }
  setText("next-title", next.title);
  setText("next-meta", `in ${formatHhMm(next.starts_in_s)}`);
}

function renderFocus(focus: FocusState | null): void {
  const card = document.getElementById("card-focus");
  if (!card) return;
  if (!focus) {
    card.hidden = false;
    setText("focus-title", "No focus session");
    setText("focus-meta", "Start one in Trellis.");
    return;
  }
  card.hidden = false;
  const kind = focus.state === "work" ? "Focus" : "Break";
  setText("focus-title", focus.target ? `${kind} · ${focus.target}` : kind);
  setText("focus-meta", `${formatMmSs(focus.ends_in_s)} remaining`);
}

function renderHabits(habits: HabitToday[]): void {
  const list = document.getElementById("habits-list");
  if (!list) return;
  list.innerHTML = "";
  if (habits.length === 0) {
    const li = document.createElement("li");
    li.textContent = "All done. Nice.";
    li.className = "habit-empty";
    list.appendChild(li);
    return;
  }
  for (const h of habits) {
    const li = document.createElement("li");
    li.className = "habit-row";
    const title = document.createElement("span");
    title.className = "habit-title";
    title.textContent = h.title;
    const meta = document.createElement("span");
    meta.className = "habit-meta";
    meta.textContent = `${h.done} / ${h.target} · ${h.period}`;
    li.append(title, meta);
    list.appendChild(li);
  }
}

// ---- helpers ----

function showView(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setPairError(message: string | null): void {
  setText("pair-error", message ?? "");
}

function deviceLabel(): string {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return isIOS ? "Even Hub · iOS" : "Even Hub · Android";
}

function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 422) {
      const body = err.body as { error?: string } | null;
      if (body?.error === "expired_code")
        return "Code expired. Generate a new one in Trellis Settings.";
      if (body?.error === "invalid_code")
        return "Invalid code. Double-check the one in Trellis Settings.";
    }
    if (err.status === 400) return "Enter the 6-character code.";
    return `Pairing failed (HTTP ${err.status}).`;
  }
  return "Couldn't reach Trellis. Check the backend URL.";
}

function formatRelative(when: Date): string {
  const diff = Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  return when.toLocaleTimeString();
}
