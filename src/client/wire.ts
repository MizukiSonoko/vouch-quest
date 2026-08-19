// Browser-side signing — the whole point of the multiplayer build. Each visitor
// holds their own Ed25519 seed in localStorage and signs every command locally;
// the page talks to the node through the same-origin `/node` proxy. This is a
// faithful port of the vouch-cli VouchClient (Apache-2.0, same author): the byte
// formats are pinned by parity tests against vectors from the real vouch-node.

import { ed25519 } from "@noble/curves/ed25519";
import canonicalize from "canonicalize";

export const NODE_BASE = "/node";
const SEED_KEY = "vouchquest.seed";
const HERO_KEY = "vouchquest.hero";

// --- bytes (must stay byte-identical to vouch-node's accounts.ts) ------------

export function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function canonicalBytes(value: unknown): Uint8Array {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("value is not JCS-canonicalizable");
  return new TextEncoder().encode(out);
}

export function registerBytes(principal: string, nonce: number, publicKey: string): Uint8Array {
  return canonicalBytes({ purpose: "vouch-register/v1", principal, nonce, publicKey });
}

export function commandBytes(principal: string, nonce: number, command: unknown): Uint8Array {
  return canonicalBytes({ purpose: "vouch-command/v1", principal, nonce, command });
}

// --- wallet (localStorage; the seed never leaves this browser) ---------------

export interface BrowserWallet {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

export function loadOrCreateWallet(storage: Storage = localStorage): BrowserWallet {
  const stored = storage.getItem(SEED_KEY);
  let seed: Uint8Array;
  if (stored) {
    seed = decodeBase64(stored);
    if (seed.length !== 32) throw new Error("stored seed is corrupt");
  } else {
    seed = crypto.getRandomValues(new Uint8Array(32));
    storage.setItem(SEED_KEY, encodeBase64(seed));
  }
  return { privateKey: seed, publicKey: ed25519.getPublicKey(seed) };
}

export function loadHeroName(storage: Storage = localStorage): string | null {
  return storage.getItem(HERO_KEY);
}

export function saveHeroName(heroName: string, storage: Storage = localStorage): void {
  storage.setItem(HERO_KEY, heroName);
}

// --- client (port of vouch-cli's VouchClient over the /node proxy) ------------

export type SubmitResult =
  | { readonly ok: true; readonly detail: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly reason: string };

interface PostBody {
  detail?: Record<string, unknown>;
  error?: { code: string };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: PostBody }> {
  const res = await fetch(`${NODE_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as PostBody };
}

export async function account(principal: string): Promise<{ registered: boolean; nonce: number }> {
  return getJson(`/v1/account/${encodeURIComponent(principal)}`);
}

export async function register(wallet: BrowserWallet, principal: string): Promise<SubmitResult> {
  const publicKey = encodeBase64(wallet.publicKey);
  const signature = encodeBase64(ed25519.sign(registerBytes(principal, 0, publicKey), wallet.privateKey));
  const { ok, status, body } = await postJson("/v1/register", { principal, publicKey, nonce: 0, signature });
  return ok ? { ok: true, detail: {} } : { ok: false, status, reason: body.error?.code ?? `http-${status}` };
}

/** Sign and submit AS `principal`; nonce from the node, one retry on contention. */
export async function submit(wallet: BrowserWallet, principal: string, command: unknown): Promise<SubmitResult> {
  const first = await account(principal);
  if (!first.registered) return { ok: false, status: 401, reason: `principal "${principal}" is not registered` };
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = (await account(principal)).nonce + 1;
    const signature = encodeBase64(ed25519.sign(commandBytes(principal, nonce, command), wallet.privateKey));
    const { ok, status, body } = await postJson("/v1/command", { principal, nonce, command, signature });
    if (ok) return { ok: true, detail: body.detail ?? {} };
    const reason = body.error?.code ?? `http-${status}`;
    if (reason === "stale-nonce" && attempt < 2) continue;
    return { ok: false, status, reason };
  }
  return { ok: false, status: 409, reason: "nonce-contention" };
}

export const reads = {
  regions: () => getJson<unknown[]>("/regions"),
  agents: () => getJson<unknown[]>("/agents"),
  items: () => getJson<unknown[]>("/items"),
  metrics: () => getJson<{ log: { length: number } }>("/metrics"),
  log: (since: number) => getJson<unknown[]>(`/log?since=${since}`),
};
