// World layout, derived deterministically from the snapshot: same regions in, same
// map out — every player must see the same world, so all randomness is seeded.
// Each village's character (size, building placement, rocks/ponds/flowers) comes
// from a PRNG seeded by its regionId; the overworld decoration from a coordinate
// hash. Pure data — no DOM, no Math.random, so it is unit-testable.

import type { AgentView, Snapshot } from "../shared";

export const MAP_W = 120;
export const MAP_H = 80;
export const MIN_PLOT_W = 16;
export const MAX_PLOT_W = 20;
export const MIN_PLOT_H = 12;
export const MAX_PLOT_H = 15;

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
  HallRoof = 12,
  HallDoor = 13,
  MintRoof = 14,
  MintDoor = 15,
  CourtRoof = 16,
  CourtDoor = 17,
  Rock = 18,
  Flower = 19,
}

const SOLID: ReadonlySet<Tile> = new Set([
  Tile.Tree,
  Tile.Water,
  Tile.Fence,
  Tile.HouseWall,
  Tile.HouseRoof,
  Tile.HouseDoor,
  Tile.Sign,
  Tile.Chest,
  Tile.HallRoof,
  Tile.HallDoor,
  Tile.MintRoof,
  Tile.MintDoor,
  Tile.CourtRoof,
  Tile.CourtDoor,
  Tile.Rock,
]);

/** Village slot origins (top-left), spaced for the largest possible plot (20x15). */
export const SLOTS: readonly (readonly [number, number])[] = [
  [10, 8],
  [52, 8],
  [94, 8],
  [10, 32],
  [52, 32],
  [94, 32],
  [10, 56],
  [52, 56],
  [94, 56],
];

export interface Village {
  readonly regionId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The gate tile in the south fence; the hero spawns just inside it. */
  readonly gate: readonly [number, number];
  readonly sign: readonly [number, number];
  readonly chest: readonly [number, number];
  /** Civic building doors: town hall (governance), mint (items), courthouse (votes). */
  readonly hall: readonly [number, number];
  readonly mint: readonly [number, number];
  readonly court: readonly [number, number];
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

/** Deterministic per-village PRNG (mulberry32 over a string hash of the regionId). */
export function villageRng(regionId: string): () => number {
  let h = 1779033703 ^ regionId.length;
  for (let i = 0; i < regionId.length; i++) {
    h = Math.imul(h ^ regionId.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function get(tiles: Uint8Array, x: number, y: number): Tile {
  return (tiles[y * MAP_W + x] ?? Tile.Water) as Tile;
}

function carveVillage(
  tiles: Uint8Array,
  regionId: string,
  slotIndex: number,
  residents: number,
): Omit<Village, "regionId" | "displayName"> {
  const rng = villageRng(regionId);
  const slot = SLOTS[slotIndex % SLOTS.length] ?? SLOTS[0]!;
  const [vx, vy] = slot;
  const w = MIN_PLOT_W + Math.floor(rng() * (MAX_PLOT_W - MIN_PLOT_W + 1));
  const h = MIN_PLOT_H + Math.floor(rng() * (MAX_PLOT_H - MIN_PLOT_H + 1));

  // Clear the plot, fence the perimeter, open a south gate at a random position.
  for (let y = vy; y < vy + h; y++) {
    for (let x = vx; x < vx + w; x++) {
      set(tiles, x, y, (x + y) % 7 === 0 ? Tile.Grass2 : Tile.Grass);
    }
  }
  for (let x = vx; x < vx + w; x++) {
    set(tiles, x, vy, Tile.Fence);
    set(tiles, x, vy + h - 1, Tile.Fence);
  }
  for (let y = vy; y < vy + h; y++) {
    set(tiles, vx, y, Tile.Fence);
    set(tiles, vx + w - 1, y, Tile.Fence);
  }
  const gx = vx + 3 + Math.floor(rng() * (w - 6));
  set(tiles, gx, vy + h - 1, Tile.Path);
  set(tiles, gx, vy + h - 2, Tile.Path);
  set(tiles, gx, vy + h, Tile.Path);

  // Civic row: hall / mint / court in a village-specific order, jittered inside
  // three zones so no two villages share a skyline.
  const order: readonly ["hall" | "mint" | "court", Tile, Tile][] = [
    ["hall", Tile.HallRoof, Tile.HallDoor],
    ["mint", Tile.MintRoof, Tile.MintDoor],
    ["court", Tile.CourtRoof, Tile.CourtDoor],
  ];
  const shuffled = [...order];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = a;
  }
  const zone = Math.floor((w - 2) / 3);
  const doors: Partial<Record<"hall" | "mint" | "court", readonly [number, number]>> = {};
  shuffled.forEach(([kind, roof, door], i) => {
    const jitter = Math.floor(rng() * Math.max(1, zone - 3));
    const bx = Math.min(vx + 1 + i * zone + jitter, vx + w - 4);
    for (let x = bx; x < bx + 3; x++) {
      set(tiles, x, vy + 1, roof);
      set(tiles, x, vy + 2, Tile.HouseWall);
    }
    set(tiles, bx + 1, vy + 2, door);
    doors[kind] = [bx + 1, vy + 2] as const;
  });
  const hall = doors.hall ?? ([vx + 2, vy + 2] as const);
  const mint = doors.mint ?? ([vx + 7, vy + 2] as const);
  const court = doors.court ?? ([vx + 12, vy + 2] as const);

  const isFree = (x: number, y: number): boolean => {
    const t = get(tiles, x, y);
    return (t === Tile.Grass || t === Tile.Grass2) && x !== gx;
  };

  // The treasury chest lands on a free wall-row cell (beside a civic building).
  let chest: readonly [number, number] = [vx + w - 2, vy + 2];
  for (let tries = 0; tries < 20; tries++) {
    const cx = vx + 1 + Math.floor(rng() * (w - 2));
    if (isFree(cx, vy + 2)) {
      chest = [cx, vy + 2] as const;
      break;
    }
  }
  set(tiles, chest[0], chest[1], Tile.Chest);

  // Resident houses: candidate cells in loose rows below the civic row, shuffled.
  const candidates: (readonly [number, number])[] = [];
  for (let hy = vy + 4; hy + 2 <= vy + h - 3; hy += 3) {
    for (let hx = vx + 2; hx + 2 <= vx + w - 2; hx += 5) {
      const jx = hx + Math.floor(rng() * 2);
      if (jx + 2 > vx + w - 2) continue;
      if (gx >= jx && gx <= jx + 2) continue; // keep the gate column clear
      candidates.push([jx, hy] as const);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = a;
  }
  const houses = candidates.slice(0, Math.min(Math.max(residents, 1), candidates.length));
  const spots: (readonly [number, number])[] = [];
  for (const [hx, hy] of houses) {
    for (let x = hx; x < hx + 3; x++) {
      set(tiles, x, hy, Tile.HouseRoof);
      set(tiles, x, hy + 1, Tile.HouseWall);
    }
    set(tiles, hx + 1, hy + 1, Tile.HouseDoor);
    spots.push([hx + 1, hy + 2] as const);
  }

  // The gate signboard.
  let sign: readonly [number, number] = [gx > vx + 3 ? gx - 2 : gx + 2, vy + h - 2];
  if (!isFree(sign[0], sign[1])) sign = [gx + 2, vy + h - 2] as const;
  set(tiles, sign[0], sign[1], Tile.Sign);

  // Village character: rocks, a pond or two, flowers — counts and places per-region.
  const decor: [Tile, number][] = [
    [Tile.Rock, Math.floor(rng() * 4)],
    [Tile.Water, Math.floor(rng() * 3)],
    [Tile.Flower, 1 + Math.floor(rng() * 5)],
  ];
  for (const [tile, count] of decor) {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 15; tries++) {
        const dx = vx + 1 + Math.floor(rng() * (w - 2));
        const dy = vy + 3 + Math.floor(rng() * (h - 5));
        // Never block a doorway: the cell below any door stays clear.
        const belowDoor = [hall, mint, court, ...houses.map(([hx, hy]) => [hx + 1, hy + 1] as const)].some(
          ([px, py]) => dx === px && dy === py + 1,
        );
        if (isFree(dx, dy) && !belowDoor) {
          set(tiles, dx, dy, tile);
          break;
        }
      }
    }
  }

  // Extra NPC spots on remaining free cells.
  for (let tries = 0; spots.length < 12 && tries < 40; tries++) {
    const sx = vx + 2 + Math.floor(rng() * (w - 4));
    const sy = vy + 3 + Math.floor(rng() * (h - 5));
    if (isFree(sx, sy)) spots.push([sx, sy] as const);
  }

  return { x: vx, y: vy, w, h, gate: [gx, vy + h - 1] as const, sign, chest, hall, mint, court, spots };
}

export function buildMap(snapshot: Snapshot): WorldMap {
  const tiles = new Uint8Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const border = x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2;
      const r = hash2(x, y);
      let t: Tile = r < 0.5 ? Tile.Grass : Tile.Grass2;
      if (r > 0.94) t = Tile.Tree;
      else if (r > 0.925) t = Tile.Rock;
      else if (r < 0.03) t = Tile.Flower;
      if (border) t = Tile.Water;
      else if (x < 4 || y < 4 || x >= MAP_W - 4 || y >= MAP_H - 4) t = r > 0.5 ? Tile.Sand : t;
      tiles[y * MAP_W + x] = t;
    }
  }

  const villages = snapshot.regions.map((region, i) => {
    const residents = snapshot.agents.filter((a) => a.region === region.id && a.role !== "treasury").length;
    const carved = carveVillage(tiles, region.id, i, residents);
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
      const spot = village.spots[i % village.spots.length] ?? [village.x + 2, village.y + 3];
      placed.push({ agent, x: spot[0], y: spot[1] });
    });
  }
  return placed;
}

/** Where the hero stands on (re)load: just inside their village gate, or world center. */
export function heroSpawn(snapshot: Snapshot, map: WorldMap): readonly [number, number] {
  const home = snapshot.me.agentId?.split("@")[1];
  const village = map.villages.find((v) => v.regionId === home);
  if (village) return [village.gate[0], village.gate[1] - 1] as const;
  return [Math.floor(MAP_W / 2), Math.floor(MAP_H / 2) + 8] as const;
}
