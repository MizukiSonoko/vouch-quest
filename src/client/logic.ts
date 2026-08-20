// Game actions → signed vouch commands, now entirely in the browser. The command
// payload shapes are ported verbatim from vouch-cli's VouchClient conveniences.
// Principal selection is the game's one rule of its own:
//   owner actions (found / admit / mint / amend / market) → the hero name
//   agent actions (transfer / vouch / migrate / items / vote) → `hero@region`

import { z } from "zod";
import type { ActResult, AgentView, ItemView, MeView, RegionView, Snapshot } from "../shared";
import { buildGovernance, type Regime, REGIMES } from "./politics";
import { wareByKind } from "./shop";
import { account, type BrowserWallet, reads, register, submit, type SubmitResult } from "./wire";

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "name must be letters then alphanumerics").max(64);
const regionId = z.string().regex(/^[a-z0-9]+$/, "region id must be lowercase alphanumerics").max(63);
const identifier = z.string().min(1).max(192);

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transfer"), to: identifier, amount: z.number().int().positive() }),
  z.object({ kind: z.literal("vouch"), to: identifier, weight: z.number().int().min(1).max(5) }),
  z.object({ kind: z.literal("transferItem"), itemId: z.string().min(1).max(64), to: identifier }),
  z.object({ kind: z.literal("migrate"), toRegion: regionId }),
  z.object({ kind: z.literal("vote"), regionId }),
  z.object({ kind: z.literal("found"), regionId, displayName: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("admit"),
    agentName: name,
    region: regionId,
    role: z.enum(["artisan", "merchant", "broker"]),
    currency: z.number().int().nonnegative().max(10_000).optional(),
  }),
  z.object({ kind: z.literal("mintItem"), itemKind: z.string().min(1).max(32), owner: identifier }),
  z.object({ kind: z.literal("amendMinting"), regionId, minting: z.enum(["owner", "anyone"]) }),
  z.object({ kind: z.literal("amendGovernance"), regionId, regime: z.enum(REGIMES as [Regime, ...Regime[]]) }),
  z.object({ kind: z.literal("buyItem"), regionId, ware: z.string().min(1).max(32), price: z.number().int().min(1).max(1000).optional() }),
  z.object({ kind: z.literal("forage"), itemKind: z.string().regex(/^[a-z]+$/).max(32) }),
  z.object({ kind: z.literal("amendDiplomacy"), regionId, target: regionId, stance: z.enum(["absorb", "map", "reexamine", "reject"]) }),
  z.object({ kind: z.literal("proposeDiplomacy"), regionId, target: regionId, stance: z.enum(["absorb", "map", "reexamine", "reject"]) }),
  z.object({ kind: z.literal("proposeMinting"), regionId, minting: z.enum(["owner", "anyone"]) }),
  z.object({ kind: z.literal("proposeGovernance"), regionId, regime: z.enum(REGIMES as [Regime, ...Regime[]]) }),
  z.object({ kind: z.literal("listRegion"), regionId, price: z.number().int().min(0).max(100_000).nullable() }),
  z.object({ kind: z.literal("handoverRegion"), regionId, to: name }),
  z.object({ kind: z.literal("lifecycleRegion"), regionId, lifecycle: z.enum(["active", "dormant"]) }),
  z.object({ kind: z.literal("buyRegion"), regionId, ownerAgent: identifier, price: z.number().int().positive() }),
  z.object({ kind: z.literal("amendEconomy"), regionId, baseCostRate: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("proposeEconomy"), regionId, baseCostRate: z.number().min(0).max(1) }),
]);

export type Action = z.infer<typeof actionSchema>;

export function findHeroAgent(agents: readonly AgentView[], heroName: string): AgentView | null {
  return agents.find((a) => a.id.startsWith(`${heroName}@`) && a.role !== "treasury") ?? null;
}

/** A short unique item id: kind prefix + base36 randomness (uniqueness, not security). */
export function newItemId(itemKind: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${itemKind.toLowerCase().replace(/[^a-z0-9]/g, "")}${suffix}`;
}

async function ensureRegistered(wallet: BrowserWallet, principal: string): Promise<ActResult | null> {
  const state = await account(principal);
  if (state.registered) return null;
  const res = await register(wallet, principal);
  return res.ok ? null : { ok: false, reason: `register ${principal}: ${res.reason}` };
}

function fromSubmit(res: SubmitResult): ActResult {
  return res.ok ? { ok: true, detail: res.detail } : { ok: false, reason: res.reason };
}

interface Hero {
  readonly heroName: string;
  readonly agentId: string | null;
}

async function asAgent(wallet: BrowserWallet, hero: Hero, command: (agentId: string) => unknown): Promise<ActResult> {
  if (!hero.agentId) return { ok: false, reason: "no-agent: found or join a village first" };
  const reg = await ensureRegistered(wallet, hero.agentId);
  if (reg) return reg;
  return fromSubmit(await submit(wallet, hero.agentId, command(hero.agentId)));
}

async function asOwner(wallet: BrowserWallet, hero: Hero, command: unknown): Promise<ActResult> {
  const reg = await ensureRegistered(wallet, hero.heroName);
  if (reg) return reg;
  return fromSubmit(await submit(wallet, hero.heroName, command));
}

export async function dispatchAction(wallet: BrowserWallet, hero: Hero, action: Action): Promise<ActResult> {
  switch (action.kind) {
    case "transfer":
      return asAgent(wallet, hero, (agent) => ({ kind: "transfer", from: agent, to: action.to, amount: action.amount }));
    case "vouch":
      return asAgent(wallet, hero, (agent) => ({ kind: "vouch", from: agent, to: action.to, weight: action.weight }));
    case "transferItem":
      return asAgent(wallet, hero, () => ({ kind: "transfer-item", itemId: action.itemId, to: action.to }));
    case "migrate":
      return asAgent(wallet, hero, (agent) => ({ kind: "migrate", agentId: agent, toRegion: action.toRegion }));
    case "vote":
      return asAgent(wallet, hero, () => ({ kind: "vote", regionId: action.regionId }));
    case "found": {
      const founded = await asOwner(wallet, hero, { kind: "found", regionId: action.regionId, displayName: action.displayName });
      if (!founded.ok) return founded;
      // A homeless hero moves into their new village with a starting purse; a hero who
      // already lives somewhere just becomes the new region's owner.
      if (hero.agentId) return { ok: true, detail: { regionId: action.regionId } };
      const agentId = `${hero.heroName}@${action.regionId}`;
      const admitted = await asOwner(wallet, hero, {
        kind: "admit",
        agentId,
        region: action.regionId,
        role: "broker",
        currency: 100,
      });
      if (!admitted.ok) return { ok: false, reason: `village founded, but admit failed: ${admitted.reason}` };
      return { ok: true, detail: { regionId: action.regionId, agentId } };
    }
    case "admit":
      return asOwner(wallet, hero, {
        kind: "admit",
        agentId: `${action.agentName}@${action.region}`,
        region: action.region,
        role: action.role,
        currency: action.currency ?? 50,
      });
    case "mintItem":
      return asOwner(wallet, hero, { kind: "mint-item", itemId: newItemId(action.itemKind), itemKind: action.itemKind, owner: action.owner });
    case "amendMinting":
      return asOwner(wallet, hero, {
        kind: "amend",
        regionId: action.regionId,
        change: { policy: "items", value: { minting: action.minting } },
      });
    case "amendGovernance":
    case "proposeGovernance": {
      // Constitutions are presets over the raw governance primitive; the member
      // roll comes from the region's REAL residents, most reputable first.
      const residents = await residentIds(action.regionId);
      if (residents.length === 0 && action.regime !== "dictatorship") return { ok: false, reason: "no-residents-for-council" };
      const change = { policy: "governance", value: buildGovernance(action.regime, residents) };
      if (action.kind === "amendGovernance") {
        return asOwner(wallet, hero, { kind: "amend", regionId: action.regionId, change });
      }
      return asAgent(wallet, hero, () => ({ kind: "propose", regionId: action.regionId, change }));
    }
    case "buyItem": {
      const ware = wareByKind(action.ware);
      if (!ware) return { ok: false, reason: "unknown-ware" };
      if (!hero.agentId) return { ok: false, reason: "no-agent: found or join a village first" };
      const regions = (await reads.regions()) as RegionView[];
      const region = regions.find((r) => r.id === action.regionId);
      if (!region) return { ok: false, reason: "unknown-region" };
      // Pay first — into the village treasury, through the real (taxed) transfer path.
      // Festivals discount the asking price; the price is the game's convention, the
      // transfer is what actually happens.
      const price = action.price ?? ware.price;
      const paid = await asAgent(wallet, hero, (agent) => ({
        kind: "transfer",
        from: agent,
        to: "treasury@" + action.regionId,
        amount: price,
      }));
      if (!paid.ok) return paid;
      // Then mint under the village's own institution: the signer the rule names.
      const minting = region.institutions.itemPolicy.minting;
      const command = { kind: "mint-item", itemId: newItemId(ware.kind), itemKind: ware.kind, owner: hero.agentId };
      const minted = minting === "owner" ? await asOwner(wallet, hero, command) : await asAgent(wallet, hero, () => command);
      if (!minted.ok) return { ok: false, reason: "だいきんは はらったのに しなものが でてこない… (" + minted.reason + ")" };
      return { ok: true, detail: { ware: ware.kind, price } };
    }
    case "forage": {
      // Harvesting and fishing mint under the HERO's home minting law (the mint-item
      // gate consults the recipient's region), signed by whoever that law names.
      if (!hero.agentId) return { ok: false, reason: "no-agent: found or join a village first" };
      const home = hero.agentId.split("@")[1] ?? "";
      const regions = (await reads.regions()) as RegionView[];
      const region = regions.find((r) => r.id === home);
      if (!region) return { ok: false, reason: "unknown-region" };
      const command = { kind: "mint-item", itemId: newItemId(action.itemKind), itemKind: action.itemKind, owner: hero.agentId };
      const minting = region.institutions.itemPolicy.minting;
      return minting === "owner" ? asOwner(wallet, hero, command) : asAgent(wallet, hero, () => command);
    }
    case "amendDiplomacy":
    case "proposeDiplomacy": {
      const regions = (await reads.regions()) as RegionView[];
      const region = regions.find((r) => r.id === action.regionId);
      if (!region) return { ok: false, reason: "unknown-region" };
      const cur = region.institutions.diplomacyPolicy;
      const change = {
        policy: "diplomacy",
        value: { defaultStance: cur.defaultStance, overrides: { ...cur.overrides, [action.target]: action.stance } },
      };
      if (action.kind === "amendDiplomacy") {
        return asOwner(wallet, hero, { kind: "amend", regionId: action.regionId, change });
      }
      return asAgent(wallet, hero, () => ({ kind: "propose", regionId: action.regionId, change }));
    }
    case "proposeMinting":
      return asAgent(wallet, hero, () => ({
        kind: "propose",
        regionId: action.regionId,
        change: { policy: "items", value: { minting: action.minting } },
      }));
    // --- the region market, opened to the hero ---------------------------------
    case "listRegion": {
      if (action.price !== null) {
        // The market rule: only a dormant region can be listed. Close, then price.
        const slept = await asOwner(wallet, hero, { kind: "lifecycle", regionId: action.regionId, lifecycle: "dormant" });
        if (!slept.ok) return slept;
        return asOwner(wallet, hero, { kind: "list", regionId: action.regionId, salePrice: action.price });
      }
      // Delist, then reopen for business.
      const delisted = await asOwner(wallet, hero, { kind: "list", regionId: action.regionId, salePrice: null });
      if (!delisted.ok) return delisted;
      return asOwner(wallet, hero, { kind: "lifecycle", regionId: action.regionId, lifecycle: "active" });
    }
    case "handoverRegion": {
      // A handover needs a listing; a gift is a 0G listing followed by the deed.
      const slept = await asOwner(wallet, hero, { kind: "lifecycle", regionId: action.regionId, lifecycle: "dormant" });
      if (!slept.ok) return slept;
      const listed = await asOwner(wallet, hero, { kind: "list", regionId: action.regionId, salePrice: 0 });
      if (!listed.ok) return listed;
      return asOwner(wallet, hero, { kind: "handover", regionId: action.regionId, to: action.to });
    }
    case "lifecycleRegion":
      return asOwner(wallet, hero, { kind: "lifecycle", regionId: action.regionId, lifecycle: action.lifecycle });
    case "buyRegion":
      // Buying is a trust trade: pay the asking price to the owner's agent; the
      // owner (bot owners watch the log) signs the handover on their next waking.
      return asAgent(wallet, hero, (agent) => ({ kind: "transfer", from: agent, to: action.ownerAgent, amount: action.price }));
    case "amendEconomy":
    case "proposeEconomy": {
      const regions = (await reads.regions()) as RegionView[];
      const region = regions.find((r) => r.id === action.regionId);
      if (!region) return { ok: false, reason: "unknown-region" };
      const cur = region.institutions.economyPolicy;
      const change = {
        policy: "economy",
        value: {
          baseCostRate: action.baseCostRate,
          minCostRate: Math.min(cur.minCostRate, action.baseCostRate),
          // The view does not expose these two; keep the world defaults.
          repDiscount: 0.02,
          creditPerTx: 1,
        },
      };
      if (action.kind === "amendEconomy") {
        return asOwner(wallet, hero, { kind: "amend", regionId: action.regionId, change });
      }
      return asAgent(wallet, hero, () => ({ kind: "propose", regionId: action.regionId, change }));
    }
  }
}

async function residentIds(regionId: string): Promise<string[]> {
  const agents = (await reads.agents()) as AgentView[];
  return agents
    .filter((a) => a.region === regionId && a.role !== "treasury")
    .sort((a, b) => b.reputation - a.reputation || b.trust - a.trust || a.id.localeCompare(b.id))
    .map((a) => a.id);
}

/** Aggregate the node's read surface into the snapshot the renderer consumes. */
export async function buildSnapshot(heroName: string | null): Promise<Snapshot> {
  const [regions, agents, items, metrics] = await Promise.all([
    reads.regions() as Promise<RegionView[]>,
    reads.agents() as Promise<AgentView[]>,
    reads.items() as Promise<ItemView[]>,
    reads.metrics(),
  ]);
  let me: MeView = { heroName, registered: false, agentId: null };
  if (heroName) {
    const state = await account(heroName);
    me = { heroName, registered: state.registered, agentId: findHeroAgent(agents, heroName)?.id ?? null };
  }
  const sorted = [...regions].sort((a, b) => a.foundedAtSeq - b.foundedAtSeq);
  return { regions: sorted, agents, items, me, logLength: metrics.log.length };
}
