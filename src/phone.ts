// Phone-side UI shown when the plugin is launched from the Even App
// menu (not the glasses menu). Pair / unpair lives here because the
// glasses themselves have no alphanumeric input — the 6-char code
// has to be typed somewhere with a keyboard.

import { ApiError, pair as apiPair, unpair as apiUnpair } from "./api";
import {
  clearToken,
  getBaseUrl,
  isPaired,
  setBaseUrl,
} from "./storage";

export function mountPhoneUi(): void {
  const app = document.getElementById("app");
  if (!app) return;

  bindPairForm();
  bindBaseUrl();
  bindUnpair();
  showCurrentView();
  app.hidden = false;
}

function showCurrentView(): void {
  show("view-pair", !isPaired());
  show("view-paired", isPaired());
}

function show(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

function setError(message: string | null): void {
  const el = document.getElementById("pair-error");
  if (!el) return;
  el.textContent = message ?? "";
}

function bindPairForm(): void {
  const form = document.getElementById("pair-form") as HTMLFormElement | null;
  const code = document.getElementById("pair-code") as HTMLInputElement | null;
  const submit = document.getElementById("pair-submit") as HTMLButtonElement | null;
  if (!form || !code || !submit) return;

  // Normalise input to uppercase + filter to our alphabet. The
  // backend alphabet is ABCDEFGHJKMNPQRSTUVWXYZ23456789 — no
  // 0/O/1/I/L — but the friendlier UX is to accept and pre-fix
  // common confusable typings then let the server reject if needed.
  code.addEventListener("input", () => {
    const cleaned = code.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (cleaned !== code.value) code.value = cleaned;
    submit.disabled = cleaned.length !== 6;
    setError(null);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (code.value.length !== 6 || submit.disabled) return;
    submit.disabled = true;
    submit.textContent = "Pairing…";
    setError(null);

    try {
      await apiPair(code.value, deviceLabel());
      code.value = "";
      showCurrentView();
    } catch (err) {
      setError(humanError(err));
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
      // Server may already be gone; clear local state regardless.
      clearToken();
    }
    btn.textContent = "Unpair this device";
    btn.disabled = false;
    showCurrentView();
  });
}

function deviceLabel(): string {
  // Best-effort: glasses won't expose a useful UA, so keep it short
  // and obvious in the Settings list rather than parsing UA strings.
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
