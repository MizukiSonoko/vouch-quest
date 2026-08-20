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
    // The road lane south of both settlements is paved along its polyline.
    const road = friendly.roads[0] ?? [];
    expect(road.length).toBeGreaterThan(3);
    const paved = road.filter(([x, y]) => tileAt(friendly, x, y) === Tile.Path).length;
    expect(paved / road.length).toBeGreaterThan(0.8);
    // Without friendship there is no road at all.
    const cold = buildMap(snapshot([region("asahi", 1), region("tsuki", 2)], "Rei@asahi"));
    expect(cold.roads.length).toBe(0);
  });

  test("every village carves a shop stall", () => {
    const m = buildMap(snapshot([region("asahi", 1), region("tsuki", 2)], "Rei@asahi"));
    for (const v of m.villages) expect(tileAt(m, v.stall[0], v.stall[1])).toBe(Tile.Stall);
  });
});

describe("municipal system (市町村)", () => {
  test("prefectures form over the friendship graph, seat = strongest", () => {
    const a = region("asahi", 1, { overrides: { tsuki: "absorb" } });
    const b = region("tsuki", 2, { overrides: { asahi: "absorb" } });
    const c = region("yuhi", 3); // no friends → independent
    const { prefectures } = require("../src/client/shop");
    const blocs = prefectures([a, b, c], (id: string) => (id === "tsuki" ? 2 : 0));
    expect(blocs.length).toBe(1);
    expect(blocs[0].seat).toBe("tsuki");
    expect(blocs[0].name).toBe("TSUKIけん");
    expect(blocs[0].members.sort()).toEqual(["asahi", "tsuki"]);
  });

  test("law layers: 憲法 > 法律 > 条例", () => {
    const { lawLayer, municipalRank } = require("../src/client/politics");
    expect(lawLayer("governance")).toBe("けんぽう");
    expect(lawLayer("economy")).toBe("ほうりつ");
    expect(lawLayer("items")).toBe("ほうりつ");
    expect(lawLayer("diplomacy")).toBe("じょうれい");
    expect(municipalRank(0)).toBe("村");
    expect(municipalRank(3)).toBe("都");
    expect(municipalRank(9)).toBe("都");
  });

  test("a small village inside a city's territory becomes its district", () => {
    const m = buildMap(snapshot([region("asahi", 1), region("tsuki", 2)], "Rei@asahi"));
    // parent is null unless the centre actually falls inside a HIGHER-tier blob
    for (const v of m.villages) {
      if (v.parent) {
        const host = m.villages.find((o) => o.regionId === v.parent);
        expect(host).toBeTruthy();
        expect((host?.tier ?? 0) > v.tier).toBe(true);
      }
    }
  });
});
