// World layout, derived deterministically from the snapshot: same regions in, same
// map out — every player must see the same world, so all randomness is seeded.
// Each village's character (size, building placement, rocks/ponds/flowers) comes
// from a PRNG seeded by its regionId; the overworld decoration from a coordinate
// hash. Pure data — no DOM, no Math.random, so it is unit-testable.

import type { AgentView, Snapshot } from "../shared";
import { AFTERLIFE } from "./life";
import { friendlyPairs } from "./shop";

export const MAP_W = 360;
export const MAP_H = 240;
export const MIN_PLOT_W = 14;
export const MAX_PLOT_W = 34;
export const MIN_PLOT_H = 11;
export const MAX_PLOT_H = 19;

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
  Pavement = 35,
  Rail = 36,
  BuildingWall = 37,
  BuildingRoof = 38,
  Station = 39,
  Poster = 40,
  HospitalRoof = 41,
  HospitalDoor = 42,
  Airport = 43,
  Plant = 44,
  Substation = 45,
  TowerWall = 46,
  TowerGlass = 47,
  TowerTop = 48,
  RailElevated = 49,
  RoadElevated = 50,
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
  Tile.BuildingWall,
  Tile.BuildingRoof,
  Tile.Station,
  Tile.Poster,
  Tile.HospitalRoof,
  Tile.HospitalDoor,
  Tile.Airport,
  Tile.Plant,
  Tile.Substation,
  Tile.TowerWall,
  Tile.TowerGlass,
  Tile.TowerTop,
]);

/** Village slot origins (top-left), an 8x7 lattice spaced for the largest plot (34x34). */
export const SLOTS: readonly (readonly [number, number])[] = Array.from({ length: 56 }, (_, i) => {
  const col = i % 8;
  const row = Math.floor(i / 8);
  return [10 + col * 43, 6 + row * 32] as const;
});

export interface Village {
  readonly regionId: string;
  readonly displayName: string;
  readonly biome: Biome;
  /** Every tile this settlement occupies (packed y*MAP_W+x) — shapes are organic, not boxes. */
  readonly cells: ReadonlySet<number>;
  /** Development: 0 むら, 1 まち, 2 とし (real population + treasury drive it). */
  readonly tier: number;
  /** The train station platform, if this settlement grew into a city. */
  readonly station: readonly [number, number] | null;
  /** The airport terminal, once the settlement is a metropolis. */
  readonly airport: readonly [number, number] | null;
  /** The power plant (metropolis) and substation (town+); electricity follows. */
  readonly plant: readonly [number, number] | null;
  readonly substation: readonly [number, number] | null;
  /** Whether the settlement is on the grid (a plant is in transmission range). */
  powered: boolean;
  /** Municipal nesting: the city whose territory contains this settlement's centre (むらの中のむら). */
  parent: string | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The gate tile in the south fence; the hero spawns just inside it. */
  readonly gate: readonly [number, number];
  readonly sign: readonly [number, number];
  /** The notice board by the gate — wanted posters and town gossip. */
  readonly poster: readonly [number, number];
  readonly chest: readonly [number, number];
  /** The item shop's market stall. */
  readonly stall: readonly [number, number];
  /** Civic building doors: town hall (governance), mint (items), courthouse (votes). */
  readonly hall: readonly [number, number];
  readonly mint: readonly [number, number];
  readonly court: readonly [number, number];
  /** The hospital door, once the settlement is at least a town. */
  readonly hospital: readonly [number, number] | null;
  /** Interior spawn points for resident NPCs. */
  readonly spots: readonly (readonly [number, number])[];
  /** Front doors of the resident houses (enterable), in resident order. */
  readonly homes: readonly (readonly [number, number])[];
}

export interface WorldMap {
  readonly tiles: Uint8Array;
  readonly villages: readonly Village[];
  /** Rail segments (tile-coordinate polylines) for the running trains. */
  readonly rails: readonly (readonly (readonly [number, number])[])[];
  /** Ground rail polylines only — the walkable subway network runs beneath these. */
  readonly subways: readonly (readonly (readonly [number, number])[])[];
  /** Road polylines between friendly villages — the caravans travel these. */
  readonly roads: readonly (readonly (readonly [number, number])[])[];
  /** Highway polylines between friendly CITIES — trucks thunder along these. */
  readonly highways: readonly (readonly (readonly [number, number])[])[];
  /** Transmission lines: [plant, substation] endpoint pairs, in tile coords. */
  readonly powerLines: readonly (readonly [readonly [number, number], readonly [number, number]])[];
}

/** How far a settlement has developed, from its REAL population and treasury. */
export function devTier(residents: number, treasury: number): number {
  if (residents >= 12 || treasury >= 200) return 3; // metropolis: airport-grade
  if (residents >= 6 || treasury >= 80) return 2;
  if (residents >= 4 || treasury >= 25) return 1;
  return 0;
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

export function villageContains(v: Village, x: number, y: number): boolean {
  return v.cells.has(y * MAP_W + x);
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
  tier: number,
): Omit<Village, "regionId" | "displayName"> {
  const rng = villageRng(regionId);
  const slot = SLOTS[slotIndex % SLOTS.length] ?? SLOTS[0]!;
  const [vx, vy] = slot;
  // Territory grows with the settlement: population and development push the
  // fence outward, from a hamlet's clearing to a city's sprawl.
  const w = Math.max(MIN_PLOT_W, Math.min(MAX_PLOT_W, 14 + residents + tier * 3 + Math.floor(rng() * 3)));
  const h = Math.max(MIN_PLOT_H, Math.min(MAX_PLOT_H, 10 + Math.floor(residents / 2) + tier * 2 + Math.floor(rng() * 3)));
  const biome = biomeAt(vx + Math.floor(w / 2), vy + Math.floor(h / 2));
  // A full city paves over its biome; towns and villages keep the local ground.
  const [g1, g2] = tier >= 2 ? ([Tile.Pavement, Tile.Pavement] as const) : biomeGround(biome);

  // The settlement's shape is an organic blob: a radial polygon whose radius
  // wobbles per angle. Star-convex, so the interior is always connected.
  const ANGLES = 16;
  const wobble = Array.from({ length: ANGLES }, () => 0.68 + rng() * 0.32);
  const ccx = vx + w / 2;
  const ccy = vy + h / 2;
  const insideMask = (x: number, y: number): boolean => {
    const dx = (x + 0.5 - ccx) / (w / 2);
    const dy = (y + 0.5 - ccy) / (h / 2);
    const r = Math.hypot(dx, dy);
    const a = ((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * ANGLES;
    const i0 = Math.floor(a) % ANGLES;
    const f = a - Math.floor(a);
    const m = (wobble[i0] ?? 1) * (1 - f) + (wobble[(i0 + 1) % ANGLES] ?? 1) * f;
    return r <= m;
  };
  const cells = new Set<number>();
  for (let y = vy; y < vy + h; y++) {
    for (let x = vx; x < vx + w; x++) {
      if (insideMask(x, y)) cells.add(y * MAP_W + x);
    }
  }
  const inCells = (x: number, y: number): boolean => cells.has(y * MAP_W + x);
  const isBoundary = (x: number, y: number): boolean =>
    inCells(x, y) && (!inCells(x + 1, y) || !inCells(x - 1, y) || !inCells(x, y + 1) || !inCells(x, y - 1));

  // Ground everywhere inside; a fence traces the organic edge.
  for (const packed of cells) {
    const y = Math.floor(packed / MAP_W);
    const x = packed % MAP_W;
    set(tiles, x, y, isBoundary(x, y) ? Tile.Fence : (x + y) % 7 === 0 ? g2 : g1);
  }

  // The gate: the southernmost fence cell near the center column, opened as path.
  let gx = Math.floor(ccx);
  let gy = vy + h - 1;
  outer: for (let dxs = 0; dxs < w; dxs++) {
    const tryX = Math.floor(ccx) + (dxs % 2 === 0 ? dxs / 2 : -(dxs + 1) / 2);
    for (let y = vy + h - 1; y > vy; y--) {
      if (inCells(tryX, y) && inCells(tryX, y - 1) && !isBoundary(tryX, y - 1)) {
        gx = tryX;
        gy = y;
        break outer;
      }
    }
  }
  set(tiles, gx, gy, Tile.Path);
  set(tiles, gx, gy + 1, Tile.Path);
  set(tiles, gx, gy + 2, Tile.Path);

    const inside = (x: number, y: number): boolean => inCells(x, y) && !isBoundary(x, y);
  const protectedCells = new Set<string>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (let y = gy - 4; y <= gy; y++) protectedCells.add(key(gx, y)); // the gate lane stays open

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

  const overlapsProtected = (bx: number, by: number, bw: number, bh: number, relax: 0 | 1 | 2 = 0): boolean => {
    for (let y = by; y < by + bh + 1; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if (protectedCells.has(key(x, y))) return true;
        if (relax === 0 && !inside(x, y)) return true;
        if (relax === 1 && !inCells(x, y)) return true;
        if (relax === 2 && (x <= vx || x >= vx + w - 1 || y <= vy || y >= vy + h - 2)) return true;
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
  shuffled.forEach(([kind, roof, door]) => {
    const roofRows = 2;
    const wallRows = kind === "hall" && w >= 20 ? 2 : 1;
    const bh = roofRows + wallRows;
    const place = (bx: number, by: number): void => {
      const built = drawBuilding(bx, by, 3, roofRows, wallRows, { roof, wall: Tile.HouseWall, door, window: Tile.WallWindow });
      for (const [cx, cy] of built.cells) protectedCells.add(key(cx, cy));
      protectedCells.add(key(built.door[0], built.door[1] + 1));
      set(tiles, built.door[0], built.door[1] + 1, g1);
      doors[kind] = built.door;
    };
    let placed = false;
    for (let tries = 0; tries < 120 && !placed; tries++) {
      const bx = vx + 1 + Math.floor(rng() * (w - 4));
      const by = vy + 1 + Math.floor(rng() * Math.max(1, h - bh - 4));
      if (overlapsProtected(bx, by, 3, bh)) continue;
      place(bx, by);
      placed = true;
    }
    // Cramped blob: sweep every position, relaxing the terrain requirement in
    // stages (interior → within the fence line → anywhere on the plot), but
    // never overwriting another protected structure.
    for (const relax of [0, 1, 2] as const) {
      if (placed) break;
      for (let by = vy + 1; by <= vy + h - bh - 3 && !placed; by++) {
        for (let bx = vx + 1; bx <= vx + w - 4 && !placed; bx++) {
          if (overlapsProtected(bx, by, 3, bh, relax)) continue;
          place(bx, by);
          placed = true;
        }
      }
    }
  });
  const hall = doors.hall ?? ([vx + 2, vy + 3] as const);
  const mint = doors.mint ?? ([vx + 7, vy + 3] as const);
  const court = doors.court ?? ([vx + 12, vy + 3] as const);

  // Towns and cities staff a hospital (the cross-marked house of healing).
  let hospital: readonly [number, number] | null = null;
  if (tier >= 1) {
    for (let tries = 0; tries < 200 && !hospital; tries++) {
      const bx = vx + 2 + Math.floor(rng() * Math.max(1, w - 6));
      const by = vy + 2 + Math.floor(rng() * Math.max(1, h - 8));
      if (overlapsProtected(bx, by, 3, 3)) continue;
      const built = drawBuilding(bx, by, 3, 2, 1, { roof: Tile.HospitalRoof, wall: Tile.HouseWall, door: Tile.HospitalDoor, window: Tile.WallWindow });
      for (const [cx2, cy2] of built.cells) protectedCells.add(key(cx2, cy2));
      protectedCells.add(key(built.door[0], built.door[1] + 1));
      set(tiles, built.door[0], built.door[1] + 1, g1);
      hospital = built.door;
    }
    for (let by = vy + 1; by <= vy + h - 5 && !hospital; by++) {
      for (let bx = vx + 1; bx <= vx + w - 4 && !hospital; bx++) {
        if (overlapsProtected(bx, by, 3, 3)) continue;
        const built = drawBuilding(bx, by, 3, 2, 1, { roof: Tile.HospitalRoof, wall: Tile.HouseWall, door: Tile.HospitalDoor, window: Tile.WallWindow });
        for (const [cx2, cy2] of built.cells) protectedCells.add(key(cx2, cy2));
        protectedCells.add(key(built.door[0], built.door[1] + 1));
        set(tiles, built.door[0], built.door[1] + 1, g1);
        hospital = built.door;
      }
    }
    if (!hospital) {
      // The blob was too cramped for a clean fit: build it beside the hall anyway.
      const bx = Math.max(vx + 1, Math.min(hall[0] + 2, vx + w - 4));
      const by = Math.max(vy + 1, hall[1] + 2);
      const built = drawBuilding(bx, by, 3, 2, 1, { roof: Tile.HospitalRoof, wall: Tile.HouseWall, door: Tile.HospitalDoor, window: Tile.WallWindow });
      for (const [cx2, cy2] of built.cells) protectedCells.add(key(cx2, cy2));
      protectedCells.add(key(built.door[0], built.door[1] + 1));
      set(tiles, built.door[0], built.door[1] + 1, g1);
      hospital = built.door;
    }
  }

  // Houses: FREE placement — overlap is allowed, so clusters, terraces, and alleys
  // emerge. A door swallowed by a later extension just means the family built on.
  const ROOFS: readonly Tile[] = [Tile.HouseRoof, Tile.RoofGreen, Tile.RoofBlue, Tile.RoofBrown];
  const houseDoors: { door: readonly [number, number]; tile: Tile }[] = [];
  const houses = Math.min(Math.max(residents, 1), 20);
  for (let i = 0; i < houses; i++) {
    // Cities raise towers; towns get the occasional tall house; villages stay low.
    const tower = tier >= 2 && rng() < 0.55;
    const bw = tower ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 4);
    const roofRows = tower ? 1 : rng() < 0.6 ? 2 : 1;
    const wallRows = tower ? 3 + Math.floor(rng() * 3) : rng() < 0.2 ? 2 : 1;
    const bh = roofRows + wallRows;
    const roof = tower ? Tile.BuildingRoof : (ROOFS[Math.floor(rng() * ROOFS.length)] ?? Tile.HouseRoof);
    const wood = !tower && rng() < 0.4;
    const build: Build = tower
      ? { roof, wall: Tile.BuildingWall, door: Tile.HouseDoor, window: Tile.BuildingWall }
      : wood
        ? { roof, wall: Tile.WallWood, door: Tile.DoorWood, window: Tile.WallWoodWindow }
        : { roof, wall: Tile.HouseWall, door: Tile.HouseDoor, window: Tile.WallWindow };
    for (let tries = 0; tries < 20; tries++) {
      const bx = vx + 1 + Math.floor(rng() * (w - 1 - bw));
      const by = vy + 1 + Math.floor(rng() * Math.max(1, h - bh - 3));
      if (overlapsProtected(bx, by, bw, bh)) continue;
      const built = drawBuilding(bx, by, bw, roofRows, wallRows, build);
      houseDoors.push({ door: built.door, tile: build.door });
      break;
    }
  }
  // だいとし raise true skyscrapers — glass towers piercing the skyline. They
  // go up AFTER the houses: redevelopment builds on top of the old quarter.
  if (tier >= 3) {
    const towerCount = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < towerCount; i++) {
      const bw = 2 + Math.floor(rng() * 2);
      const wallRows = 5 + Math.floor(rng() * 3);
      for (let tries = 0; tries < 30; tries++) {
        const bx = vx + 1 + Math.floor(rng() * Math.max(1, w - 1 - bw));
        const by = vy + 1 + Math.floor(rng() * Math.max(1, h - wallRows - 4));
        if (overlapsProtected(bx, by, bw, wallRows + 1)) continue;
        const built = drawBuilding(bx, by, bw, 1, wallRows, { roof: Tile.TowerTop, wall: Tile.TowerWall, door: Tile.HouseDoor, window: Tile.TowerGlass });
        houseDoors.push({ door: built.door, tile: Tile.HouseDoor });
        break;
      }
    }
  }

  // Keep only doors that survived later construction, and clear each doorstep.
  const spots: (readonly [number, number])[] = [];
  const homes: (readonly [number, number])[] = [];
  for (const { door, tile } of houseDoors) {
    if (get(tiles, door[0], door[1]) !== tile) continue;
    const front: readonly [number, number] = [door[0], door[1] + 1];
    if (!inside(front[0], front[1]) || protectedCells.has(key(front[0], front[1]))) continue;
    set(tiles, front[0], front[1], g1);
    spots.push(front);
    homes.push(door);
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

  // The gate signboard, somewhere just inside the gate.
  let sign: readonly [number, number] = [gx - 2, gy - 1];
  if (!isFree(sign[0], sign[1])) sign = [gx + 2, gy - 1] as const;
  for (let tries = 0; !isFree(sign[0], sign[1]) && tries < 30; tries++) {
    sign = [vx + 2 + Math.floor(rng() * (w - 4)), vy + 2 + Math.floor(rng() * (h - 4))] as const;
  }
  set(tiles, sign[0], sign[1], Tile.Sign);

  // The notice board, pinned near the signboard.
  let poster: readonly [number, number] = [sign[0] - 1, sign[1]];
  for (let tries = 0; !isFree(poster[0], poster[1]) && tries < 30; tries++) {
    poster = [vx + 2 + Math.floor(rng() * (w - 4)), vy + 2 + Math.floor(rng() * (h - 4))] as const;
  }
  set(tiles, poster[0], poster[1], Tile.Poster);

  // The item shop's stall, on a free cell near the gate (opposite side from the sign).
  let stall: readonly [number, number] = [gx + 2, gy - 2];
  for (let tries = 0; !isFree(stall[0], stall[1]) && tries < 30; tries++) {
    stall = [vx + 2 + Math.floor(rng() * (w - 4)), vy + 2 + Math.floor(rng() * (h - 4))] as const;
  }
  set(tiles, stall[0], stall[1], Tile.Stall);

  // Village character: a well, lamps, farm plots, rocks, ponds, flowers — all per-region.
  const lush = biome === Biome.Plains || biome === Biome.Forest;
  const decor: [Tile, number][] = [
    [Tile.Well, rng() < 0.75 ? 1 : 0],
    [Tile.Lamp, 1 + Math.floor(rng() * 2) + tier * 2],
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

  // A metropolis lays a central boulevard — the seam between its districts.
  if (tier >= 3) {
    const midY = vy + Math.floor(h / 2);
    for (let x = vx + 1; x < vx + w - 1; x++) {
      if (isFree(x, midY)) set(tiles, x, midY, Tile.Pavement);
    }
  }

  // Extra NPC spots on remaining free cells.
  for (let tries = 0; spots.length < 26 && tries < 90; tries++) {
    const sx = vx + 2 + Math.floor(rng() * (w - 4));
    const sy = vy + 3 + Math.floor(rng() * (h - 5));
    if (isFree(sx, sy)) spots.push([sx, sy] as const);
  }

  // A city earns a train station: a platform beside the gate road, outside the fence.
  let station: readonly [number, number] | null = null;
  if (tier >= 2) {
    let sy = gy + 2;
    while (inCells(gx + 2, sy) && sy < MAP_H - 3) sy++;
    station = [gx + 2, sy] as const;
    set(tiles, station[0], station[1], Tile.Station);
    set(tiles, station[0] - 1, station[1], Tile.Pavement);
    set(tiles, station[0] + 1, station[1], Tile.Pavement);
  }

  // A metropolis builds an airport out past the other side of the gate.
  let airport: readonly [number, number] | null = null;
  if (tier >= 3) {
    let ay = gy + 2;
    while (inCells(gx - 4, ay) && ay < MAP_H - 3) ay++;
    airport = [Math.max(3, gx - 4), ay] as const;
    set(tiles, airport[0], airport[1], Tile.Airport);
    set(tiles, airport[0] - 1, airport[1], Tile.Pavement);
    set(tiles, airport[0] + 1, airport[1], Tile.Pavement);
  }

  // Electricity: a metropolis runs a power plant on its outskirts; any town keeps
  // a substation waiting for the grid to reach it.
  let plant: readonly [number, number] | null = null;
  if (tier >= 3) {
    let py2 = gy + 2;
    while (inCells(gx - 7, py2) && py2 < MAP_H - 3) py2++;
    plant = [Math.max(3, gx - 7), py2] as const;
    set(tiles, plant[0], plant[1], Tile.Plant);
  }
  let substation: readonly [number, number] | null = null;
  if (tier >= 1) {
    for (let tries = 0; tries < 60 && !substation; tries++) {
      const sx2 = vx + 2 + Math.floor(rng() * Math.max(1, w - 4));
      const sy2 = vy + 2 + Math.floor(rng() * Math.max(1, h - 4));
      if (isFree(sx2, sy2)) {
        substation = [sx2, sy2] as const;
        set(tiles, sx2, sy2, Tile.Substation);
      }
    }
  }

  return { x: vx, y: vy, w, h, biome, cells, tier, station, airport, plant, substation, powered: false, parent: null as string | null, gate: [gx, gy] as const, sign, poster, chest, stall, hall, mint, court, hospital, spots, homes };
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

  const villages = snapshot.regions.filter((r) => r.id !== AFTERLIFE).map((region, i) => {
    const residents = snapshot.agents.filter((a) => a.region === region.id && a.role !== "treasury").length;
    const treasury = snapshot.agents.find((a) => a.id === `treasury@${region.id}`)?.balances.currency ?? 0;
    const carved = carveVillage(tiles, region.id, i, residents, devTier(residents, treasury));
    return { regionId: region.id, displayName: region.displayName, ...carved };
  });

  // Municipal nesting: a settlement whose centre falls inside a HIGHER-tier
  // settlement's territory becomes a district (ちく) of that city — 村の中に村.
  for (const v of villages) {
    const cx = v.x + Math.floor(v.w / 2);
    const cy = v.y + Math.floor(v.h / 2);
    const host = villages
      .filter((o) => o.regionId !== v.regionId && o.tier > v.tier && villageContains(o, cx, cy))
      .sort((p1, p2) => p2.tier - p1.tier)[0];
    v.parent = host?.regionId ?? null;
  }

  // Diplomacy made visible: mutually friendly villages get a road between their
  // gates. Roads never cut through a village plot — a fence stays a fence.
  const inAnyPlot = (x: number, y: number): boolean => villages.some((v) => villageContains(v, x, y));
  const pave = (x: number, y: number): void => {
    if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2 || inAnyPlot(x, y)) return;
    set(tiles, x, y, Tile.Path);
  };
  const roads: (readonly [number, number])[][] = [];
  for (const [aId, bId] of friendlyPairs(snapshot.regions)) {
    const a = villages.find((v) => v.regionId === aId);
    const b = villages.find((v) => v.regionId === bId);
    if (!a || !b) continue;
    const [ax, ayGate] = a.gate;
    const [bx, byGate] = b.gate;
    // Route through a lane south of BOTH settlements so no blob swallows the road.
    const laneY = Math.max(ayGate, byGate) + 2;
    const path: (readonly [number, number])[] = [];
    for (let y = ayGate + 1; y <= laneY; y++) {
      pave(ax, y);
      path.push([ax, y] as const);
    }
    const dirX = Math.sign(bx - ax) || 1;
    for (let x = ax; x !== bx + dirX; x += dirX) {
      pave(x, laneY);
      path.push([x, laneY] as const);
    }
    for (let y = laneY; y > byGate; y--) {
      pave(bx, y);
      path.push([bx, y] as const);
    }
    if (path.length > 3) roads.push(path);
  }

  const inAnyPlot2 = (x: number, y: number): boolean => villages.some((v) => villageContains(v, x, y));
  // Highways: friendly pairs where BOTH sides are cities get a two-lane artery.
  const highways: (readonly [number, number])[][] = [];
  for (const [aId, bId] of friendlyPairs(snapshot.regions)) {
    const a = villages.find((v) => v.regionId === aId);
    const b = villages.find((v) => v.regionId === bId);
    if (!a || !b || a.tier < 2 || b.tier < 2) continue;
    const laneY = Math.max(a.gate[1], b.gate[1]) + 4;
    const path: (readonly [number, number])[] = [];
    const paveWide = (x: number, y: number): void => {
      for (const yy of [y, y + 1]) {
        if (x < 2 || yy < 2 || x >= MAP_W - 2 || yy >= MAP_H - 2 || inAnyPlot2(x, yy)) continue;
        const under = tiles[yy * MAP_W + x] ?? Tile.Grass;
        set(tiles, x, yy, under === Tile.Water ? Tile.RoadElevated : Tile.Pavement);
      }
    };
    for (let y = a.gate[1] + 1; y <= laneY; y++) {
      paveWide(a.gate[0], y);
      path.push([a.gate[0], y] as const);
    }
    const dirX = Math.sign(b.gate[0] - a.gate[0]) || 1;
    for (let x = a.gate[0]; x !== b.gate[0] + dirX; x += dirX) {
      paveWide(x, laneY);
      path.push([x, laneY] as const);
    }
    for (let y = laneY; y > b.gate[1]; y--) {
      paveWide(b.gate[0], y);
      path.push([b.gate[0], y] as const);
    }
    if (path.length > 3) highways.push(path);
  }

  // Rails: the stations form a line — technology stitches the cities together.
  const rails: (readonly [number, number])[][] = [];
  const stations = villages.filter((v) => v.station).sort((a, b) => a.x - b.x || a.y - b.y);
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]?.station;
    const b = stations[i + 1]?.station;
    if (!a || !b) continue;
    const path: (readonly [number, number])[] = [];
    const lay = (x: number, y: number): void => {
      path.push([x, y] as const);
      if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2 || inAnyPlot2(x, y)) return;
      const t = tiles[y * MAP_W + x] ?? Tile.Grass;
      if (t !== Tile.Station) set(tiles, x, y, Tile.Rail);
    };
    const dirY = Math.sign(b[1] - a[1]);
    for (let y = a[1]; y !== b[1]; y += dirY || 1) {
      if (dirY === 0) break;
      lay(a[0], y);
    }
    const dirX = Math.sign(b[0] - a[0]);
    for (let x = a[0]; x !== b[0]; x += dirX || 1) {
      if (dirX === 0) break;
      lay(x, b[1]);
    }
    path.push(b);
    rails.push(path);
  }

  const subways = rails.map((r) => r);

  // 高架鉄道: metropolises get a direct elevated express — it strides straight
  // across water and countryside on concrete pillars, cutting corners diagonally.
  const metros = villages.filter((v) => v.tier >= 3 && v.station).sort((a, b) => a.x - b.x || a.y - b.y);
  for (let i = 0; i + 1 < metros.length; i++) {
    const a = metros[i]?.station;
    const b = metros[i + 1]?.station;
    if (!a || !b) continue;
    const path: (readonly [number, number])[] = [];
    let ex = a[0];
    let ey = a[1];
    let guard = 0;
    while ((ex !== b[0] || ey !== b[1]) && guard++ < MAP_W + MAP_H) {
      if (ex !== b[0]) ex += Math.sign(b[0] - ex);
      if (ey !== b[1]) ey += Math.sign(b[1] - ey);
      path.push([ex, ey] as const);
      if (ex < 2 || ey < 2 || ex >= MAP_W - 2 || ey >= MAP_H - 2 || inAnyPlot2(ex, ey)) continue;
      const t = tiles[ey * MAP_W + ex] ?? Tile.Grass;
      if (t !== Tile.Station && t !== Tile.Rail) set(tiles, ex, ey, Tile.RailElevated);
    }
    if (path.length > 3) rails.push(path);
  }

  // The grid: each substation connects to the nearest plant within range.
  const RANGE = 70;
  const powerLines: (readonly [readonly [number, number], readonly [number, number]])[] = [];
  const plants = villages.filter((v) => v.plant);
  for (const v of villages) {
    if (!v.substation) continue;
    let best: (typeof plants)[number] | null = null;
    let bestD = RANGE;
    for (const pv of plants) {
      if (!pv.plant) continue;
      const d = Math.hypot(pv.plant[0] - v.substation[0], pv.plant[1] - v.substation[1]);
      if (d < bestD) {
        bestD = d;
        best = pv;
      }
    }
    if (best?.plant) {
      v.powered = true;
      powerLines.push([best.plant, v.substation] as const);
    }
  }
  for (const pv of plants) pv.powered = true; // the plant powers its own city

  return { tiles, villages, rails, subways, roads, highways, powerLines };
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
