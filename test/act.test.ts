import { describe, expect, test } from "bun:test";
import { actionSchema, findHeroAgent, newItemId } from "../src/client/logic";
import type { AgentView } from "../src/shared";

describe("actionSchema", () => {
  test("accepts each well-formed action", () => {
    const good = [
      { kind: "transfer", to: "ann@asahi", amount: 10 },
      { kind: "vouch", to: "ann@asahi", weight: 3 },
      { kind: "transferItem", itemId: "tsubo1", to: "ann@asahi" },
      { kind: "migrate", toRegion: "asahi" },
      { kind: "vote", regionId: "asahi" },
      { kind: "found", regionId: "yuhi", displayName: "Yuhi" },
      { kind: "admit", agentName: "Ken", region: "asahi", role: "artisan", currency: 50 },
      { kind: "mintItem", itemKind: "sword", owner: "mizuki@asahi" },
      { kind: "amendMinting", regionId: "asahi", minting: "anyone" },
      { kind: "amendGovernance", regionId: "asahi", regime: "democracy" },
      { kind: "proposeMinting", regionId: "asahi", minting: "anyone" },
      { kind: "proposeGovernance", regionId: "asahi", regime: "republic" },
    ];
    for (const action of good) expect(actionSchema.safeParse(action).success).toBe(true);
  });

  test("rejects malformed input before it can reach the node", () => {
    const bad = [
      { kind: "transfer", to: "ann@asahi", amount: -5 },
      { kind: "transfer", to: "ann@asahi", amount: 1.5 },
      { kind: "vouch", to: "ann@asahi", weight: 9 },
      { kind: "found", regionId: "YUHI", displayName: "Yuhi" }, // region ids are lowercase
      { kind: "admit", agentName: "9ken", region: "asahi", role: "artisan" }, // names start with a letter
      { kind: "admit", agentName: "Ken", region: "asahi", role: "treasury" }, // players cannot admit treasuries
      { kind: "selfdestruct" },
      { kind: "proposeGovernance", regionId: "asahi", regime: "monarchy" }, // not a known regime
    ];
    for (const action of bad) expect(actionSchema.safeParse(action).success).toBe(false);
  });
});

describe("findHeroAgent", () => {
  const agents: AgentView[] = [
    { id: "treasury@asahi", region: "asahi", role: "treasury", balances: { credit: 0, currency: 0 }, reputation: 0, trust: 0 },
    { id: "mizuki@asahi", region: "asahi", role: "broker", balances: { credit: 1, currency: 85 }, reputation: 1, trust: 0 },
  ];

  test("finds the hero's agent by name prefix, skipping treasuries", () => {
    expect(findHeroAgent(agents, "mizuki")?.id).toBe("mizuki@asahi");
    expect(findHeroAgent(agents, "treasury")).toBeNull();
    expect(findHeroAgent(agents, "nobody")).toBeNull();
  });

  test("does not match a longer name sharing the prefix", () => {
    expect(findHeroAgent(agents, "mizu")).toBeNull();
  });
});

describe("newItemId", () => {
  test("derives a lowercase alphanumeric id from the kind", () => {
    const id = newItemId("Tea-Pot");
    expect(id.startsWith("teapot")).toBe(true);
    expect(/^[a-z0-9]+$/.test(id)).toBe(true);
  });
});
