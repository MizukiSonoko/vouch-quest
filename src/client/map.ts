// World layout, derived deterministically from the snapshot: same regions in, same
// map out — every player must see the same world, so all randomness is seeded.
// Each village's character (size, building placement, rocks/ponds/flowers) comes
// from a PRNG seeded by its regionId; the overworld decoration from a coordinate
// hash. Pure data — no DOM, no Math.random, so it is unit-testable.

import type { AgentView, Snapshot } from "../shared";
import { friendlyPairs } from "./shop";

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
  Stall = 20,
  RoofGreen = 21,
  RoofBlue = 22,
  RoofBrown = 23,
  WallWood = 24,
  DoorWood = 25,
  Well = 26,
  Farm = 27,
  Lamp = 28,
  WallWindow = 29,
  WallWoodWindow = 30,
  Snow = 31,
  SnowTree = 32,
  Cactus = 33,
  Swamp = 34,
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
  Tile.Stall,
  Tile.RoofGreen,
  Tile.RoofBlue,
  Tile.RoofBrown,
  Tile.WallWood,
  Tile.DoorWood,
  Tile.Well,
  Tile.Farm,
  Tile.Lamp,
  Tile.WallWindow,
  Tile.WallWoodWindow,
  Tile.SnowTree,
  Tile.Cactus,
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
  readonly biome: Biome;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The gate tile in the south fence; the hero spawns just inside it. */
  readonly gate: readonly [number, number];
  readonly sign: readonly [number, number];
  readonly chest: readonly [number, number];
  /** The item shop's market stall. */
  readonly stall: readonly [number, number];
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

// --- biomes: temperature x moisture value-noise, identical for every player -----

export const enum Biome {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Snow = 3,
  Swamp = 4,
}

export const BIOME_JA: Readonly<Record<Biome, string>> = {
  [Biome.Plains]: "そうげん",
  [Biome.Forest]: "しんりん",
  [Biome.Desert]: "さばく",
  [Biome.Snow]: "せつげん",
  [Biome.Swamp]: "しっち",
};

/** Smooth value noise: bilinear interpolation over the coordinate hash lattice. */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0 + seed, y0);
  const b = hash2(x0 + 1 + seed, y0);
  const c = hash2(x0 + seed, y0 + 1);
  const d = hash2(x0 + 1 + seed, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function biomeAt(x: number, y: number): Biome {
  const heat = valueNoise(x, y, 26, 1000);
  const wet = valueNoise(x, y, 22, 7777);
  if (heat > 0.72) return Biome.Desert;
  if (heat < 0.28) return Biome.Snow;
  if (wet > 0.68) return Biome.Swamp;
  if (wet < 0.38) return Biome.Forest;
  return Biome.Plains;
}

/** The two ground tiles a biome walks on (used by terrain and village floors). */
export function biomeGround(biome: Biome): readonly [Tile, Tile] {
  switch (biome) {
    case Biome.Desert:
      return [Tile.Sand, Tile.Sand] as const;
    case Biome.Snow:
      return [Tile.Snow, Tile.Snow] as const;
    case Biome.Swamp:
      return [Tile.Swamp, Tile.Swamp] as const;
    default:
      return [Tile.Grass, Tile.Grass2] as const;
  }
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
  const biome = biomeAt(vx + Math.floor(w / 2), vy + Math.floor(h / 2));
  const [g1, g2] = biomeGround(biome);

  // Clear the plot to the biome's ground, fence it, open a south gate.
  for (let y = vy; y < vy + h; y++) {
    for (let x = vx; x < vx + w; x++) {
      set(tiles, x, y, (x + y) % 7 === 0 ? g2 : g1);
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

  const inside = (x: number, y: number): boolean => x > vx && x < vx + w - 1 && y > vy && y < vy + h - 1;
  const protectedCells = new Set<string>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (let y = vy + 1; y < vy + h; y++) protectedCells.add(key(gx, y)); // the gate lane stays open

  interface Build {
    readonly roof: Tile;
    readonly wall: Tile;
    readonly door: Tile;
    readonly window: Tile;
  }

  /** Draw a building with a 2-row roof and 1-2 wall rows; returns its door and cells. */
  const drawBuilding = (
    bx: number,
    by: number,
    bw: number,
    roofRows: number,
    wallRows: number,
    b: Build,
  ): { door: readonly [number, number]; cells: (readonly [number, number])[] } => {
    const cells: (readonly [number, number])[] = [];
    for (let r = 0; r < roofRows; r++) {
      for (let x = bx; x < bx + bw; x++) {
        set(tiles, x, by + r, b.roof);
        cells.push([x, by + r] as const);
      }
    }
    const doorX = bx + (bw <= 2 ? Math.floor(rng() * bw) : 1 + Math.floor(rng() * (bw - 2)));
    const doorY = by + roofRows + wallRows - 1;
    for (let r = 0; r < wallRows; r++) {
      for (let x = bx; x < bx + bw; x++) {
        const y = by + roofRows + r;
        const isDoor = y === doorY && x === doorX;
        const tile = isDoor ? b.door : rng() < 0.3 ? b.window : b.wall;
        set(tiles, x, y, tile);
        cells.push([x, y] as const);
      }
    }
    return { door: [doorX, doorY] as const, cells };
  };

  const overlapsProtected = (bx: number, by: number, bw: number, bh: number): boolean => {
    for (let y = by; y < by + bh + 1; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if (!inside(x, y) || protectedCells.has(key(x, y))) return true;
      }
    }
    return false;
  };

  // Civic buildings, placed freely — each protects its footprint and doorstep so it
  // stays reachable no matter how the houses later crowd around it.
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
  const doors: Partial<Record<"hall" | "mint" | "court", readonly [number, number]>> = {};
  shuffled.forEach(([kind, roof, door], i) => {
    const roofRows = 2;
    const wallRows = kind === "hall" ? 2 : 1;
    const bh = roofRows + wallRows;
    let placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const bx = vx + 1 + Math.floor(rng() * (w - 4));
      const by = vy + 1 + Math.floor(rng() * Math.max(1, h - bh - 4));
      if (overlapsProtected(bx, by, 3, bh)) continue;
      const built = drawBuilding(bx, by, 3, roofRows, wallRows, { roof, wall: Tile.HouseWall, door, window: Tile.WallWindow });
      for (const [cx, cy] of built.cells) protectedCells.add(key(cx, cy));
      protectedCells.add(key(built.door[0], built.door[1] + 1));
      set(tiles, built.door[0], built.door[1] + 1, g1);
      doors[kind] = built.door;
      placed = true;
    }
    if (!placed) {
      // Crowded corner case: fall back to a fixed spot along the top.
      const bx = vx + 1 + i * 5;
      const built = drawBuilding(bx, vy + 1, 3, roofRows, wallRows, { roof, wall: Tile.HouseWall, door, window: Tile.WallWindow });
      for (const [cx, cy] of built.cells) protectedCells.add(key(cx, cy));
      protectedCells.add(key(built.door[0], built.door[1] + 1));
      doors[kind] = built.door;
    }
  });
  const hall = doors.hall ?? ([vx + 2, vy + 3] as const);
  const mint = doors.mint ?? ([vx + 7, vy + 3] as const);
  const court = doors.court ?? ([vx + 12, vy + 3] as const);

  // Houses: FREE placement — overlap is allowed, so clusters, terraces, and alleys
  // emerge. A door swallowed by a later extension just means the family built on.
  const ROOFS: readonly Tile[] = [Tile.HouseRoof, Tile.RoofGreen, Tile.RoofBlue, Tile.RoofBrown];
  const houseDoors: { door: readonly [number, number]; tile: Tile }[] = [];
  const houses = Math.min(Math.max(residents, 1), 8);
  for (let i = 0; i < houses; i++) {
    const bw = 2 + Math.floor(rng() * 3); // 2..4 wide
    const roofRows = rng() < 0.6 ? 2 : 1;
    const bh = roofRows + 1;
    const roof = ROOFS[Math.floor(rng() * ROOFS.length)] ?? Tile.HouseRoof;
    const wood = rng() < 0.4;
    const build: Build = wood
      ? { roof, wall: Tile.WallWood, door: Tile.DoorWood, window: Tile.WallWoodWindow }
      : { roof, wall: Tile.HouseWall, door: Tile.HouseDoor, window: Tile.WallWindow };
    for (let tries = 0; tries < 20; tries++) {
      const bx = vx + 1 + Math.floor(rng() * (w - 1 - bw));
      const by = vy + 1 + Math.floor(rng() * Math.max(1, h - bh - 3));
      if (overlapsProtected(bx, by, bw, bh)) continue;
      const built = drawBuilding(bx, by, bw, roofRows, 1, build);
      houseDoors.push({ door: built.door, tile: build.door });
      break;
    }
  }
  // Keep only doors that survived later construction, and clear each doorstep.
  const spots: (readonly [number, number])[] = [];
  for (const { door, tile } of houseDoors) {
    if (get(tiles, door[0], door[1]) !== tile) continue;
    const front: readonly [number, number] = [door[0], door[1] + 1];
    if (!inside(front[0], front[1]) || protectedCells.has(key(front[0], front[1]))) continue;
    set(tiles, front[0], front[1], g1);
    spots.push(front);
  }

  const isFree = (x: number, y: number): boolean => {
    const t = get(tiles, x, y);
    return (t === g1 || t === g2 || t === Tile.Grass || t === Tile.Grass2) && x !== gx && !protectedCells.has(key(x, y));
  };

  // The treasury chest lands on any free cell in the upper half of the village.
  let chest: readonly [number, number] = [vx + w - 2, vy + h - 3];
  for (let tries = 0; tries < 30; tries++) {
    const cx = vx + 1 + Math.floor(rng() * (w - 2));
    const cy = vy + 1 + Math.floor(rng() * Math.floor(h / 2));
    if (isFree(cx, cy)) {
      chest = [cx, cy] as const;
      break;
    }
  }
  set(tiles, chest[0], chest[1], Tile.Chest);

  // The gate signboard.
  let sign: readonly [number, number] = [gx > vx + 3 ? gx - 2 : gx + 2, vy + h - 2];
  if (!isFree(sign[0], sign[1])) sign = [gx + 2, vy + h - 2] as const;
  set(tiles, sign[0], sign[1], Tile.Sign);

  // The item shop's stall, on a free cell near the gate (opposite side from the sign).
  let stall: readonly [number, number] = [gx > vx + 3 ? gx + 2 : gx - 2, vy + h - 3];
  if (!isFree(stall[0], stall[1])) {
    stall = [gx + 2, vy + h - 3] as const;
    for (let tries = 0; !isFree(stall[0], stall[1]) && tries < 20; tries++) {
      stall = [vx + 2 + Math.floor(rng() * (w - 4)), vy + 3 + Math.floor(rng() * (h - 6))] as const;
    }
  }
  set(tiles, stall[0], stall[1], Tile.Stall);

  // Village character: a well, lamps, farm plots, rocks, ponds, flowers — all per-region.
  const lush = biome === Biome.Plains || biome === Biome.Forest;
  const decor: [Tile, number][] = [
    [Tile.Well, rng() < 0.75 ? 1 : 0],
    [Tile.Lamp, 1 + Math.floor(rng() * 2)],
    [Tile.Rock, Math.floor(rng() * (biome === Biome.Desert || biome === Biome.Snow ? 6 : 4))],
    [Tile.Water, biome === Biome.Desert ? (rng() < 0.4 ? 1 : 0) : Math.floor(rng() * 3)],
    [Tile.Flower, lush ? 1 + Math.floor(rng() * 5) : 0],
    [Tile.Cactus, biome === Biome.Desert ? 1 + Math.floor(rng() * 3) : 0],
    [Tile.SnowTree, biome === Biome.Snow ? 1 + Math.floor(rng() * 2) : 0],
  ];
  for (const [tile, count] of decor) {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 15; tries++) {
        const dx = vx + 1 + Math.floor(rng() * (w - 2));
        const dy = vy + 3 + Math.floor(rng() * (h - 5));
        if (isFree(dx, dy) && !spots.some(([sx, sy]) => sx === dx && sy === dy)) {
          set(tiles, dx, dy, tile);
          break;
        }
      }
    }
  }

  // Farm plots: little tilled clusters (up to 2x2 each), where the land is free.
  const farms = lush || biome === Biome.Swamp ? Math.floor(rng() * 3) : 0;
  for (let i = 0; i < farms; i++) {
    for (let tries = 0; tries < 12; tries++) {
      const fx = vx + 2 + Math.floor(rng() * (w - 5));
      const fy = vy + 3 + Math.floor(rng() * (h - 6));
      if (!isFree(fx, fy)) continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const px = fx + dx;
        const py = fy + dy;
        if (isFree(px, py) && !spots.some(([sx, sy]) => sx === px && sy === py)) set(tiles, px, py, Tile.Farm);
      }
      break;
    }
  }

  // Extra NPC spots on remaining free cells.
  for (let tries = 0; spots.length < 12 && tries < 40; tries++) {
    const sx = vx + 2 + Math.floor(rng() * (w - 4));
    const sy = vy + 3 + Math.floor(rng() * (h - 5));
    if (isFree(sx, sy)) spots.push([sx, sy] as const);
  }

  return { x: vx, y: vy, w, h, biome, gate: [gx, vy + h - 1] as const, sign, chest, stall, hall, mint, court, spots };
}

export function buildMap(snapshot: Snapshot): WorldMap {
  const tiles = new Uint8Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const border = x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2;
      const r = hash2(x, y);
      const biome = biomeAt(x, y);
      const [g1, g2] = biomeGround(biome);
      let t: Tile = r < 0.5 ? g1 : g2;
      switch (biome) {
        case Biome.Forest:
          if (r > 0.78) t = Tile.Tree;
          else if (r > 0.765) t = Tile.Rock;
          else if (r < 0.015) t = Tile.Flower;
          break;
        case Biome.Desert:
          if (r > 0.95) t = Tile.Cactus;
          else if (r > 0.92) t = Tile.Rock;
          break;
        case Biome.Snow:
          if (r > 0.92) t = Tile.SnowTree;
          else if (r > 0.90) t = Tile.Rock;
          break;
        case Biome.Swamp:
          if (r > 0.86) t = Tile.Water;
          else if (r > 0.82) t = Tile.Tree;
          break;
        default:
          if (r > 0.94) t = Tile.Tree;
          else if (r > 0.925) t = Tile.Rock;
          else if (r < 0.03) t = Tile.Flower;
      }
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

  // Diplomacy made visible: mutually friendly villages get a road between their
  // gates. Roads never cut through a village plot — a fence stays a fence.
  const inAnyPlot = (x: number, y: number): boolean =>
    villages.some((v) => x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h);
  const pave = (x: number, y: number): void => {
    if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2 || inAnyPlot(x, y)) return;
    set(tiles, x, y, Tile.Path);
  };
  for (const [aId, bId] of friendlyPairs(snapshot.regions)) {
    const a = villages.find((v) => v.regionId === aId);
    const b = villages.find((v) => v.regionId === bId);
    if (!a || !b) continue;
    const [ax, ayGate] = a.gate;
    const [bx, byGate] = b.gate;
    const ay = ayGate + 1;
    const by = byGate + 1;
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) pave(ax, y);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) pave(x, by);
  }

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
