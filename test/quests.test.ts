import { describe, expect, test } from "bun:test";
import { heroStats, heroTitle, QUESTS, questProgress } from "../src/client/quests";
import type { LogEventView, Snapshot } from "../src/shared";

// Payload shapes mirror the real node's log (verified against a live world).
const EVENTS: LogEventView[] = [
  { seq: 0, type: "region.founded", actor: "world", payload: { region: { id: "tsuki" }, owner: "Rei" } },
  { seq: 1, type: "agent.admitted", actor: "world", payload: { admission: { id: "Rei@tsuki", region: "tsuki" } } },
  {
    seq: 2,
    type: "economy.settled",
    actor: "world",
    payload: {
      entries: [
        { agentId: "Rei@tsuki", currencyDelta: -30, creditDelta: 1 },
        { agentId: "ann@asahi", currencyDelta: 25, creditDelta: 1 },
        { agentId: "treasury@tsuki", currencyDelta: 5 },
      ],
    },
  },
  { seq: 3, type: "agent.vouched", actor: "world", payload: { from: "Rei@tsuki", to: "ann@asahi", weight: 3 } },
  { seq: 4, type: "agent.vouched", actor: "world", payload: { from: "ann@asahi", to: "Rei@tsuki", weight: 2 } },
  { seq: 5, type: "item.minted", actor: "world", payload: { itemId: "tsubo1", kind: "tsubo", owner: "Rei@tsuki" } },
  { seq: 6, type: "item.transferred", actor: "world", payload: { itemId: "tsubo1", from: "Rei@tsuki", to: "ann@asahi" } },
  { seq: 7, type: "region.institution.changed", actor: "world", payload: { regionId: "tsuki", by: "Rei" } },
  { seq: 8, type: "gov.proposal.opened", actor: "world", payload: { regionId: "asahi", by: "ann@asahi" } },
];

describe("heroStats", () => {
  test("attributes events across both of the hero's principals", () => {
    const s = heroStats(EVENTS, "Rei");
    expect(s.villagesFounded).toBe(1);
    expect(s.transfersSent).toBe(1);
    expect(s.goldSent).toBe(30);
    expect(s.vouchesGiven).toBe(1);
    expect(s.vouchesReceived).toBe(1);
    expect(s.itemsMinted).toBe(1);
    expect(s.itemsReceived).toBe(0);
    expect(s.amendments).toBe(1);
    expect(s.proposals).toBe(0);
  });

  test("does not credit lookalike names", () => {
    const s = heroStats(EVENTS, "Re"); // prefix of Rei, but not Rei
    expect(s.villagesFounded).toBe(0);
    expect(s.transfersSent).toBe(0);
  });
});

describe("quests and titles", () => {
  const snapshot: Snapshot = {
    regions: [],
    agents: [
      {
        id: "Rei@tsuki",
        region: "tsuki",
        role: "broker",
        balances: { credit: 2, currency: 70 },
        reputation: 2,
        trust: 2,
      },
    ],
    items: [],
    me: { heroName: "Rei", registered: true, agentId: "Rei@tsuki" },
    logLength: EVENTS.length,
  };
  const ctx = { stats: heroStats(EVENTS, "Rei"), snapshot, hero: snapshot.agents[0] ?? null };

  test("progress marks the earned quests and only those", () => {
    const done = new Set(questProgress(ctx).filter((q) => q.done).map((q) => q.quest.id));
    for (const id of ["name", "home", "founder", "trade", "voucher", "trusted", "artisan", "politician"]) {
      expect(done.has(id)).toBe(true);
    }
    for (const id of ["patron", "collector", "nomad", "rich"]) {
      expect(done.has(id)).toBe(false);
    }
  });

  test("titles climb with achievement", () => {
    expect(heroTitle(ctx)).toBe("そんちょう");
    const fresh = {
      stats: heroStats([], "Noa"),
      snapshot: { ...snapshot, me: { heroName: "Noa", registered: true, agentId: null }, agents: [] },
      hero: null,
    };
    expect(heroTitle(fresh)).toBe("かけだしの たびびと");
  });

  test("every quest id is unique", () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
  });
});
