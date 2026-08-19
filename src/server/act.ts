// Player actions → signed vouch commands. Every browser request is validated with
// zod, then dispatched to the VouchClient SDK, which signs with the wallet key and
// submits to the node. The node's own authorization stays authoritative — this layer
// only picks WHICH of the hero's two principals signs:
//   owner actions (found / admit / mint / amend / market) → the hero name
//   agent actions (transfer / vouch / migrate / items / vote) → `hero@region`

import type { VouchClient } from "vouch-cli";
import { z } from "zod";
import type { ActResult, AgentView } from "../shared";

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
]);

export type Action = z.infer<typeof actionSchema>;

export interface Hero {
  readonly heroName: string;
  /** The hero's agent id (`hero@region`), or null if not admitted anywhere yet. */
  readonly agentId: string | null;
}

/** Register a principal on first use. First-writer-wins on the node, so a repeat is a no-op check. */
async function ensureRegistered(client: VouchClient, principal: string): Promise<ActResult | null> {
  const account = await client.account(principal);
  if (account.registered) return null;
  const res = await client.register(principal);
  return res.ok ? null : { ok: false, reason: `register ${principal}: ${res.reason}` };
}

function fail(reason: string): ActResult {
  return { ok: false, reason };
}

function fromSubmit(res: { ok: true; detail: Record<string, unknown> } | { ok: false; reason: string }): ActResult {
  return res.ok ? { ok: true, detail: res.detail } : { ok: false, reason: res.reason };
}

async function asAgent(
  client: VouchClient,
  hero: Hero,
  run: (agentId: string) => Promise<{ ok: true; detail: Record<string, unknown>; events: number } | { ok: false; status: number; reason: string }>,
): Promise<ActResult> {
  if (!hero.agentId) return fail("no-agent: found or join a village first");
  const reg = await ensureRegistered(client, hero.agentId);
  if (reg) return reg;
  return fromSubmit(await run(hero.agentId));
}

async function asOwner(
  client: VouchClient,
  hero: Hero,
  run: (owner: string) => Promise<{ ok: true; detail: Record<string, unknown>; events: number } | { ok: false; status: number; reason: string }>,
): Promise<ActResult> {
  const reg = await ensureRegistered(client, hero.heroName);
  if (reg) return reg;
  return fromSubmit(await run(hero.heroName));
}

/** A short unique item id: kind prefix + base36 randomness (uniqueness, not security). */
export function newItemId(itemKind: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${itemKind.toLowerCase().replace(/[^a-z0-9]/g, "")}${suffix}`;
}

export async function dispatchAction(client: VouchClient, hero: Hero, action: Action): Promise<ActResult> {
  switch (action.kind) {
    case "transfer":
      return asAgent(client, hero, (agent) => client.transfer(agent, action.to, action.amount));
    case "vouch":
      return asAgent(client, hero, (agent) => client.vouch(agent, action.to, action.weight));
    case "transferItem":
      return asAgent(client, hero, (agent) => client.transferItem(agent, action.itemId, action.to));
    case "migrate":
      return asAgent(client, hero, (agent) => client.migrate(agent, action.toRegion));
    case "vote":
      return asAgent(client, hero, (agent) => client.vote(agent, action.regionId));
    case "found": {
      const founded = await asOwner(client, hero, (owner) => client.found(owner, action.regionId, action.displayName));
      if (!founded.ok) return founded;
      // A homeless hero moves into their new village with a starting purse. A hero who
      // already lives somewhere just becomes the new region's owner (one hero, one agent).
      if (hero.agentId) return { ok: true, detail: { regionId: action.regionId } };
      const agentId = `${hero.heroName}@${action.regionId}`;
      const admitted = await asOwner(client, hero, (owner) => client.admit(owner, agentId, action.regionId, "broker", 100));
      if (!admitted.ok) return { ok: false, reason: `village founded, but admit failed: ${admitted.reason}` };
      return { ok: true, detail: { regionId: action.regionId, agentId } };
    }
    case "admit":
      return asOwner(client, hero, (owner) =>
        client.admit(owner, `${action.agentName}@${action.region}`, action.region, action.role, action.currency ?? 50),
      );
    case "mintItem":
      return asOwner(client, hero, (owner) => client.mintItem(owner, newItemId(action.itemKind), action.itemKind, action.owner));
    case "amendMinting":
      return asOwner(client, hero, (owner) =>
        client.amend(owner, action.regionId, { policy: "items", value: { minting: action.minting } }),
      );
  }
}

/** The agent this hero controls: the unique `hero@…` resident among the world's agents. */
export function findHeroAgent(agents: readonly AgentView[], heroName: string): AgentView | null {
  return agents.find((a) => a.id.startsWith(`${heroName}@`) && a.role !== "treasury") ?? null;
}
