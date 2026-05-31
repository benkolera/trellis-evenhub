// EventSource client for Trellis change notifications.
//
// The plugin's WebView ships native EventSource, which gives us
// auto-reconnect (with Last-Event-ID) for free. The downside is that
// EventSource can't set custom request headers, so the bearer rides
// in the URL as `?access_token=...`. The server-side G2TokenAuth
// plug supports both forms.
//
// We treat the SSE event as a pure signal: every `change` event
// triggers the store's existing `forceRefresh()` → `/api/g2/state`
// → fingerprint diff → `changeSeq` bump → HUD wake. The event data
// payload itself is just `{"reason":"agenda" | "focus"}` and we
// don't even bother parsing it — any event means "go look".

import { getBaseUrl, getToken } from "./storage";

export type StreamStatus = "disconnected" | "connecting" | "connected";

export interface StreamHandle {
  close(): void;
}

export interface StreamCallbacks {
  onChange: () => void;
  onStatus: (status: StreamStatus) => void;
}

export function connectStream({ onChange, onStatus }: StreamCallbacks): StreamHandle {
  const token = getToken();
  if (!token) {
    onStatus("disconnected");
    return { close: () => {} };
  }

  onStatus("connecting");
  const url =
    `${getBaseUrl()}/api/g2/stream?access_token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.addEventListener("open", () => onStatus("connected"));
  es.addEventListener("error", () => {
    // EventSource flips readyState to CONNECTING (0) before its next
    // retry attempt, and to CLOSED (2) if it has permanently failed.
    onStatus(es.readyState === EventSource.CLOSED ? "disconnected" : "connecting");
  });
  es.addEventListener("change", () => onChange());

  return {
    close: () => {
      es.close();
      onStatus("disconnected");
    },
  };
}
