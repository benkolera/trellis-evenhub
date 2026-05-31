// Trellis API client. Endpoints defined in
// electricbrain/lib/electricbrain_web/router.ex under /api/g2/*.

import { clearToken, getBaseUrl, getToken, setToken } from "./storage";
import type { TrellisState } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function request(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<Response> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("accept", "application/json");
  if (rest.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, { error: "no_token" });
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${getBaseUrl()}${path}`, { ...rest, headers });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    if (res.status === 401) void clearToken();
    throw new ApiError(res.status, body);
  }
  return res;
}

export async function pair(
  code: string,
  label: string,
): Promise<{ token: string; label: string }> {
  const res = await request("/api/g2/pair", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ code, label }),
  });
  const data = (await res.json()) as { token: string; label: string };
  await setToken(data.token);
  return data;
}

export async function fetchState(): Promise<TrellisState> {
  const res = await request("/api/g2/state");
  return (await res.json()) as TrellisState;
}

export async function touch(): Promise<void> {
  await request("/api/g2/touch", { method: "POST" });
}

export async function unpair(): Promise<void> {
  try {
    await request("/api/g2/pairing", { method: "DELETE" });
  } finally {
    await clearToken();
  }
}
