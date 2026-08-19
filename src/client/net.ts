// Thin fetch wrappers over the game server's /api. Every call either returns data
// or throws an Error whose message is safe to show in the message window.

import type { ActResult, LogEventView, Snapshot } from "../shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok || body === null) {
    const reason = body && typeof body === "object" && "error" in body ? (body.error ?? res.statusText) : res.statusText;
    throw new Error(`つうしんに しっぱいした… (${reason})`);
  }
  return body as T;
}

export function fetchWorld(): Promise<Snapshot> {
  return getJson<Snapshot>("/api/world");
}

export function fetchLog(since: number): Promise<LogEventView[]> {
  return getJson<LogEventView[]>(`/api/log?since=${since}`);
}

export async function postAct(action: Record<string, unknown>): Promise<ActResult> {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = (await res.json().catch(() => null)) as ActResult | null;
  if (body === null) throw new Error("つうしんに しっぱいした…");
  return body;
}

export async function postRegister(heroName: string): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ heroName }),
  });
  return ((await res.json().catch(() => null)) as { ok: boolean; reason?: string } | null) ?? { ok: false, reason: "no response" };
}
