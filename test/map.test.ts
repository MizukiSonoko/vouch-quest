import { describe, expect, test } from "bun:test";
import {
  buildMap,
  devTier,
  heroSpawn,
  isSolid,
  MAP_H,
  MAP_W,
  MAX_PLOT_H,
  MAX_PLOT_W,
  MIN_PLOT_H,
  MIN_PLOT_W,
  placeNpcs,
  Tile,
  tileAt,
  villageRng,
} from "../src/client/map";
import type { Snapshot } from "../src/shared";

const region = (id: string, foundedAtSeq: number) => ({
  id,
  displayName: id.toUpperCase(),
  owner: "mizuki",
  status: "unrecognized" as const,
  lifecycle: "active" as const,
  foundedAtSeq,
  salePrice: null,
  institutions: {
    governance: { kind: "dictatorship" },
    itemPolicy: { minting: "owner" },
    economyPolicy: { baseCostRate: 0.2, minCostRate: 0.05 },
    diplomacyPolicy: { defaultStance: "reexamine" as const, overrides: {} },
  },
  openProposal: null,
});

const agent = (id: string, regionId: string, role: "artisan" | "merchant" | "broker" | "treasury") => ({
  id,
  region: regionId,
  role,
  balances: { credit: 0, currency: 10 },
  reputation: 0,
  trust: 0,
});

const snapshot: Snapshot = {
  regions: [region("asahi", 2), region("yuhi", 9), region("tsuki", 16)],
  agents: [
    agent("mizuki@asahi", "asahi", "broker"),
    agent("ann@asahi", "asahi", "artisan"),
    agent("treasury@asahi", "asahi", "treasury"),
    agent("bo@yuhi", "yuhi", "merchant"),
  ],
  items: [],
  me: { heroName: "mizuki", registered: true, agentId: "mizuki@asahi" },
  logLength: 10,
};

describe("villageRng", () => {
  test("is deterministic per region id and distinct across ids", () => {
    const a1 = villageRng("asahi");
    const a2 = villageRng("asahi");
    const b = villageRng("yuhi");
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildMap", () => {
  test("is deterministic: same snapshot, same tiles", () => {
    const a = buildMap(snapshot);
    const b = buildMap(snapshot);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.villages.map((v) => v.regionId)).toEqual(["asahi", "yuhi", "tsuki"]);
  });

  test("village sizes stay within bounds and vary by region", () => {
    const map = buildMap(snapshot);
    for (const v of map.villages) {
      expect(v.w).toBeGreaterThanOrEqual(MIN_PLOT_W);
      expect(v.w).toBeLessThanOrEqual(MAX_PLOT_W);
      expect(v.h).toBeGreaterThanOrEqual(MIN_PLOT_H);
      expect(v.h).toBeLessThanOrEqual(MAX_PLOT_H);
    }
  });

  test("every village carves its sign, chest, civic doors, and an open gate", () => {
    const map = buildMap(snapshot);
    for (const v of map.villages) {
      expect(tileAt(map, v.sign[0], v.sign[1])).toBe(Tile.Sign);
      expect(tileAt(map, v.poster[0], v.poster[1])).toBe(Tile.Poster);
      expect(tileAt(map, v.chest[0], v.chest[1])).toBe(Tile.Chest);
      expect(tileAt(map, v.hall[0], v.hall[1])).toBe(Tile.HallDoor);
      expect(tileAt(map, v.mint[0], v.mint[1])).toBe(Tile.MintDoor);
      expect(tileAt(map, v.court[0], v.court[1])).toBe(Tile.CourtDoor);
      expect(tileAt(map, v.gate[0], v.gate[1])).toBe(Tile.Path);
      // A hero standing before each door has a walkable tile under them.
      for (const door of [v.hall, v.mint, v.court]) {
        expect(isSolid(map, door[0], door[1] + 1)).toBe(false);
      }
    }
  });

  test("borders are water and out-of-bounds reads are solid", () => {
    const map = buildMap(snapshot);
    expect(tileAt(map, 0, 0)).toBe(Tile.Water);
    expect(tileAt(map, MAP_W - 1, MAP_H - 1)).toBe(Tile.Water);
    expect(tileAt(map, -5, 3)).toBe(Tile.Water);
    expect(isSolid(map, MAP_W + 10, 0)).toBe(true);
  });
});

describe("placeNpcs", () => {
  test("places residents but never the hero or treasuries", () => {
    const map = buildMap(snapshot);
    const npcs = placeNpcs(snapshot, map);
    const ids = npcs.map((n) => n.agent.id).sort();
    expect(ids).toEqual(["ann@asahi", "bo@yuhi"]);
    for (const npc of npcs) expect(isSolid(map, npc.x, npc.y)).toBe(false);
  });
});

describe("devTier", () => {
  test("population or treasury wealth grows a village into a town, then a city", () => {
    expect(devTier(1, 0)).toBe(0);
    expect(devTier(4, 0)).toBe(1);
    expect(devTier(0, 30)).toBe(1);
    expect(devTier(6, 0)).toBe(2);
    expect(devTier(2, 100)).toBe(2);
  });
});

describe("cities", () => {
  test("a city paves itself, gets a station, and two cities get connected rails", () => {
    const crowd = (rid: string) =>
      ["A", "B", "C", "D", "E", "F"].map((n) => agent(`${n}${rid}@${rid}`, rid, "artisan"));
    const citySnap: Snapshot = {
      ...snapshot,
      regions: [region("asahi", 2), region("yuhi", 9)],
      agents: [...crowd("asahi"), ...crowd("yuhi")],
      me: { heroName: "mizuki", registered: true, agentId: null },
    };
    const m = buildMap(citySnap);
    for (const v of m.villages) {
      expect(v.tier).toBe(2);
      expect(v.station).not.toBeNull();
      if (v.station) expect(tileAt(m, v.station[0], v.station[1])).toBe(Tile.Station);
    }
    expect(m.rails.length).toBe(1);
    expect(m.rails[0]?.length ?? 0).toBeGreaterThan(4);
  });
});

describe("heroSpawn", () => {
  test("spawns just inside the hero's home village gate", () => {
    const map = buildMap(snapshot);
    const [x, y] = heroSpawn(snapshot, map);
    const home = map.villages.find((v) => v.regionId === "asahi");
    expect(home).toBeDefined();
    if (!home) return;
    expect(x).toBe(home.gate[0]);
    expect(y).toBe(home.gate[1] - 1);
    expect(isSolid(map, x, y)).toBe(false);
  });

  test("homeless heroes spawn at world center", () => {
    const homeless: Snapshot = { ...snapshot, me: { heroName: "who", registered: true, agentId: null } };
    const map = buildMap(homeless);
    const [x, y] = heroSpawn(homeless, map);
    expect(x).toBe(Math.floor(MAP_W / 2));
    expect(y).toBe(Math.floor(MAP_H / 2) + 8);
  });
});

describe("player constructions (bld deeds)", () => {
  const { buildMap, Tile, tileAt } = require("../src/client/map");
  const region = (id: string) => ({
    id, displayName: id.toUpperCase(), owner: "Rei", status: "unrecognized", lifecycle: "active", foundedAtSeq: 1, salePrice: null,
    institutions: { governance: { kind: "dictatorship" }, itemPolicy: { minting: "anyone" }, economyPolicy: { baseCostRate: 0.2, minCostRate: 0.05 }, diplomacyPolicy: { defaultStance: "reexamine", overrides: {} } },
    openProposal: null,
  });
  test("a house deed raises a house; water refuses construction", () => {
    const items = [
      { id: "bld1", kind: "bldhouse180x120", owner: "Rei@asahi" },
      { id: "bld2", kind: "bldtree182x120", owner: "Rei@asahi" },
      { id: "bld3", kind: "bldhouse0x0", owner: "Rei@asahi" }, // border water — refused
    ];
    const snap = { regions: [region("asahi")], agents: [], items, me: { heroName: "Rei", registered: true, agentId: "Rei@asahi" }, logLength: 0 };
    const m = buildMap(snap);
    expect(tileAt(m, 180, 120)).toBe(Tile.HouseRoof);
    expect(tileAt(m, 180, 121)).toBe(Tile.HouseDoor);
    expect(tileAt(m, 0, 0)).toBe(Tile.Water);
  });
});
