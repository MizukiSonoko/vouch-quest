import { describe, expect, test } from "bun:test";
import { actionSchema } from "../src/client/logic";
import { buildMap, Tile, tileAt } from "../src/client/map";
import { canShopHere, CATALOG, friendlyPairs, kindName, stanceToward } from "../src/client/shop";
import type { RegionView, Snapshot, Stance } from "../src/shared";

const region = (id: string, foundedAtSeq: number, opts: { minting?: string; owner?: string; overrides?: Record<string, Stance> } = {}): RegionView => ({
  id,
  displayName: id.toUpperCase(),
  owner: opts.owner ?? "mizuki",
  status: "unrecognized",
  lifecycle: "active",
  foundedAtSeq,
  salePrice: null,
  institutions: {
    governance: { kind: "dictatorship" },
    itemPolicy: { minting: opts.minting ?? "owner" },
    economyPolicy: { baseCostRate: 0.2, minCostRate: 0.05 },
    diplomacyPolicy: { defaultStance: "reexamine", overrides: opts.overrides ?? {} },
  },
  openProposal: null,
});

const snapshot = (regions: RegionView[], agentId: string | null, heroName = "Rei"): Snapshot => ({
  regions,
  agents: [],
  items: [],
  me: { heroName, registered: true, agentId },
  logLength: 0,
});

describe("catalog", () => {
  test("kinds are unique and named", () => {
    expect(new Set(CATALOG.map((w) => w.kind)).size).toBe(CATALOG.length);
    expect(kindName("herb")).toBe("やくそう");
    expect(kindName("mystery")).toBe("mystery");
  });

  test("buyItem action validates", () => {
    expect(actionSchema.safeParse({ kind: "buyItem", regionId: "asahi", ware: "herb" }).success).toBe(true);
    expect(actionSchema.safeParse({ kind: "amendDiplomacy", regionId: "asahi", target: "tsuki", stance: "absorb" }).success).toBe(true);
    expect(actionSchema.safeParse({ kind: "amendDiplomacy", regionId: "asahi", target: "tsuki", stance: "war" }).success).toBe(false);
  });
});

describe("canShopHere mirrors the node's minting gate", () => {
  test("owner policy: only the region owner shops", () => {
    const r = region("asahi", 1, { minting: "owner", owner: "Rei" });
    expect(canShopHere(r, snapshot([r], "Rei@tsuki")).ok).toBe(true); // owner, even living elsewhere
    const other = region("asahi", 1, { minting: "owner", owner: "mizuki" });
    expect(canShopHere(other, snapshot([other], "Rei@asahi")).ok).toBe(false);
  });

  test("residents policy: locals only; anyone: everyone", () => {
    const r = region("asahi", 1, { minting: "residents", owner: "mizuki" });
    expect(canShopHere(r, snapshot([r], "Rei@asahi")).ok).toBe(true);
    expect(canShopHere(r, snapshot([r], "Rei@tsuki")).ok).toBe(false);
    const open = region("asahi", 1, { minting: "anyone", owner: "mizuki" });
    expect(canShopHere(open, snapshot([open], "Rei@tsuki")).ok).toBe(true);
  });
});

describe("diplomacy", () => {
  test("stanceToward prefers the override, else the default", () => {
    const r = region("asahi", 1, { overrides: { tsuki: "absorb" } });
    expect(stanceToward(r, "tsuki")).toBe("absorb");
    expect(stanceToward(r, "yuhi")).toBe("reexamine");
  });

  test("friendlyPairs requires warmth from BOTH sides", () => {
    const a = region("asahi", 1, { overrides: { tsuki: "absorb" } });
    const b = region("tsuki", 2, { overrides: { asahi: "map" } });
    const c = region("yuhi", 3, { overrides: { asahi: "absorb" } }); // one-sided
    expect(friendlyPairs([a, b, c])).toEqual([["asahi", "tsuki"]]);
  });

  test("a mutual friendship paves a road between the gates", () => {
    const a = region("asahi", 1, { overrides: { tsuki: "absorb" } });
    const b = region("tsuki", 2, { overrides: { asahi: "absorb" } });
    const friendly = buildMap(snapshot([a, b], "Rei@asahi"));
    const va = friendly.villages[0];
    const vb = friendly.villages[1];
    expect(va && vb).toBeTruthy();
    if (!va || !vb) return;
    // The corner of the L-shaped road is paved.
    expect(tileAt(friendly, va.gate[0], vb.gate[1] + 1)).toBe(Tile.Path);
    // Without friendship, that same tile is untouched terrain, not a road.
    const cold = buildMap(snapshot([region("asahi", 1), region("tsuki", 2)], "Rei@asahi"));
    expect(tileAt(cold, va.gate[0], vb.gate[1] + 1)).not.toBe(Tile.Path);
  });

  test("every village carves a shop stall", () => {
    const m = buildMap(snapshot([region("asahi", 1), region("tsuki", 2)], "Rei@asahi"));
    for (const v of m.villages) expect(tileAt(m, v.stall[0], v.stall[1])).toBe(Tile.Stall);
  });
});
