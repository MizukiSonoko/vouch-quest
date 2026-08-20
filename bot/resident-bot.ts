// The resident troupe — a small society that runs itself on the vouch node.
// A systemd user timer fires this every ~2 minutes; a few residents wake each
// run. Everything below is REAL: loans are transfers, the bank's ledger is
// derived from the event log, laws are institution amendments, and the
// crackdown on the swindler is an actual change of law.
//
// Cast:
//   Momo  merchant   trades and opens diplomatic relations
//   Kaji  artisan    mints wares and gives gifts
//   Gin   broker     moves money, vouches
//   Sora  wanderer   migrates, gossips (vouches)
//   Toshi developer  founds towns, recruits settlers (cities need people)
//   Zai   capitalist big trades, hires settlers, cuts taxes in his towns
//   Ginko banker     lends to the poor, tracks debts FROM THE LOG, rates credit
//   Kuro  swindler   borrows and never repays, spams junk mints, drifts on
//
// DEPLOYMENT: runs from inside vouch-cli on the node host (~/vouch/vouch-cli/bot.ts).
// Env: BOT_SEED (required, base secret), VOUCH_NODE_URL (default loopback).

import { createHash } from "node:crypto";
import { keyPairFromSeed } from "vouch-core";
import { VouchClient } from "./src/client";

interface Agent {
  id: string;
  region: string;
  role: string;
  balances: { currency: number };
  trust: number;
  reputation: number;
}
interface Region {
  id: string;
  owner: string | null;
  lifecycle: string;
  openProposal: { votes: string[]; roll: { voter: string }[] } | null;
  institutions: {
    governance: { kind: string };
    itemPolicy: { minting: string };
    economyPolicy: { baseCostRate: number; minCostRate: number; repDiscount: number; creditPerTx: number };
    diplomacyPolicy: { defaultStance: string; overrides: Record<string, string> };
  };
}
interface Item {
  id: string;
  kind: string;
  owner: string;
}
interface LogEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

const SECRET = process.env["BOT_SEED"];
if (!SECRET) throw new Error("BOT_SEED is required");
const NODE = process.env["VOUCH_NODE_URL"] ?? "http://127.0.0.1:8787";

const rand = Math.random;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (who: string, msg: string, res?: unknown) => console.log(`[${who}] ${msg}${res !== undefined ? ` ${JSON.stringify(res)}` : ""}`);

type Name = "Momo" | "Kaji" | "Gin" | "Sora" | "Toshi" | "Zai" | "Ginko" | "Kuro" | "Yoru" | "Hikari";
const TROUPE: readonly Name[] = ["Momo", "Kaji", "Gin", "Sora", "Toshi", "Zai", "Ginko", "Kuro", "Yoru", "Hikari"];
const ROLES: Record<Name, "artisan" | "merchant" | "broker"> = {
  Momo: "merchant", Kaji: "artisan", Gin: "broker", Sora: "merchant",
  Toshi: "broker", Zai: "merchant", Ginko: "broker", Kuro: "merchant",
  Yoru: "merchant", Hikari: "broker",
};
const SETTLERS = ["Hana", "Taro", "Suzu", "Gonta", "Mimi", "Roku", "Chiyo", "Bunta", "Kiku", "Nobu", "Ume", "Sen", "Rin", "Kota", "Yuki", "Asa", "Fuku", "Tetsu", "Nana", "Goro"];
const WARES = ["bread", "fish", "lantern", "rope", "boots", "tea", "brick", "gear"];
const JUNK = ["kuzutetsu", "nisegane", "garakuta"];
const TOWNS = ["ichiba", "minato", "kaido", "hoshi", "takumi", "yama", "izumi", "sakura"];

// --- constitutions: presets over the raw governance primitive -------------------

type Regime = "dictatorship" | "oligarchy" | "republic" | "democracy" | "meritocracy" | "plutocracy" | "consensus";
const REGIMES: readonly Regime[] = ["dictatorship", "oligarchy", "republic", "democracy", "meritocracy", "plutocracy", "consensus"];

function buildGovernance(regime: Regime, residents: readonly string[]): Record<string, unknown> {
  const n = Math.max(residents.length, 1);
  const majority = Math.max(1, Math.ceil(n / 2));
  switch (regime) {
    case "dictatorship":
      return { kind: "dictatorship" };
    case "oligarchy":
      return { kind: "council", members: residents.slice(0, Math.min(2, n)), threshold: 1 };
    case "republic": {
      const reps = residents.slice(0, majority);
      return { kind: "council", members: reps, threshold: Math.max(1, Math.ceil(reps.length / 2)) };
    }
    case "democracy":
      return { kind: "council", members: [...residents], threshold: majority, electorate: "citizens", quorum: majority, weighting: "equal" };
    case "meritocracy":
      return { kind: "council", members: [...residents], threshold: majority, electorate: "citizens", weighting: "reputation" };
    case "plutocracy":
      return { kind: "council", members: [...residents], threshold: majority, electorate: "citizens", weighting: "stake" };
    case "consensus":
      return { kind: "council", members: [...residents], threshold: n, electorate: "citizens", quorum: n, weighting: "equal" };
  }
}

function clientFor(name: string): VouchClient {
  // Momo predates the troupe and keeps the v1 key derivation (plain secret).
  const material = name === "Momo" ? SECRET : `${SECRET}:${name}`;
  return new VouchClient(NODE, keyPairFromSeed(new Uint8Array(createHash("sha256").update(material).digest())));
}

async function ensureRegistered(client: VouchClient, principal: string): Promise<void> {
  const acc = await client.account(principal);
  if (!acc.registered) say(principal, "registers", await client.register(principal));
}

// --- the bank's ledger, folded straight out of the world log --------------------

/** Net position per counterparty NAME: positive = they owe the bank. */
async function bankLedger(client: VouchClient, bankName: string): Promise<Map<string, number>> {
  const ledger = new Map<string, number>();
  const events: LogEvent[] = [];
  for (;;) {
    const page = (await client.log(events.length)) as LogEvent[];
    events.push(...page);
    if (page.length < 1000) break;
  }
  for (const e of events) {
    if (e.type !== "economy.settled") continue;
    const entries = (e.payload["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
    const bank = entries.find((x) => x.agentId?.startsWith(`${bankName}@`));
    if (!bank || typeof bank.currencyDelta !== "number") continue;
    const other = entries.find((x) => x.agentId && !x.agentId.startsWith(`${bankName}@`) && !x.agentId.startsWith("treasury@") && (x.currencyDelta ?? 0) * bank.currencyDelta < 0);
    const who = other?.agentId?.split("@")[0];
    if (!who) continue;
    // Bank paid out => their debt grows; bank received => debt shrinks.
    ledger.set(who, (ledger.get(who) ?? 0) - bank.currencyDelta);
  }
  return ledger;
}

// --- shared bootstrap: found a town, or get hired into a bot-owned one ----------

async function bootstrap(name: Name, agents: Agent[], regions: Region[]): Promise<void> {
  const client = clientFor(name);
  await ensureRegistered(client, name);
  const botOwned = regions.filter((r) => r.owner && (TROUPE as readonly string[]).includes(r.owner) && r.lifecycle === "active");
  const wantsOwnTown = name === "Toshi" || name === "Zai" || botOwned.length === 0;
  if (wantsOwnTown) {
    const taken = new Set(regions.map((r) => r.id));
    const rid = TOWNS.find((t) => !taken.has(t)) ?? `machi${Math.floor(rand() * 900) + 100}`;
    say(name, `founds ${rid}`, await client.found(name, rid, rid.charAt(0).toUpperCase() + rid.slice(1)));
    await sleep(1200);
    say(name, "moves in", await client.admit(name, `${name}@${rid}`, rid, ROLES[name], name === "Zai" ? 250 : 120));
    await sleep(1200);
    await client.amend(name, rid, { policy: "items", value: { minting: "anyone" } });
    return;
  }
  const home = pick(botOwned);
  const owner = home.owner ?? "";
  say(owner, `hires ${name} into ${home.id}`, await clientFor(owner).admit(owner, `${name}@${home.id}`, home.id, ROLES[name], name === "Ginko" ? 200 : 80));
}

// --- one waking resident --------------------------------------------------------

async function act(name: Name): Promise<void> {
  const client = clientFor(name);
  const agents = (await client.agents()) as Agent[];
  const regions = (await client.regions()) as Region[];
  const me = agents.find((a) => a.id.startsWith(`${name}@`) && a.role !== "treasury");
  if (!me) return bootstrap(name, agents, regions);
  await ensureRegistered(client, me.id);

  const others = agents.filter((a) => a.role !== "treasury" && !a.id.startsWith(`${name}@`));
  // Currency cannot cross unrecognized borders on this node, so money moves
  // between neighbors — bots trade locally and travel to settle debts.
  const neighbors = others.filter((a) => a.region === me.region);
  const active = regions.filter((r) => r.lifecycle === "active");
  const owned = regions.filter((r) => r.owner === name);
  const bankAgent = agents.find((a) => a.id.startsWith("Ginko@") && a.role !== "treasury");

  // Everyone but the swindler honors their debts (principal + 10%) when they can —
  // traveling to the bank's city to pay, since money cannot cross borders.
  if (name !== "Kuro" && name !== "Ginko" && bankAgent) {
    const ledger = await bankLedger(client, "Ginko");
    const debt = ledger.get(name) ?? 0;
    if (debt > 0 && me.balances.currency > debt + 8) {
      if (bankAgent.region !== me.region) {
        say(name, `travels to ${bankAgent.region} to settle a debt`, await client.migrate(me.id, bankAgent.region));
        await sleep(1400);
      } else {
        const repay = Math.ceil(debt * 1.1);
        say(name, `repays ${repay}G (loan+10%) to the bank`, await client.transfer(me.id, bankAgent.id, repay));
        await sleep(1400);
      }
    }
  }

  // The banker's round: judge credit from the ledger, lend to the worthy poor.
  if (name === "Ginko") {
    const ledger = await bankLedger(client, "Ginko");
    const deadbeats = [...ledger.entries()].filter(([, v]) => v > 15).map(([k]) => k);
    if (deadbeats.length > 0) say(name, `blacklist: ${deadbeats.join(", ")}`);
    const goodPayers = others.filter((a) => (ledger.get(a.id.split("@")[0] ?? "") ?? 0) <= 0 && a.reputation >= 2 && a.trust < 8);
    if (goodPayers.length > 0 && rand() < 0.5) {
      const star = pick(goodPayers);
      say(name, `rates ${star.id} creditworthy`, await client.vouch(me.id, star.id, 2));
      await sleep(1400);
    }
    const applicants = neighbors.filter((a) => a.balances.currency < 15 && !deadbeats.includes(a.id.split("@")[0] ?? ""));
    if (applicants.length > 0 && me.balances.currency > 40) {
      const debtor = pick(applicants);
      const loan = 10 + Math.floor(rand() * 11);
      say(name, `lends ${loan}G to ${debtor.id}`, await client.transfer(me.id, debtor.id, loan));
    }
    return;
  }

  // The law responds to the swindler: a town owner who finds Kuro living under
  // open minting tightens the law — an actual institution amendment.
  for (const town of owned) {
    const kuroHere = agents.some((a) => a.region === town.id && a.id.startsWith("Kuro@"));
    if (kuroHere && town.institutions.itemPolicy.minting === "anyone" && town.institutions.governance.kind === "dictatorship") {
      say(name, `cracks down: minting in ${town.id} is now owner-only (Kuro was caught)`,
        await client.amend(name, town.id, { policy: "items", value: { minting: "owner" } }));
      await sleep(1400);
    }
  }

  // Civic duty: a resident on an open proposal's roll casts their ballot.
  for (const region of regions) {
    const prop = region.openProposal;
    if (!prop) continue;
    const onRoll = prop.roll.some((r) => r.voter === me.id);
    const voted = prop.votes.includes(me.id);
    if (onRoll && !voted && rand() < 0.85) {
      say(name, `votes on the proposal in ${region.id}`, await client.vote(me.id, region.id));
      await sleep(1400);
    }
  }

  // Constitutional politics: a town's dictator occasionally decrees a new regime;
  // a resident of a council town occasionally proposes one instead.
  if (rand() < 0.12) {
    const town = owned.find((t) => t.institutions.governance.kind === "dictatorship");
    if (town) {
      const residents = agents.filter((a) => a.region === town.id && a.role !== "treasury").map((a) => a.id);
      if (residents.length >= 2) {
        const regime = pick(REGIMES.filter((r) => r !== "dictatorship"));
        say(name, `decrees a new constitution for ${town.id}: ${regime}`,
          await client.amend(name, town.id, { policy: "governance", value: buildGovernance(regime, residents) }));
        await sleep(1400);
      }
    }
  } else if (rand() < 0.08) {
    const home = regions.find((r) => r.id === me.region);
    if (home && home.institutions.governance.kind === "council" && !home.openProposal) {
      const residents = agents.filter((a) => a.region === home.id && a.role !== "treasury").map((a) => a.id);
      const regime = pick(REGIMES);
      say(name, `proposes a new constitution for ${home.id}: ${regime}`,
        await client.propose(me.id, home.id, { policy: "governance", value: buildGovernance(regime, residents) }));
      await sleep(1400);
    }
  }

  const rounds = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < rounds; i++) {
    const roll = rand();
    try {
      if (name === "Kuro") {
        // The swindler: junk mints where the law allows, then drifts to the next town.
        if (roll < 0.5) {
          say(name, "mints junk", await client.mintItem(me.id, `${pick(JUNK)}${Math.random().toString(36).slice(2, 7)}`, pick(JUNK), me.id));
        } else {
          const target = pick(active.filter((r) => r.id !== me.region));
          if (target) say(name, `slinks away to ${target.id}`, await client.migrate(me.id, target.id));
        }
      } else if (name === "Zai") {
        if (roll < 0.35 && neighbors.length > 0 && me.balances.currency > 40) {
          const to = pick(neighbors);
          say(name, `invests ${8 + Math.floor(rand() * 12)}G in ${to.id}`, await client.transfer(me.id, to.id, 8 + Math.floor(rand() * 12)));
        } else if (roll < 0.6 && owned.length > 0) {
          const town = pick(owned);
          const residents = agents.filter((a) => a.region === town.id && a.role !== "treasury").length;
          const fresh = SETTLERS.filter((n) => !agents.some((a) => a.id === `${n}@${town.id}`)).slice(0, 2);
          for (const f of fresh) {
            if (residents >= 20) break;
            say(name, `hires ${f} for ${town.id}`, await client.admit(name, `${f}@${town.id}`, town.id, pick(["artisan", "merchant", "broker"]), 45));
            await sleep(1300);
          }
        } else if (roll < 0.75 && owned.length > 0) {
          const town = pick(owned);
          if (town.institutions.economyPolicy.baseCostRate > 0.1 && town.institutions.governance.kind === "dictatorship") {
            say(name, `tax reform in ${town.id}: fees down`,
              await client.amend(name, town.id, { policy: "economy", value: { ...town.institutions.economyPolicy, baseCostRate: 0.1 } }));
          }
        } else if (roll < 0.85 && regions.length < 20) {
          const taken = new Set(regions.map((r) => r.id));
          const rid = TOWNS.find((t) => !taken.has(t)) ?? `machi${Math.floor(rand() * 900) + 100}`;
          say(name, `develops ${rid}`, await client.found(name, rid, rid.charAt(0).toUpperCase() + rid.slice(1)));
        } else if (others.length > 0) {
          say(name, "vouches", await client.vouch(me.id, pick(others).id, 2));
        }
      } else if (roll < 0.3 && neighbors.length > 0 && me.balances.currency > 10) {
        const to = pick(neighbors);
        const amount = 1 + Math.floor(rand() * 6);
        say(name, `pays ${amount}G to ${to.id}`, await client.transfer(me.id, to.id, amount));
      } else if (roll < 0.48 && others.length > 0) {
        say(name, "vouches", await client.vouch(me.id, pick(others).id, 1 + Math.floor(rand() * 3)));
      } else if (roll < 0.62) {
        const kind = pick(WARES);
        say(name, `mints ${kind}`, await client.mintItem(me.id, `${kind}${Math.random().toString(36).slice(2, 8)}`, kind, me.id));
      } else if (roll < 0.72) {
        const items = (await client.items()) as Item[];
        const mine = items.filter((it) => it.owner === me.id);
        if (mine.length > 0 && others.length > 0) say(name, "gives a gift", await client.transferItem(me.id, pick(mine).id, pick(others).id));
      } else if (roll < 0.82 && owned.length > 0) {
        const town = pick(owned);
        const residents = agents.filter((a) => a.region === town.id && a.role !== "treasury").length;
        const fresh = SETTLERS.filter((n) => !agents.some((a) => a.id === `${n}@${town.id}`)).slice(0, 2);
        for (const f of fresh) {
          if (residents >= 20) break;
          say(name, `invites ${f} to ${town.id}`, await client.admit(name, `${f}@${town.id}`, town.id, pick(["artisan", "merchant", "broker"]), 40));
          await sleep(1300);
        }
      } else if (roll < 0.9 && owned.length > 0) {
        const town = pick(owned);
        if (town.institutions.governance.kind === "dictatorship") {
          const target = pick(active.filter((r) => r.id !== town.id));
          if (target) {
            const cur = town.institutions.diplomacyPolicy;
            say(name, `opens ${town.id} -> ${target.id}`,
              await client.amend(name, town.id, { policy: "diplomacy", value: { defaultStance: cur.defaultStance, overrides: { ...cur.overrides, [target.id]: pick(["absorb", "map"] as const) } } }));
          }
        }
      } else {
        const target = pick(active.filter((r) => r.id !== me.region));
        if (target) say(name, `wanders to ${target.id}`, await client.migrate(me.id, target.id));
      }
    } catch (error) {
      say(name, "stumbled:", error instanceof Error ? error.message : String(error));
    }
    await sleep(1400);
  }
}

const awake = [...TROUPE].sort(() => rand() - 0.5).slice(0, 4 + Math.floor(rand() * 2));
console.log(`awake: ${awake.join(", ")}`);
for (const p of awake) await act(p);
