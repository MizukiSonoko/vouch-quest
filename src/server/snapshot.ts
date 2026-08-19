// Aggregate the node's read surface into one snapshot the client renders from.
// Reads only — the write path is act.ts, and the node enforces everything anyway.

import type { VouchClient } from "vouch-cli";
import type { AgentView, ItemView, MeView, RegionView, Snapshot } from "../shared";
import { findHeroAgent } from "./act";

export async function buildSnapshot(client: VouchClient, heroName: string | null): Promise<Snapshot> {
  const [regions, agents, items, metrics] = await Promise.all([
    client.regions() as Promise<RegionView[]>,
    client.agents() as Promise<AgentView[]>,
    client.items() as Promise<ItemView[]>,
    client.metrics() as Promise<{ log: { length: number } }>,
  ]);

  let me: MeView = { heroName, registered: false, agentId: null };
  if (heroName) {
    const account = await client.account(heroName);
    const heroAgent = findHeroAgent(agents, heroName);
    me = { heroName, registered: account.registered, agentId: heroAgent?.id ?? null };
  }

  const sorted = [...regions].sort((a, b) => a.foundedAtSeq - b.foundedAtSeq);
  return { regions: sorted, agents, items, me, logLength: metrics.log.length };
}
