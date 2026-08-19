// World layout, derived deterministically from the snapshot: same regions in, same
// map out. Each region (sorted by foundedAtSeq, done server-side) claims the next
// village slot; terrain decoration comes from a seeded hash so the overworld is
// stable across reloads. Pure data — no DOM, so it is unit-testable.

import type { AgentView, Snapshot } from "../shared";

export const MAP_W = 120;
export const MAP_H = 80;
export const PLOT_W = 18;
export const PLOT_H = 13;

export const enum Tile {
  Grass = 0,
  Grass2 = 1,
  Tree = 2,
  Water = 3,
  Sand = 4,
  Fence = 5,
  Path = 6,
  HouseWall = 7,
  HouseRoof = 8,
  HouseDoor = 9,
  Sign = 10,
  Chest = 11,
}

const SOLID: ReadonlySet<Tile> = new Set([Tile.Tree, Tile.Water, Tile.Fence, Tile.HouseWall, Tile.HouseRoof, Tile.HouseDoor, Tile.Sign, Tile.Chest]);

/** Village slot origins (top-left of each plot), spread across the overworld. */
export const SLOTS: readonly (readonly [number, number])[] = [
  [12, 10],
  [51, 8],
  [90, 12],
  [10, 34],
  [50, 33],
  [92, 36],
  [12, 58],
  [51, 60],
  [90, 58],
  [31, 21],
  [70, 22],
  [31, 47],
];

export interface Village {
  readonly regionId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly sign: readonly [number, number];
  readonly chest: readonly [number, number];
  /** Interior spawn points for resident NPCs. */
  readonly spots: readonly (readonly [number, number])[];
}

export interface WorldMap {
  readonly tiles: Uint8Array;
  readonly villages: readonly Village[];
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

export function tileAt(map: WorldMap, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return Tile.Water;
  return (map.tiles[y * MAP_W + x] ?? Tile.Water) as Tile;
}

export function isSolid(map: WorldMap, x: number, y: number): boolean {
  return SOLID.has(tileAt(map, x, y));
}

function set(tiles: Uint8Array, x: number, y: number, t: Tile): void {
  if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) tiles[y * MAP_W + x] = t;
}

function carveVillage(tiles: Uint8Array, regionIndex: number, residents: number): Omit<Village, "regionId" | "displayName"> {
  const slot = SLOTS[regionIndex % SLOTS.length] ?? SLOTS[0]!;
  const [vx, vy] = slot;

  // Clear the plot to path-fringed grass, fence the perimeter, open a south gate.
  for (let y = vy; y < vy + PLOT_H; y++) {
    for (let x = vx; x < vx + PLOT_W; x++) {
      set(tiles, x, y, (x + y) % 7 === 0 ? Tile.Grass2 : Tile.Grass);
    }
  }
  for (let x = vx; x < vx + PLOT_W; x++) {
    set(tiles, x, vy, Tile.Fence);
    set(tiles, x, vy + PLOT_H - 1, Tile.Fence);
  }
  for (let y = vy; y < vy + PLOT_H; y++) {
    set(tiles, vx, y, Tile.Fence);
    set(tiles, vx + PLOT_W - 1, y, Tile.Fence);
  }
  const gateX = vx + Math.floor(PLOT_W / 2);
  set(tiles, gateX, vy + PLOT_H - 1, Tile.Path);
  set(tiles, gateX, vy + PLOT_H - 2, Tile.Path);
  set(tiles, gateX, vy + PLOT_H, Tile.Path);

  // Houses: one 3x3 per resident (max 6), two rows of three.
  const houses = Math.min(Math.max(residents, 1), 6);
  for (let i = 0; i < houses; i++) {
    const hx = vx + 2 + (i % 3) * 5;
    const hy = vy + 2 + Math.floor(i / 3) * 5;
    for (let x = hx; x < hx + 3; x++) {
      set(tiles, x, hy, Tile.HouseRoof);
      set(tiles, x, hy + 1, Tile.HouseWall);
    }
    set(tiles, hx + 1, hy + 1, Tile.HouseDoor);
  }

  const sign: readonly [number, number] = [gateX - 2, vy + PLOT_H - 3];
  const chest: readonly [number, number] = [vx + PLOT_W - 3, vy + 2];
  set(tiles, sign[0], sign[1], Tile.Sign);
  set(tiles, chest[0], chest[1], Tile.Chest);

  // NPC spots: in front of each house door, then fallbacks along the main row.
  const spots: (readonly [number, number])[] = [];
  for (let i = 0; i < 6; i++) {
    const hx = vx + 2 + (i % 3) * 5;
    const hy = vy + 2 + Math.floor(i / 3) * 5;
    spots.push([hx + 1, hy + 2] as const);
  }
  for (let i = 0; i < 6; i++) spots.push([vx + 2 + i * 2, vy + PLOT_H - 4] as const);

  return { x: vx, y: vy, sign, chest, spots };
}

export function buildMap(snapshot: Snapshot): WorldMap {
  const tiles = new Uint8Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const border = x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2;
      const r = hash2(x, y);
      let t: Tile = r < 0.5 ? Tile.Grass : Tile.Grass2;
      if (r > 0.93) t = Tile.Tree;
      if (border) t = Tile.Water;
      else if (x < 4 || y < 4 || x >= MAP_W - 4 || y >= MAP_H - 4) t = r > 0.5 ? Tile.Sand : t;
      tiles[y * MAP_W + x] = t;
    }
  }

  const villages = snapshot.regions.map((region, i) => {
    const residents = snapshot.agents.filter((a) => a.region === region.id && a.role !== "treasury").length;
    const carved = carveVillage(tiles, i, residents);
    return { regionId: region.id, displayName: region.displayName, ...carved };
  });

  return { tiles, villages };
}

/** Stable NPC placement: region residents (minus the hero) each take a village spot. */
export function placeNpcs(snapshot: Snapshot, map: WorldMap): { agent: AgentView; x: number; y: number }[] {
  const placed: { agent: AgentView; x: number; y: number }[] = [];
  for (const village of map.villages) {
    const residents = snapshot.agents
      .filter((a) => a.region === village.regionId && a.role !== "treasury" && a.id !== snapshot.me.agentId)
      .sort((a, b) => a.id.localeCompare(b.id));
    residents.forEach((agent, i) => {
      const spot = village.spots[i % village.spots.length] ?? [village.x + 2, village.y + 2];
      placed.push({ agent, x: spot[0], y: spot[1] });
    });
  }
  return placed;
}

/** Where the hero stands on (re)load: outside their village gate, or world center. */
export function heroSpawn(snapshot: Snapshot, map: WorldMap): readonly [number, number] {
  const home = snapshot.me.agentId?.split("@")[1];
  const village = map.villages.find((v) => v.regionId === home);
  if (village) return [village.x + Math.floor(PLOT_W / 2), village.y + PLOT_H - 4] as const;
  return [Math.floor(MAP_W / 2), Math.floor(MAP_H / 2) + 8] as const;
}
