// Momo the wandering merchant — a resident bot that keeps the world breathing.
// One shot per invocation (a systemd user timer fires it every ~8 minutes on the
// node host): wake up, look at the world, do one or two small real things.
// Every action goes through the same signed, rate-limited path as any player.
//
// DEPLOYMENT: this file runs from inside the vouch-cli package on the node host
// (~/vouch/vouch-cli/bot.ts) so its imports resolve there. Env:
//   BOT_SEED   (required) secret seed string — the bot's key material
//   BOT_NAME   default "Momo"
//   VOUCH_NODE_URL default http://127.0.0.1:8787

import { createHash } from "node:crypto";
import { keyPairFromSeed } from "vouch-core";
import { VouchClient } from "./src/client";

interface Agent {
  id: string;
  region: string;
  role: string;
  balances: { currency: number };
}
interface Region {
  id: string;
  owner: string | null;
  lifecycle: string;
  institutions: { itemPolicy: { minting: string }; governance: { kind: string }; diplomacyPolicy: { defaultStance: string; overrides: Record<string, string> } };
}
interface Item {
  id: string;
  kind: string;
  owner: string;
}

const SECRET = process.env["BOT_SEED"];
if (!SECRET) throw new Error("BOT_SEED is required");
const NAME = process.env["BOT_NAME"] ?? "Momo";
const NODE = process.env["VOUCH_NODE_URL"] ?? "http://127.0.0.1:8787";

const client = new VouchClient(NODE, keyPairFromSeed(new Uint8Array(createHash("sha256").update(SECRET).digest())));
const rand = Math.random;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (msg: string, extra?: unknown) => console.log(`[${NAME}] ${msg}`, extra ?? "");

const VILLAGER_NAMES = ["Hana", "Taro", "Suzu", "Gonta", "Mimi", "Roku", "Chiyo", "Bunta"];
const WARES = ["bread", "fish", "lantern", "rope", "boots", "tea"];

async function ensureRegistered(principal: string): Promise<void> {
  const acc = await client.account(principal);
  if (!acc.registered) {
    const res = await client.register(principal);
    say(`register ${principal}`, res);
  }
}

async function main(): Promise<void> {
  await ensureRegistered(NAME);
  const agents = (await client.agents()) as Agent[];
  const regions = (await client.regions()) as Region[];
  const me = agents.find((a) => a.id.startsWith(`${NAME}@`) && a.role !== "treasury");

  // First run: found a market town and move in with a couple of villagers.
  if (!me) {
    const taken = new Set(regions.map((r) => r.id));
    let rid = "ichiba";
    for (let i = 2; taken.has(rid); i++) rid = `ichiba${i}`;
    say(`founding ${rid}`);
    console.log(await client.found(NAME, rid, "Ichiba"));
    await sleep(1200);
    console.log(await client.admit(NAME, `${NAME}@${rid}`, rid, "merchant", 150));
    await sleep(1200);
    console.log(await client.admit(NAME, `Hana@${rid}`, rid, "artisan", 40));
    await sleep(1200);
    console.log(await client.admit(NAME, `Taro@${rid}`, rid, "broker", 40));
    await sleep(1200);
    console.log(await client.amend(NAME, rid, { policy: "items", value: { minting: "anyone" } }));
    say("the market town is open!");
    return;
  }

  await ensureRegistered(me.id);
  const others = agents.filter((a) => a.role !== "treasury" && !a.id.startsWith(`${NAME}@`));
  const activeRegions = regions.filter((r) => r.lifecycle === "active");
  const owned = regions.find((r) => r.owner === NAME);

  const rounds = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < rounds; i++) {
    const roll = rand();
    try {
      if (roll < 0.34 && others.length > 0 && me.balances.currency > 12) {
        const to = pick(others);
        const amount = 1 + Math.floor(rand() * 6);
        say(`pays ${amount}G to ${to.id}`, await client.transfer(me.id, to.id, amount));
      } else if (roll < 0.52 && others.length > 0) {
        const to = pick(others);
        say(`vouches for ${to.id}`, await client.vouch(me.id, to.id, 1 + Math.floor(rand() * 3)));
      } else if (roll < 0.68) {
        const kind = pick(WARES);
        const itemId = `${kind}${Math.random().toString(36).slice(2, 8)}`;
        say(`mints ${kind}`, await client.mintItem(me.id, itemId, kind, me.id));
      } else if (roll < 0.80) {
        const items = (await client.items()) as Item[];
        const mine = items.filter((it) => it.owner === me.id);
        if (mine.length > 0 && others.length > 0) {
          const gift = pick(mine);
          const to = pick(others);
          say(`gives ${gift.kind} to ${to.id}`, await client.transferItem(me.id, gift.id, to.id));
        }
      } else if (roll < 0.88 && owned) {
        const residents = agents.filter((a) => a.region === owned.id && a.role !== "treasury").length;
        const fresh = VILLAGER_NAMES.find((n) => !agents.some((a) => a.id === `${n}@${owned.id}`));
        if (residents < 8 && fresh) {
          say(`invites ${fresh} to ${owned.id}`, await client.admit(NAME, `${fresh}@${owned.id}`, owned.id, pick(["artisan", "merchant", "broker"]), 40));
        }
      } else if (roll < 0.94 && owned && owned.institutions.governance.kind === "dictatorship") {
        const target = pick(activeRegions.filter((r) => r.id !== owned.id));
        if (target) {
          const cur = owned.institutions.diplomacyPolicy;
          const stance = pick(["absorb", "map"] as const);
          say(`opens relations ${owned.id} -> ${target.id} (${stance})`,
            await client.amend(NAME, owned.id, { policy: "diplomacy", value: { defaultStance: cur.defaultStance, overrides: { ...cur.overrides, [target.id]: stance } } }));
        }
      } else {
        const target = pick(activeRegions.filter((r) => r.id !== me.region));
        if (target) say(`wanders to ${target.id}`, await client.migrate(me.id, target.id));
      }
    } catch (error) {
      say("stumbled:", error instanceof Error ? error.message : error);
    }
    await sleep(1500);
  }
}

await main();
