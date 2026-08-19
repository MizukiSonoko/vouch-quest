import { describe, expect, test } from "bun:test";
import { buildMap, heroSpawn, isSolid, MAP_H, MAP_W, placeNpcs, Tile, tileAt } from "../src/client/map";
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
  regions: [region("asahi", 2), region("yuhi", 9)],
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

describe("buildMap", () => {
  test("is deterministic: same snapshot, same tiles", () => {
    const a = buildMap(snapshot);
    const b = buildMap(snapshot);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.villages.map((v) => v.regionId)).toEqual(["asahi", "yuhi"]);
  });

  test("borders are water and villages carve signs and chests", () => {
    const map = buildMap(snapshot);
    expect(tileAt(map, 0, 0)).toBe(Tile.Water);
    expect(tileAt(map, MAP_W - 1, MAP_H - 1)).toBe(Tile.Water);
    for (const village of map.villages) {
      expect(tileAt(map, village.sign[0], village.sign[1])).toBe(Tile.Sign);
      expect(tileAt(map, village.chest[0], village.chest[1])).toBe(Tile.Chest);
    }
  });

  test("out-of-bounds reads are solid water, never a crash", () => {
    const map = buildMap(snapshot);
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
  });
});

describe("heroSpawn", () => {
  test("spawns inside the hero's home village plot", () => {
    const map = buildMap(snapshot);
    const [x, y] = heroSpawn(snapshot, map);
    const home = map.villages.find((v) => v.regionId === "asahi");
    expect(home).toBeDefined();
    if (!home) return;
    expect(x).toBeGreaterThan(home.x);
    expect(x).toBeLessThan(home.x + 18);
    expect(y).toBeGreaterThan(home.y);
    expect(y).toBeLessThan(home.y + 13);
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
