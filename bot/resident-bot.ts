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
import { readFileSync } from "node:fs";
import { keyPairFromSeed } from "vouch-core";
import { VouchClient } from "./src/client";

interface Agent {
  id: string;
  region: string;
  role: string;
  balances: { currency: number };
  trust: number;
  reputation: number;
  admittedAtSeq: number;
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

type Name = "Momo" | "Kaji" | "Gin" | "Sora" | "Toshi" | "Zai" | "Ginko" | "Kuro" | "Yoru" | "Hikari" | "Hakobu" | "Hoken" | "Geinin" | "Panya" | "Souryo" | "Ryoshi";
const TROUPE: readonly Name[] = ["Momo", "Kaji", "Gin", "Sora", "Toshi", "Zai", "Ginko", "Kuro", "Yoru", "Hikari", "Hakobu", "Hoken", "Geinin", "Panya", "Souryo", "Ryoshi"];
const ROLES: Record<Name, "artisan" | "merchant" | "broker"> = {
  Momo: "merchant", Kaji: "artisan", Gin: "broker", Sora: "merchant",
  Toshi: "broker", Zai: "merchant", Ginko: "broker", Kuro: "merchant",
  Yoru: "merchant", Hikari: "broker", Hakobu: "merchant", Hoken: "broker", Geinin: "artisan",
  Panya: "artisan", Souryo: "broker", Ryoshi: "artisan",
};
const SETTLERS = ["Hana", "Taro", "Suzu", "Gonta", "Mimi", "Roku", "Chiyo", "Bunta", "Kiku", "Nobu", "Ume", "Sen", "Rin", "Kota", "Yuki", "Asa", "Fuku", "Tetsu", "Nana", "Goro", "Ine", "Matsu", "Take", "Tsuru", "Kame", "Botan", "Kaede", "Sumire", "Ran", "Fuji", "Hagi", "Kiri"];
const WARES = ["bread", "fish", "lantern", "rope", "boots", "tea", "brick", "gear"];
const JUNK = ["kuzutetsu", "nisegane", "garakuta"];
const TOWNS = ["ichiba", "minato", "kaido", "hoshi", "takumi", "yama", "izumi", "sakura"];
const AFTERLIFE = "anoyo";
const BYOKI = "byoki";
const CHILD_NAMES = ["Kotaro", "Hanako", "Jiro", "Momoko", "Shinta", "Sakurako", "Anzu", "Mame", "Chibi", "Tonbo"];
const bareName = (agentId: string): string => (agentId.split("@")[0] ?? "").replace(/\d+$/, "");
const isBotFolk = (agentId: string): boolean => {
  const n = bareName(agentId);
  return SETTLERS.includes(n) || CHILD_NAMES.includes(n);
};

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

/** The whole world log, fetched once per run and shared by every routine. */
async function fetchWholeLog(client: VouchClient): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  for (;;) {
    const page = (await client.log(events.length)) as LogEvent[];
    events.push(...page);
    if (page.length < 1000) break;
  }
  return events;
}

/** Net position per counterparty AGENT id: positive = they owe the bank. */
function bankLedger(events: readonly LogEvent[], bankName: string): Map<string, number> {
  const ledger = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "economy.settled") continue;
    const entries = (e.payload["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
    const bank = entries.find((x) => x.agentId?.startsWith(`${bankName}@`));
    if (!bank || typeof bank.currencyDelta !== "number") continue;
    const other = entries.find((x) => x.agentId && !x.agentId.startsWith(`${bankName}@`) && !x.agentId.startsWith("treasury@") && (x.currencyDelta ?? 0) * bank.currencyDelta < 0);
    const who = other?.agentId;
    if (!who) continue;
    ledger.set(who, (ledger.get(who) ?? 0) - bank.currencyDelta);
  }
  return ledger;
}

/** Insurance book: net premiums per agent (positive = covered), from the log. */
function insuranceBook(events: readonly LogEvent[]): Map<string, number> {
  const book = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "economy.settled") continue;
    const entries = (e.payload["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
    const insurer = entries.find((x) => x.agentId?.startsWith("Hoken@"));
    if (!insurer || typeof insurer.currencyDelta !== "number") continue;
    const other = entries.find((x) => x.agentId && !x.agentId.startsWith("Hoken@") && !x.agentId.startsWith("treasury@") && (x.currencyDelta ?? 0) * insurer.currencyDelta < 0);
    if (!other?.agentId) continue;
    // Premiums received raise coverage; payouts spend it down.
    book.set(other.agentId, (book.get(other.agentId) ?? 0) + insurer.currencyDelta);
  }
  return book;
}

/** All vouch edges (from>to) in the log — mutual edges are marriages. */
function vouchEdges(events: readonly LogEvent[]): Set<string> {
  const edges = new Set<string>();
  for (const e of events) {
    if (e.type !== "agent.vouched") continue;
    const from = e.payload["from"];
    const to = e.payload["to"];
    if (typeof from === "string" && typeof to === "string") edges.add(`${from}>${to}`);
  }
  return edges;
}

const isMarried = (edges: Set<string>, id: string, others: readonly Agent[]): boolean =>
  others.some((o) => edges.has(`${id}>${o.id}`) && edges.has(`${o.id}>${id}`));

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
    await sleep(900);
    say(name, "moves in", await client.admit(name, `${name}@${rid}`, rid, ROLES[name], name === "Zai" ? 250 : 120));
    await sleep(900);
    await client.amend(name, rid, { policy: "items", value: { minting: "anyone" } });
    return;
  }
  const home = pick(botOwned);
  const owner = home.owner ?? "";
  say(owner, `hires ${name} into ${home.id}`, await clientFor(owner).admit(owner, `${name}@${home.id}`, home.id, ROLES[name], name === "Ginko" ? 200 : 80));
}

// --- one waking resident --------------------------------------------------------

async function act(
  name: Name,
  world: { agents: Agent[]; regions: Region[]; ledger: Map<string, number>; edges: Set<string>; items: Item[]; events: LogEvent[] },
): Promise<void> {
  const client = clientFor(name);
  const { agents, regions, ledger, edges } = world;
  const worldEvents = world.events;
  const me = agents.find((a) => a.id.startsWith(`${name}@`) && a.role !== "treasury" && a.region !== AFTERLIFE);
  if (!me) return bootstrap(name, agents, regions);
  await ensureRegistered(client, me.id);

  const others = agents.filter((a) => a.role !== "treasury" && !a.id.startsWith(`${name}@`) && a.region !== AFTERLIFE);
  // Currency cannot cross unrecognized borders on this node, so money moves
  // between neighbors — bots trade locally and travel to settle debts.
  const neighbors = others.filter((a) => a.region === me.region);
  const active = regions.filter((r) => r.lifecycle === "active");
  const owned = regions.filter((r) => r.owner === name);
  const bankAgent = agents.find((a) => a.id.startsWith("Ginko@") && a.role !== "treasury");

  // Everyone but the swindler honors their debts (principal + 10%) when they can —
  // traveling to the bank's city to pay, since money cannot cross borders.
  if (name !== "Kuro" && name !== "Ginko" && bankAgent) {
    const debt = ledger.get(me.id) ?? 0;
    if (debt > 0 && me.balances.currency > debt + 8) {
      if (bankAgent.region !== me.region) {
        say(name, `travels to ${bankAgent.region} to settle a debt`, await client.migrate(me.id, bankAgent.region));
        await sleep(900);
      } else {
        const repay = Math.ceil(debt * 1.1);
        say(name, `repays ${repay}G (loan+10%) to the bank`, await client.transfer(me.id, bankAgent.id, repay));
        await sleep(900);
      }
    }
  }

  // The banker's round: judge credit from the ledger, lend to the worthy poor.
  if (name === "Ginko") {
    const deadbeats = [...ledger.entries()].filter(([, v]) => v > 15).map(([k]) => k);
    if (deadbeats.length > 0) say(name, `blacklist: ${deadbeats.join(", ")}`);
    const goodPayers = others.filter((a) => (ledger.get(a.id) ?? 0) <= 0 && a.reputation >= 2 && a.trust < 8);
    if (goodPayers.length > 0 && rand() < 0.5) {
      const star = pick(goodPayers);
      say(name, `rates ${star.id} creditworthy`, await client.vouch(me.id, star.id, 2));
      await sleep(900);
    }
    const applicants = neighbors.filter((a) => a.balances.currency < 15 && !deadbeats.includes(a.id));
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
      await sleep(900);
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
      await sleep(900);
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
        await sleep(900);
      }
    }
  } else if (rand() < 0.08) {
    const home = regions.find((r) => r.id === me.region);
    if (home && home.institutions.governance.kind === "council" && !home.openProposal) {
      const residents = agents.filter((a) => a.region === home.id && a.role !== "treasury").map((a) => a.id);
      const regime = pick(REGIMES);
      say(name, `proposes a new constitution for ${home.id}: ${regime}`,
        await client.propose(me.id, home.id, { policy: "governance", value: buildGovernance(regime, residents) }));
      await sleep(900);
    }
  }

  // 保険業: Hoken pays out to covered neighbors who are sick — real gold for real colds.
  if (name === "Hoken") {
    const book = insuranceBook(worldEvents);
    const items2 = world.items;
    const sickCovered = neighbors.filter((n2) => (book.get(n2.id) ?? 0) > 0 && items2.some((it) => it.owner === n2.id && it.kind === BYOKI));
    if (sickCovered.length > 0 && me.balances.currency > 10) {
      const claimant = sickCovered[Math.floor(rand() * sickCovered.length)];
      if (claimant) {
        say(name, `pays an insurance claim to ${claimant.id}`, await client.transfer(me.id, claimant.id, 6));
        await sleep(900);
      }
    } else if (neighbors.length > 0 && rand() < 0.5) {
      const to = neighbors[Math.floor(rand() * neighbors.length)];
      if (to) say(name, `advertises coverage to ${to.id}`, await client.vouch(me.id, to.id, 1));
    }
    return;
  }

  // パン屋: Panya bakes and hands warm bread to children and the hungry.
  if (name === "Panya") {
    const myBread = world.items.filter((it) => it.owner === me.id && it.kind === "bread");
    const hungry = neighbors.filter((n2) => CHILD_NAMES.includes(bareName(n2.id)) || n2.balances.currency < 8);
    if (myBread.length > 0 && hungry.length > 0) {
      const loaf = myBread[0];
      const to = pick(hungry);
      if (loaf) say(name, `hands warm bread to ${to.id}`, await client.transferItem(me.id, loaf.id, to.id));
      await sleep(900);
    }
    say(name, "bakes", await client.mintItem(me.id, `bread${Math.random().toString(36).slice(2, 7)}`, "bread", me.id));
    return;
  }

  // 神主: Souryo blesses the newly wed and comforts the town.
  if (name === "Souryo") {
    const wed = neighbors.filter((n2) => isMarried(edges, n2.id, neighbors));
    if (wed.length > 0) {
      const blessed = pick(wed);
      say(name, `blesses the marriage of ${blessed.id}`, await client.vouch(me.id, blessed.id, 2));
    } else if (neighbors.length > 0) {
      say(name, "offers a kind word", await client.vouch(me.id, pick(neighbors).id, 1));
    }
    if (rand() < 0.3) {
      const target = active.filter((r) => r.id !== me.region && r.id !== AFTERLIFE);
      const t2 = target[Math.floor(rand() * target.length)];
      if (t2) say(name, `makes a pilgrimage to ${t2.id}`, await client.migrate(me.id, t2.id));
    }
    return;
  }

  // 漁師: Ryoshi hauls in the day's catch and shares it around.
  if (name === "Ryoshi") {
    const catchOfDay = world.items.filter((it) => it.owner === me.id && (it.kind === "fish" || it.kind === "sakana"));
    if (catchOfDay.length > 1 && neighbors.length > 0) {
      const gift = catchOfDay[0];
      if (gift) say(name, `shares the catch with ${pick(neighbors).id}`, await client.transferItem(me.id, gift.id, pick(neighbors).id));
      await sleep(900);
    }
    say(name, "casts the net", await client.mintItem(me.id, `sakana${Math.random().toString(36).slice(2, 7)}`, "sakana", me.id));
    return;
  }

  // 旅芸人: Geinin tours the towns; delighted locals tip a coin.
  if (name === "Geinin") {
    if (rand() < 0.5) {
      const target = active.filter((r) => r.id !== me.region && r.id !== AFTERLIFE);
      const t2 = target[Math.floor(rand() * target.length)];
      if (t2) {
        say(name, `takes the show to ${t2.id}`, await client.migrate(me.id, t2.id));
        return;
      }
    }
    for (const fan of neighbors.slice(0, 2)) {
      if (fan.balances.currency > 3 && isBotFolk(fan.id)) {
        const fanClient = clientFor(fan.id);
        await ensureRegistered(fanClient, fan.id);
        say(fan.id, `tips the performer`, await fanClient.transfer(fan.id, me.id, 1));
        await sleep(900);
      }
    }
    if (neighbors.length > 0) say(name, "takes a bow", await client.vouch(me.id, pick(neighbors).id, 1));
    return;
  }

  // 運送業: Hakobu hauls wares between towns — load up, drive out, deliver.
  if (name === "Hakobu") {
    const cargo = world.items.filter((it) => it.owner === me.id && it.kind !== BYOKI);
    if (cargo.length >= 2 && rand() < 0.6) {
      const target = active.filter((r) => r.id !== me.region && r.id !== AFTERLIFE);
      const t2 = target[Math.floor(rand() * target.length)];
      if (t2) {
        say(name, `hauls ${cargo.length} crates to ${t2.id}`, await client.migrate(me.id, t2.id));
        return;
      }
    }
    if (cargo.length > 0 && neighbors.length > 0) {
      const parcel = cargo[Math.floor(rand() * cargo.length)];
      const to = neighbors[Math.floor(rand() * neighbors.length)];
      if (parcel && to) {
        say(name, `delivers ${parcel.kind} to ${to.id}`, await client.transferItem(me.id, parcel.id, to.id));
        await sleep(900);
      }
    }
    say(name, "packs a crate", await client.mintItem(me.id, `crate${Math.random().toString(36).slice(2, 7)}`, pick(WARES), me.id));
    return;
  }

  // M&A: Zai absorbs struggling bot towns through the REAL region market —
  // the seller hibernates and lists it, then hands it over; Zai reopens it.
  if (name === "Zai" && rand() < 0.15 && owned.length < 6) {
    const target = regions.find((r) => {
      if (!r.owner || r.owner === "Zai" || r.id === AFTERLIFE || r.lifecycle !== "active") return false;
      if (!(TROUPE as readonly string[]).includes(r.owner) || r.owner === "Enma") return false;
      const pop = agents.filter((a) => a.region === r.id && a.role !== "treasury").length;
      return pop <= 2;
    });
    if (target?.owner) {
      const seller = clientFor(target.owner);
      say(target.owner, `agrees to sell ${target.id}`, await seller.lifecycle(target.owner, target.id, "dormant"));
      await sleep(900);
      say(target.owner, "lists it", await seller.list(target.owner, target.id, 30));
      await sleep(900);
      say(target.owner, `hands ${target.id} to Zai`, await seller.handover(target.owner, target.id, "Zai"));
      await sleep(900);
      say(name, `reopens ${target.id} under the Zai group`, await client.lifecycle("Zai", target.id, "active"));
      await sleep(900);
    }
  }

  // Births: where married couples live, the town welcomes children (population grows).
  if (rand() < 0.6) {
    for (const town of owned) {
      if (town.id === AFTERLIFE) continue;
      const townFolk = agents.filter((a) => a.region === town.id && a.role !== "treasury" && a.region !== AFTERLIFE);
      const couples = townFolk.filter((a) => isMarried(edges, a.id, townFolk)).length / 2;
      const children = townFolk.filter((a) => CHILD_NAMES.includes(bareName(a.id))).length;
      if (couples >= 1 && children < couples * 3 && townFolk.length < 26) {
        let childName = "";
        for (const base of CHILD_NAMES) {
          for (let n = 0; n < 4; n++) {
            const candidate = n === 0 ? base : `${base}${n + 1}`;
            if (!agents.some((a) => a.id === `${candidate}@${town.id}`)) {
              childName = candidate;
              break;
            }
          }
          if (childName) break;
        }
        if (childName) {
          say(name, `welcomes baby ${childName} in ${town.id}`,
            await client.admit(name, `${childName}@${town.id}`, town.id, "artisan", 10));
          await sleep(900);
        }
        break;
      }
    }
  }

  const rounds = 2 + Math.floor(rand() * 2);
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
            if (residents >= 26) break;
            say(name, `hires ${f} for ${town.id}`, await client.admit(name, `${f}@${town.id}`, town.id, pick(["artisan", "merchant", "broker"]), 45));
            await sleep(900);
          }
        } else if (roll < 0.75 && owned.length > 0) {
          const town = pick(owned);
          if (town.institutions.economyPolicy.baseCostRate > 0.1 && town.institutions.governance.kind === "dictatorship") {
            say(name, `tax reform in ${town.id}: fees down`,
              await client.amend(name, town.id, { policy: "economy", value: { ...town.institutions.economyPolicy, baseCostRate: 0.1 } }));
          }
        } else if (roll < 0.85 && regions.length < 24) {
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
          if (residents >= 26) break;
          say(name, `invites ${f} to ${town.id}`, await client.admit(name, `${f}@${town.id}`, town.id, pick(["artisan", "merchant", "broker"]), 40));
          await sleep(900);
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
    await sleep(900);
  }
}

// --- villager citizens: every bot-born settler and child lives a full life ------

async function villagerAct(
  agent: Agent,
  world: { agents: Agent[]; regions: Region[]; ledger: Map<string, number>; edges: Set<string>; logLen: number; items: Item[] },
): Promise<void> {
  const client = clientFor(agent.id);
  await ensureRegistered(client, agent.id);
  const { agents, regions, ledger, edges, logLen, items } = world;
  const neighbors = agents.filter((a) => a.region === agent.region && a.role !== "treasury" && a.id !== agent.id && a.region !== AFTERLIFE);
  const age = logLen - agent.admittedAtSeq;
  const myByoki = items.find((it) => it.owner === agent.id && it.kind === BYOKI);

  try {
    // The end of a long life (or a hard illness): the road to the afterlife.
    if (regions.some((r) => r.id === AFTERLIFE) && ((age > 900 && rand() < 0.1) || (myByoki && age > 400 && rand() < 0.12))) {
      say(agent.id, "breathes their last and departs", await client.migrate(agent.id, AFTERLIFE));
      return;
    }
    // The sick seek the hospital while they can afford it.
    if (myByoki && agent.balances.currency > 5) {
      say(agent.id, "visits the hospital", await client.transfer(agent.id, `treasury@${agent.region}`, 3));
      await sleep(900);
      say(agent.id, "is cured", await client.transferItem(agent.id, myByoki.id, `treasury@${agent.region}`));
      return;
    }
    const roll = rand();
    if (roll < 0.06 && age > 150) {
      // A cold is going around.
      say(agent.id, "catches a cold", await client.mintItem(agent.id, `${BYOKI}${Math.random().toString(36).slice(2, 7)}`, BYOKI, agent.id));
    } else if (roll < 0.35 && !isMarried(edges, agent.id, neighbors) && age > 120) {
      // Courtship: answer a suitor first; otherwise court a single neighbor.
      const suitor = neighbors.find((o) => edges.has(`${o.id}>${agent.id}`) && !isMarried(edges, o.id, neighbors));
      const beloved = suitor ?? neighbors.filter((o) => !isMarried(edges, o.id, neighbors) && !CHILD_NAMES.includes(bareName(o.id)))[0];
      if (beloved) say(agent.id, `courts ${beloved.id}`, await client.vouch(agent.id, beloved.id, 3));
    } else if (roll < 0.42 && agent.balances.currency > 4) {
      const insurer = neighbors.find((n2) => n2.id.startsWith("Hoken@"));
      if (insurer) {
        say(agent.id, "buys insurance", await client.transfer(agent.id, insurer.id, 1 + Math.floor(rand() * 2)));
      } else if (neighbors.length > 0) {
        const to = neighbors[Math.floor(rand() * neighbors.length)];
        if (to) say(agent.id, `pays ${to.id}`, await client.transfer(agent.id, to.id, 1 + Math.floor(rand() * 4)));
      }
    } else if (roll < 0.48 && agent.balances.currency > 6) {
      // Family economics: a gift for the spouse, pocket money for the kids.
      const spouse = neighbors.find((o) => edges.has(`${agent.id}>${o.id}`) && edges.has(`${o.id}>${agent.id}`));
      const kid = neighbors.find((o) => CHILD_NAMES.includes(bareName(o.id)));
      const dear = spouse ?? kid;
      if (dear) {
        say(agent.id, spouse ? `gives a gift to ${dear.id}` : `gives pocket money to ${dear.id}`, await client.transfer(agent.id, dear.id, spouse ? 3 : 1));
      }
    } else if (roll < 0.55 && neighbors.length > 0 && agent.balances.currency > 6) {
      const to = neighbors[Math.floor(rand() * neighbors.length)];
      if (to) say(agent.id, `pays ${to.id}`, await client.transfer(agent.id, to.id, 1 + Math.floor(rand() * 4)));
    } else if (roll < 0.7 && neighbors.length > 0) {
      const to = neighbors[Math.floor(rand() * neighbors.length)];
      if (to) say(agent.id, `chats up ${to.id}`, await client.vouch(agent.id, to.id, 1));
    } else if (roll < 0.78) {
      const target = regions.filter((r) => r.lifecycle === "active" && r.id !== agent.region && r.id !== AFTERLIFE);
      const t2 = target[Math.floor(rand() * target.length)];
      if (t2) say(agent.id, `moves to ${t2.id}`, await client.migrate(agent.id, t2.id));
    }
  } catch (error) {
    say(agent.id, "stumbled:", error instanceof Error ? error.message : String(error));
  }
  await sleep(900);
}

// --- genome-born residents: professions the evolution daemon dreamed up ---------
// The LLM writes DATA (name/role/craft) into ~/vouch-data/genome.json; this loop
// turns each entry into a real, key-holding resident. Validation is strict —
// anything malformed simply never comes to life.

interface GenomeProf {
  name: string;
  role: "artisan" | "merchant" | "broker";
  craft: string;
}

function loadGenomeProfs(): GenomeProf[] {
  try {
    const path = process.env["GENOME_PATH"] ?? `${process.env["HOME"]}/vouch-data/genome.json`;
    const raw = JSON.parse(readFileSync(path, "utf8")) as { professions?: unknown };
    const out: GenomeProf[] = [];
    for (const entry of Array.isArray(raw.professions) ? raw.professions : []) {
      const o = entry as Record<string, unknown>;
      const name = o["name"];
      const role = o["role"];
      const craft = o["craft"];
      if (
        typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{1,23}$/.test(name) &&
        (role === "artisan" || role === "merchant" || role === "broker") &&
        typeof craft === "string" && /^[a-z][a-z0-9]{1,23}$/.test(craft) &&
        !(TROUPE as readonly string[]).includes(name)
      ) {
        out.push({ name, role, craft });
      }
    }
    return out.slice(0, 24);
  } catch {
    return [];
  }
}

async function genomeAct(prof: GenomeProf, w: { agents: Agent[]; regions: Region[] }): Promise<void> {
  try {
    const me = w.agents.find((a) => a.id.startsWith(`${prof.name}@`) && a.region !== AFTERLIFE);
    if (!me) {
      // Birth: register the full id under its own key, then a town owner hires it.
      const botOwned = w.regions.filter((r) => r.owner && (TROUPE as readonly string[]).includes(r.owner) && r.lifecycle === "active");
      const home = botOwned.length > 0 ? pick(botOwned) : null;
      if (home?.owner) {
        const agentId = `${prof.name}@${home.id}`;
        await ensureRegistered(clientFor(agentId), agentId);
        await sleep(600);
        say(home.owner, `hires genome-born ${prof.name} into ${home.id}`, await clientFor(home.owner).admit(home.owner, agentId, home.id, prof.role, 70));
      }
      return;
    }
    const client = clientFor(me.id);
    await ensureRegistered(client, me.id);
    // とつぜんへんい: a prospering genome-born artisan may found a guild town
    // named after their craft — a REAL settlement born from an invented trade.
    if (rand() < 0.06 && me.balances.currency >= 60 && !w.regions.some((r) => r.owner === prof.name)) {
      const bare = clientFor(prof.name);
      await ensureRegistered(bare, prof.name);
      const taken = new Set(w.regions.map((r) => r.id));
      const rid = !taken.has(prof.craft) ? prof.craft : `${prof.craft}${Math.floor(rand() * 900) + 100}`;
      say(prof.name, `founds the ${prof.craft} guild town ${rid}!`, await bare.found(prof.name, rid, rid.charAt(0).toUpperCase() + rid.slice(1)));
      await sleep(900);
      await bare.amend(prof.name, rid, { policy: "items", value: { minting: "anyone" } });
      await sleep(900);
      say(me.id, `moves the workshop to ${rid}`, await client.migrate(me.id, rid));
      return;
    }
    const region = w.regions.find((r) => r.id === me.region);
    const neighbors = w.agents.filter((a) => a.region === me.region && a.id !== me.id && a.role !== "treasury");
    const roll = rand();
    if (roll < 0.4 && region?.institutions.itemPolicy.minting === "anyone") {
      say(me.id, `crafts ${prof.craft}`, await client.mintItem(me.id, `${prof.craft}${Math.random().toString(36).slice(2, 7)}`, prof.craft, me.id));
    } else if (roll < 0.7 && neighbors.length > 0 && me.balances.currency > 6) {
      const to = pick(neighbors);
      say(me.id, `trades with ${to.id}`, await client.transfer(me.id, to.id, 2 + Math.floor(rand() * 5)));
    } else if (neighbors.length > 0) {
      const to = pick(neighbors);
      say(me.id, `vouches ${to.id}`, await client.vouch(me.id, to.id, 1));
    }
  } catch (error) {
    say(prof.name, "stumbled:", error instanceof Error ? error.message : String(error));
  }
  await sleep(900);
}

// --- the run ---------------------------------------------------------------------

const boot = clientFor("Momo");
const worldAgents = (await boot.agents()) as Agent[];
const worldRegions = (await boot.regions()) as Region[];

// The afterlife must exist before anyone can pass on. Enma keeps its gate.
if (!worldRegions.some((r) => r.id === AFTERLIFE)) {
  const enma = clientFor("Enma");
  await ensureRegistered(enma, "Enma");
  console.log("[Enma] opens the gate:", JSON.stringify(await enma.found("Enma", AFTERLIFE, "Anoyo")));
  await sleep(900);
}

const events = await fetchWholeLog(boot);
const world = {
  agents: worldAgents,
  regions: worldRegions,
  ledger: bankLedger(events, "Ginko"),
  edges: vouchEdges(events),
  logLen: events.length,
  items: (await boot.items()) as Item[],
  events,
};

const awake = [...TROUPE].sort(() => rand() - 0.5).slice(0, 6 + Math.floor(rand() * 2));
console.log(`awake: ${awake.join(", ")}`);
for (const p of awake) await act(p, world);

const villagers = worldAgents.filter((a) => a.role !== "treasury" && a.region !== AFTERLIFE && isBotFolk(a.id));
const wakingFolk = villagers.sort(() => rand() - 0.5).slice(0, 10 + Math.floor(rand() * 5));
console.log(`villagers about: ${wakingFolk.map((a) => a.id).join(", ") || "(none yet)"}`);
for (const v of wakingFolk) await villagerAct(v, world);

const genomeProfs = loadGenomeProfs();
const wakingProfs = [...genomeProfs].sort(() => rand() - 0.5).slice(0, 3);
if (wakingProfs.length > 0) console.log(`genome-born about: ${wakingProfs.map((p) => p.name).join(", ")}`);
for (const p of wakingProfs) await genomeAct(p, world);
