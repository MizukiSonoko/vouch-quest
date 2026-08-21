// The building catalog: every structure a player can raise. A building is a
// coordinate-deed item (`bld<type><x>x<y>`), so this catalog is pure DATA —
// footprints composed from the existing tile vocabulary. The map derives the
// same structure for every player from the shared item list.

import { Tile } from "./map";

export interface BuildingDef {
  /** Menu label. */
  readonly label: string;
  /** Permit fee paid to the home treasury. */
  readonly fee: number;
  /** Category for the build menu (Hick's law: pick a shelf, then a thing). */
  readonly category: "すまい" | "みせ・しごと" | "しぜん" | "こうきょう" | "かざり";
  /** Footprint: tile offsets from the anchor (dx, dy, tile). */
  readonly cells: readonly (readonly [number, number, Tile])[];
  /** Materials consumed on construction (kind -> count), Minecraft-style. */
  readonly materials?: Readonly<Record<string, number>>;
}

const box = (w: number, h: number, tile: Tile): (readonly [number, number, Tile])[] => {
  const out: (readonly [number, number, Tile])[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([x, y, tile] as const);
  return out;
};

/** A little house: roof rows, then a wall row with a door. */
const house = (w: number, roofRows: number, roof: Tile, wall: Tile, win: Tile): (readonly [number, number, Tile])[] => {
  const out: (readonly [number, number, Tile])[] = [];
  for (let y = 0; y < roofRows; y++) for (let x = 0; x < w; x++) out.push([x, y, roof] as const);
  const doorX = Math.floor(w / 2);
  for (let x = 0; x < w; x++) out.push([x, roofRows, x === doorX ? Tile.HouseDoor : (x + roofRows) % 3 === 1 ? win : wall] as const);
  return out;
};

const tower = (floors: number): (readonly [number, number, Tile])[] => {
  const out: (readonly [number, number, Tile])[] = [[0, 0, Tile.TowerTop] as const];
  for (let y = 1; y < floors - 1; y++) out.push([0, y, Tile.TowerGlass] as const);
  out.push([0, floors - 1, Tile.TowerWall] as const);
  return out;
};

function generate(): Record<string, BuildingDef> {
  // NOTE: everything referencing Tile stays INSIDE this function — buildings.ts
  // and map.ts import each other, so Tile is only safe to touch lazily.
  const ROOFS: readonly (readonly [string, string, Tile])[] = [
    ["r", "あかやね", Tile.HouseRoof],
    ["g", "みどりやね", Tile.RoofGreen],
    ["b", "あおやね", Tile.RoofBlue],
    ["c", "ちゃやね", Tile.RoofBrown],
  ];
  const defs: Record<string, BuildingDef> = {};
  // --- すまい: 4 roof hues x 3 sizes, plaster or timber ---
  for (const [code, roofName, roofTile] of ROOFS) {
    defs[`cottage${code}`] = { label: `こや (${roofName})`, fee: 8, category: "すまい", cells: house(2, 1, roofTile, Tile.HouseWall, Tile.WallWindow) };
    defs[`house${code}`] = { label: `いえ (${roofName})`, fee: 15, category: "すまい", cells: house(3, 1, roofTile, Tile.HouseWall, Tile.WallWindow) };
    defs[`manor${code}`] = { label: `やしき (${roofName})`, fee: 30, category: "すまい", cells: house(4, 2, roofTile, Tile.HouseWall, Tile.WallWindow) };
    defs[`lodge${code}`] = { label: `まるたごや (${roofName})`, fee: 12, category: "すまい", cells: house(3, 1, roofTile, Tile.WallWood, Tile.WallWoodWindow) };
    defs[`inn${code}`] = { label: `やどや (${roofName})`, fee: 24, category: "すまい", cells: house(3, 2, roofTile, Tile.HouseWall, Tile.WallWindow) };
    defs[`rowhouse${code}`] = { label: `ながや (${roofName})`, fee: 22, category: "すまい", cells: house(5, 1, roofTile, Tile.HouseWall, Tile.WallWindow) };
    defs[`store${code}`] = { label: `くら (${roofName})`, fee: 18, category: "すまい", cells: house(2, 2, roofTile, Tile.WallWood, Tile.WallWood) };
    defs[`villa${code}`] = { label: `べっそう (${roofName})`, fee: 26, category: "すまい", cells: [...house(3, 1, roofTile, Tile.HouseWall, Tile.WallWindow), [3, 1, Tile.Flower] as const, [3, 0, Tile.Tree] as const] };
  }
  // --- towers ---
  defs["towers"] = { label: "ビル (3かい)", fee: 30, category: "すまい", cells: tower(3) };
  defs["towerm"] = { label: "ビル (4かい)", fee: 40, category: "すまい", cells: tower(4) };
  defs["towerl"] = { label: "ビル (5かい)", fee: 55, category: "すまい", cells: tower(5) };
  defs["towerxl"] = { label: "ちょうこうそうビル (6かい)", fee: 75, category: "すまい", cells: tower(6) };
  for (const [n, floors] of [["s", 3], ["m", 4], ["l", 5], ["xl", 6]] as const) {
    const neonTower = tower(floors).map(([dx, dy, t2], i) => (i === floors - 1 ? ([dx, dy, Tile.Neon] as const) : ([dx, dy, t2] as const)));
    defs[`neontower${n}`] = { label: `ネオンビル (${floors}かい)`, fee: 20 + floors * 12, category: "すまい", cells: neonTower };
  }
  defs["mediatower"] = { label: "ビジョンビル (5かい)", fee: 90, category: "すまい", cells: tower(5).map(([dx, dy, t2], i) => (i === 4 ? ([dx, dy, Tile.Billboard] as const) : ([dx, dy, t2] as const))) };
  defs["greenhouse"] = { label: "おんしつ (ガラスばり)", fee: 28, category: "みせ・しごと", cells: [[0, 0, Tile.TowerGlass], [1, 0, Tile.TowerGlass], [0, 1, Tile.Farm], [1, 1, Tile.Farm]] };
  // --- みせ・しごと ---
  defs["shop"] = { label: "やたい", fee: 10, category: "みせ・しごと", cells: [[0, 0, Tile.Stall]] };
  defs["market"] = { label: "いちば (やたい 3けん)", fee: 26, category: "みせ・しごと", cells: [[0, 0, Tile.Stall], [2, 0, Tile.Stall], [4, 0, Tile.Stall]] };
  defs["field"] = { label: "はたけ (2x2)", fee: 8, category: "みせ・しごと", cells: box(2, 2, Tile.Farm) };
  defs["farmland"] = { label: "だいのうえん (3x3)", fee: 16, category: "みせ・しごと", cells: box(3, 3, Tile.Farm) };
  defs["orchard"] = { label: "かじゅえん", fee: 14, category: "みせ・しごと", cells: [[0, 0, Tile.Tree], [2, 0, Tile.Tree], [1, 1, Tile.Flower], [0, 2, Tile.Tree], [2, 2, Tile.Tree]] };
  defs["fishpond"] = { label: "つりぼり (2x2)", fee: 12, category: "みせ・しごと", cells: box(2, 2, Tile.Water) };
  defs["neon"] = { label: "ネオンかんばん", fee: 20, category: "みせ・しごと", cells: [[0, 0, Tile.Neon]] };
  defs["vision"] = { label: "おおがたビジョン", fee: 50, category: "みせ・しごと", cells: [[0, 0, Tile.Billboard]] };
  // --- しぜん ---
  defs["tree"] = { label: "き", fee: 2, category: "しぜん", cells: [[0, 0, Tile.Tree]] };
  defs["grove"] = { label: "こだち (3ぼん)", fee: 5, category: "しぜん", cells: [[0, 0, Tile.Tree], [2, 0, Tile.Tree], [1, 1, Tile.Tree]] };
  defs["forest"] = { label: "もり (3x3)", fee: 12, category: "しぜん", cells: box(3, 3, Tile.Tree) };
  defs["pine"] = { label: "ゆきのき", fee: 3, category: "しぜん", cells: [[0, 0, Tile.SnowTree]] };
  defs["cactus"] = { label: "サボテン", fee: 3, category: "しぜん", cells: [[0, 0, Tile.Cactus]] };
  defs["garden"] = { label: "はなばたけ (2x2)", fee: 3, category: "しぜん", cells: box(2, 2, Tile.Flower) };
  defs["meadow"] = { label: "おはなばたけ (3x3)", fee: 7, category: "しぜん", cells: box(3, 3, Tile.Flower) };
  defs["pond"] = { label: "いけ (2x2)", fee: 6, category: "しぜん", cells: box(2, 2, Tile.Water) };
  defs["lake"] = { label: "みずうみ (3x3)", fee: 14, category: "しぜん", cells: box(3, 3, Tile.Water) };
  defs["rock"] = { label: "にわいし", fee: 2, category: "しぜん", cells: [[0, 0, Tile.Rock]] };
  defs["swamppatch"] = { label: "しっちのにわ (2x2)", fee: 4, category: "しぜん", cells: box(2, 2, Tile.Swamp) };
  defs["snowforest"] = { label: "ゆきのもり (3x3)", fee: 13, category: "しぜん", cells: box(3, 3, Tile.SnowTree) };
  defs["cactusrow"] = { label: "サボテンなみき (3ぼん)", fee: 7, category: "しぜん", cells: [[0, 0, Tile.Cactus], [2, 0, Tile.Cactus], [4, 0, Tile.Cactus]] };
  defs["spring"] = { label: "いずみ (はないけ)", fee: 10, category: "しぜん", cells: [[1, 0, Tile.Flower], [0, 1, Tile.Flower], [1, 1, Tile.Water], [2, 1, Tile.Flower], [1, 2, Tile.Flower]] };
  defs["beach"] = { label: "すなはま (3x2)", fee: 6, category: "しぜん", cells: box(3, 2, Tile.Sand) };
  defs["riverh"] = { label: "せせらぎ (よこ4)", fee: 8, category: "しぜん", cells: [[0, 0, Tile.Water], [1, 0, Tile.Water], [2, 0, Tile.Water], [3, 0, Tile.Water]] };
  defs["riverv"] = { label: "せせらぎ (たて4)", fee: 8, category: "しぜん", cells: [[0, 0, Tile.Water], [0, 1, Tile.Water], [0, 2, Tile.Water], [0, 3, Tile.Water]] };
  defs["treering"] = { label: "きのわ", fee: 11, category: "しぜん", cells: [[1, 0, Tile.Tree], [0, 1, Tile.Tree], [2, 1, Tile.Tree], [1, 2, Tile.Tree]] };
  defs["flowerring"] = { label: "はなのわ", fee: 6, category: "しぜん", cells: [[1, 0, Tile.Flower], [0, 1, Tile.Flower], [2, 1, Tile.Flower], [1, 2, Tile.Flower]] };
  defs["hedge"] = { label: "いけがき (よこ3)", fee: 5, category: "しぜん", cells: [[0, 0, Tile.Tree], [1, 0, Tile.Tree], [2, 0, Tile.Tree]] };
  defs["rockgarden"] = { label: "かれさんすい", fee: 9, category: "しぜん", cells: [[0, 0, Tile.Rock], [1, 1, Tile.Sand], [2, 0, Tile.Rock], [0, 2, Tile.Sand], [2, 2, Tile.Rock], [1, 0, Tile.Sand], [0, 1, Tile.Sand], [2, 1, Tile.Sand], [1, 2, Tile.Sand]] };
  // --- こうきょう ---
  defs["well"] = { label: "いど", fee: 8, category: "こうきょう", cells: [[0, 0, Tile.Well]] };
  defs["lamp"] = { label: "がいとう", fee: 4, category: "こうきょう", cells: [[0, 0, Tile.Lamp]] };
  defs["lamprow"] = { label: "がいとうどおり (3ぼん)", fee: 10, category: "こうきょう", cells: [[0, 0, Tile.Lamp], [2, 0, Tile.Lamp], [4, 0, Tile.Lamp]] };
  defs["plaza"] = { label: "ひろば (3x3いしだたみ)", fee: 12, category: "こうきょう", cells: box(3, 3, Tile.Pavement) };
  defs["road"] = { label: "いしだたみ (よこ3)", fee: 4, category: "こうきょう", cells: [[0, 0, Tile.Pavement], [1, 0, Tile.Pavement], [2, 0, Tile.Pavement]] };
  defs["roadv"] = { label: "いしだたみ (たて3)", fee: 4, category: "こうきょう", cells: [[0, 0, Tile.Pavement], [0, 1, Tile.Pavement], [0, 2, Tile.Pavement]] };
  defs["pathrow"] = { label: "こみち (よこ3)", fee: 2, category: "こうきょう", cells: [[0, 0, Tile.Path], [1, 0, Tile.Path], [2, 0, Tile.Path]] };
  defs["board"] = { label: "けいじばん", fee: 6, category: "こうきょう", cells: [[0, 0, Tile.Poster]] };
  defs["crossing"] = { label: "おうだんほどう", fee: 8, category: "こうきょう", cells: [[0, 0, Tile.Crossing], [1, 0, Tile.Crossing]] };
  defs["fountain"] = { label: "ふんすいひろば", fee: 20, category: "こうきょう", cells: [[1, 0, Tile.Pavement], [0, 1, Tile.Pavement], [1, 1, Tile.Well], [2, 1, Tile.Pavement], [1, 2, Tile.Pavement]] };
  defs["grandplaza"] = { label: "だいひろば (5x5)", fee: 30, category: "こうきょう", cells: box(5, 5, Tile.Pavement) };
  defs["boulevard"] = { label: "おおどおり (よこ5x2)", fee: 12, category: "こうきょう", cells: box(5, 2, Tile.Pavement) };
  defs["bridge"] = { label: "はし (よこ3こうか)", fee: 15, category: "こうきょう", cells: [[0, 0, Tile.RoadElevated], [1, 0, Tile.RoadElevated], [2, 0, Tile.RoadElevated]] };
  defs["stationfront"] = { label: "えきまえどおり", fee: 14, category: "こうきょう", cells: [[0, 0, Tile.Lamp], [1, 0, Tile.Pavement], [2, 0, Tile.Pavement], [3, 0, Tile.Lamp]] };
  defs["beacon"] = { label: "でんぱとう (ミニ)", fee: 60, category: "こうきょう", cells: [[0, 0, Tile.TowerRedTop], [0, 1, Tile.TowerRedMid]] };
  // --- かざり ---
  defs["fence"] = { label: "さく (よこ3)", fee: 3, category: "かざり", cells: [[0, 0, Tile.Fence], [1, 0, Tile.Fence], [2, 0, Tile.Fence]] };
  defs["fencev"] = { label: "さく (たて3)", fee: 3, category: "かざり", cells: [[0, 0, Tile.Fence], [0, 1, Tile.Fence], [0, 2, Tile.Fence]] };
  defs["chest"] = { label: "たからばこ (かざり)", fee: 12, category: "かざり", cells: [[0, 0, Tile.Chest]] };
  defs["sign"] = { label: "たてふだ", fee: 3, category: "かざり", cells: [[0, 0, Tile.Sign]] };
  defs["snowpatch"] = { label: "ゆきのにわ (2x2)", fee: 5, category: "かざり", cells: box(2, 2, Tile.Snow) };
  defs["lanternpair"] = { label: "がいとう ついとう", fee: 7, category: "かざり", cells: [[0, 0, Tile.Lamp], [2, 0, Tile.Lamp]] };
  defs["stonecircle"] = { label: "ストーンサークル", fee: 15, category: "かざり", cells: [[1, 0, Tile.Rock], [0, 1, Tile.Rock], [2, 1, Tile.Rock], [1, 2, Tile.Rock]] };
  defs["chestpair"] = { label: "たからばこ ふたつ", fee: 22, category: "かざり", cells: [[0, 0, Tile.Chest], [2, 0, Tile.Chest]] };
  defs["signrow"] = { label: "たてふだ さんれん", fee: 8, category: "かざり", cells: [[0, 0, Tile.Sign], [2, 0, Tile.Sign], [4, 0, Tile.Sign]] };
  defs["torii"] = { label: "もんばしら (あか)", fee: 12, category: "かざり", cells: [[0, 0, Tile.TowerRedMid], [2, 0, Tile.TowerRedMid]] };
  defs["yukidoro"] = { label: "ゆきどうろう", fee: 6, category: "かざり", cells: [[0, 0, Tile.Snow], [0, 1, Tile.Lamp]] };
  defs["hanamichi"] = { label: "はなのさんどう (よこ4)", fee: 9, category: "かざり", cells: [[0, 0, Tile.Flower], [1, 0, Tile.Path], [2, 0, Tile.Path], [3, 0, Tile.Flower]] };
  defs["gardenpath"] = { label: "にわのこみち", fee: 5, category: "かざり", cells: [[0, 0, Tile.Path], [1, 0, Tile.Flower], [2, 0, Tile.Path], [3, 0, Tile.Flower]] };
  defs["sandpatch"] = { label: "すなのにわ (2x2)", fee: 4, category: "かざり", cells: box(2, 2, Tile.Sand) };
  return defs;
}

// Legacy deed types from the first construction release keep working forever.
function withLegacy(defs: Record<string, BuildingDef>): Record<string, BuildingDef> {
  defs["house"] = { label: "いえ", fee: 15, category: "すまい", cells: [[0, 0, Tile.HouseRoof], [1, 0, Tile.HouseRoof], [0, 1, Tile.HouseDoor], [1, 1, Tile.WallWindow]] };
  defs["tower"] = { label: "とう (4かい)", fee: 40, category: "すまい", cells: defs["towerm"]?.cells ?? [] };
  return defs;
}

/** Attach material recipes: wooden things want もくざい, stony things want いし. */
function withMaterials(defs: Record<string, BuildingDef>): Record<string, BuildingDef> {
  const wants = (def: BuildingDef): Readonly<Record<string, number>> | undefined => {
    const tilesUsed = new Set(def.cells.map(([, , t2]) => t2));
    const woody = tilesUsed.has(Tile.WallWood) || tilesUsed.has(Tile.HouseWall) || tilesUsed.has(Tile.HouseRoof) || tilesUsed.has(Tile.RoofGreen) || tilesUsed.has(Tile.RoofBlue) || tilesUsed.has(Tile.RoofBrown) || tilesUsed.has(Tile.Fence) || tilesUsed.has(Tile.Stall);
    const stony = tilesUsed.has(Tile.Pavement) || tilesUsed.has(Tile.TowerWall) || tilesUsed.has(Tile.TowerGlass) || tilesUsed.has(Tile.Rock) || tilesUsed.has(Tile.Well) || tilesUsed.has(Tile.Crossing) || tilesUsed.has(Tile.RoadElevated);
    const size = def.cells.length;
    const out: Record<string, number> = {};
    if (woody) out["mokuzai"] = size >= 8 ? 2 : 1;
    if (stony) out["ishi"] = size >= 8 ? 2 : 1;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  for (const [k, def] of Object.entries(defs)) {
    const m = wants(def);
    if (m) defs[k] = { ...def, materials: m };
  }
  return defs;
}

let cache: Record<string, BuildingDef> | null = null;

/** Lazy: buildings reference Tile, and map.ts references this module — the
 * catalog materialises on first use, after both modules have initialised. */
export function getBuildings(): Readonly<Record<string, BuildingDef>> {
  cache ??= withMaterials(withLegacy(generate()));
  return cache;
}

export const BUILDING_CATEGORIES: readonly BuildingDef["category"][] = ["すまい", "みせ・しごと", "しぜん", "こうきょう", "かざり"];

export function buildingCount(): number {
  return Object.keys(getBuildings()).length;
}
