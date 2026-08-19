// The player's wallet: one Ed25519 key (shared with vouch-cli's ~/.vouch/key) and a
// hero name. The key signs for TWO principals: the hero name itself (region owner /
// governance identity) and `hero@region` (the agent that walks, trades and vouches).
// Non-custodial with respect to the node — the key never leaves this machine.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decodeBase64, encodeBase64, generateKeyPair, type KeyPair, keyPairFromSeed } from "vouch-core";

export interface Wallet {
  readonly keyPair: KeyPair;
  /** The bare hero name (`mizuki`), or null until the player names their hero. */
  readonly heroName: string | null;
}

interface WalletPaths {
  readonly keyfile: string;
  readonly configFile: string;
}

export function walletPaths(env: Record<string, string | undefined>): WalletPaths {
  const dir = env["VOUCH_CONFIG_DIR"] ?? join(homedir(), ".vouch");
  return {
    keyfile: env["VOUCH_KEYFILE"] ?? join(dir, "key"),
    configFile: join(dir, "config.json"),
  };
}

function loadOrCreateKey(paths: WalletPaths): KeyPair {
  if (existsSync(paths.keyfile)) {
    const seed = decodeBase64(readFileSync(paths.keyfile, "utf8").trim());
    if (seed.length !== 32) throw new Error(`keyfile ${paths.keyfile} is not a 32-byte seed`);
    return keyPairFromSeed(seed);
  }
  const pair = generateKeyPair();
  mkdirSync(dirname(paths.keyfile), { recursive: true });
  writeFileSync(paths.keyfile, `${encodeBase64(pair.privateKey)}\n`, { mode: 0o600 });
  return pair;
}

function loadHeroName(paths: WalletPaths): string | null {
  if (!existsSync(paths.configFile)) return null;
  try {
    const cfg = JSON.parse(readFileSync(paths.configFile, "utf8")) as { principal?: string };
    const principal = cfg.principal;
    if (typeof principal !== "string" || principal.length === 0) return null;
    // The CLI stores the ACTIVE principal, which may be the agent form (`mizuki@asahi`).
    // The hero name is the part before the `@`.
    return principal.split("@")[0] ?? null;
  } catch {
    return null;
  }
}

export function loadWallet(env: Record<string, string | undefined>): Wallet {
  const paths = walletPaths(env);
  return { keyPair: loadOrCreateKey(paths), heroName: loadHeroName(paths) };
}

/** Persist the hero name as the config's principal (merging with any CLI config). */
export function saveHeroName(env: Record<string, string | undefined>, heroName: string): void {
  const paths = walletPaths(env);
  let existing: Record<string, unknown> = {};
  if (existsSync(paths.configFile)) {
    try {
      existing = JSON.parse(readFileSync(paths.configFile, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  mkdirSync(dirname(paths.configFile), { recursive: true });
  writeFileSync(paths.configFile, `${JSON.stringify({ ...existing, principal: heroName }, null, 2)}\n`, { mode: 0o600 });
}
