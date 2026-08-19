// The game's data layer, now fully client-side: the browser wallet signs, the
// snapshot is aggregated from the node's observation reads, and the only server
// between us and the node is a dumb same-origin `/node` proxy (dev: server.ts,
// prod: a Vercel rewrite). Function signatures are kept from the old server-API
// version so main.ts stays unchanged.

import type { ActResult, LogEventView, Snapshot } from "../shared";
import { actionSchema, buildSnapshot, dispatchAction, findHeroAgent } from "./logic";
import { type BrowserWallet, loadHeroName, loadOrCreateWallet, reads, register, saveHeroName } from "./wire";

let wallet: BrowserWallet | null = null;
function getWallet(): BrowserWallet {
  wallet ??= loadOrCreateWallet();
  return wallet;
}

export function fetchWorld(): Promise<Snapshot> {
  return buildSnapshot(loadHeroName());
}

export async function fetchLog(since: number): Promise<LogEventView[]> {
  return (await reads.log(since)) as LogEventView[];
}

export async function postAct(action: Record<string, unknown>): Promise<ActResult> {
  const heroName = loadHeroName();
  if (!heroName) return { ok: false, reason: "no hero yet — name your hero first" };
  const parsed = actionSchema.safeParse(action);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "bad action" };
  const agents = (await reads.agents()) as Parameters<typeof findHeroAgent>[0];
  const hero = { heroName, agentId: findHeroAgent(agents, heroName)?.id ?? null };
  return dispatchAction(getWallet(), hero, parsed.data);
}

export async function postRegister(heroName: string): Promise<{ ok: boolean; reason?: string }> {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(heroName) || heroName.length > 64) {
    return { ok: false, reason: "なまえは romaji で (れい: Mizuki)" };
  }
  const res = await register(getWallet(), heroName);
  if (!res.ok) {
    // First-writer-wins on the node: a taken name belongs to someone else's key.
    const reason = res.reason === "already-registered" ? "そのなまえは すでに つかわれている" : res.reason;
    return { ok: false, reason };
  }
  saveHeroName(heroName);
  return { ok: true };
}
