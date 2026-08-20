// Procedural pixel art: every tile and character is drawn from 16x16 string maps at
// boot, so the game ships zero image assets. Palette keys are single characters.

import { Tile } from "./map";

export const TILE = 16;
export const SCALE = 3;
export const CELL = TILE * SCALE;

const PALETTE: Record<string, string> = {
  ".": "", // transparent
  g: "#1c7c2c", // grass base
  G: "#2a9440", // grass light
  d: "#155e22", // grass dark
  t: "#0d4718", // tree dark
  T: "#1f8c33", // tree light
  b: "#5b3a1e", // trunk / wood dark
  w: "#1a4fbb", // water
  W: "#3f74e8", // water light
  s: "#d8c07a", // sand
  S: "#c0a35e", // sand dark
  f: "#8a5a2b", // fence wood
  F: "#b07a3c", // fence light
  r: "#b33326", // roof
  R: "#d9553f", // roof light
  h: "#cfc6a8", // wall plaster
  H: "#a89f83", // wall shade
  k: "#3a2a16", // door / dark wood
  y: "#e8c840", // gold / sign text
  c: "#8a6d2f", // chest body
  C: "#c49a45", // chest light
  x: "#111111", // outline
  p: "#f2d3b3", // skin
  B: "#2244cc", // hero tunic
  e: "#e8e8e8", // white
  o: "#d97820", // merchant orange
  v: "#7a3fa8", // broker purple
  a: "#2c8a4a", // artisan green
  m: "#6a6a6a", // stone gray
  n: "#24408e", // hall roof navy
  N: "#4a6fe0", // hall roof light
  q: "#b8860b", // mint roof gold-dark
  z: "#dde8f2", // snow base
  Z: "#ffffff", // snow bright
  u: "#4a5a30", // swamp murk
  U: "#5d7038", // swamp murk light
};

function draw(rows: readonly string[], scale = SCALE): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE * scale;
  canvas.height = TILE * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = PALETTE[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return canvas;
}

const R = (s: string): string[] => Array.from({ length: 16 }, () => s);

const GRASS = R("gggggggggggggggg").map((row, y) => (y % 5 === 2 ? "ggGgggggdggggGgg" : y % 7 === 4 ? "gggggdggggGggggg" : row));
const GRASS2 = R("gggggggggggggggg").map((row, y) => (y % 4 === 1 ? "ggggGgggggggdggg" : row));
const WATER = R("wwwwwwwwwwwwwwww").map((row, y) => (y % 4 === 0 ? "wWwwwwWWwwwwWwww" : row));
const SAND = R("ssssssssssssssss").map((row, y) => (y % 5 === 3 ? "ssSssssssSssssss" : row));

const TREE = [
  "....ttTTtt......",
  "...tTTTTTTt.....",
  "..tTTtTTTTTt....",
  ".tTTTTTTtTTTt...",
  ".tTtTTTTTTTTt...",
  "tTTTTtTTTTtTTt..",
  "tTTTTTTTTTTTTt..",
  ".ttTTTTtTTTtt...",
  "..tttTTTTttt....",
  "....ttbbtt......",
  ".....bbbb.......",
  ".....bbbb.......",
  "gggggbbbbgggggg.",
  "ggggdggggggGgggg",
  "gggggggdgggggggg",
  "gggGgggggggggggg",
];

const FENCE = [
  "gggggggggggggggg",
  "gggggggggggggggg",
  "gFfgggFfgggFfggg",
  "gffgggffgggffggg",
  "FFFFFFFFFFFFFFFF",
  "ffffffffffffffff",
  "gffgggffgggffggg",
  "gffgggffgggffggg",
  "FFFFFFFFFFFFFFFF",
  "ffffffffffffffff",
  "gffgggffgggffggg",
  "gffgggffgggffggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

const PATH = R("ssssssssssssssss").map((row, y) => (y % 3 === 1 ? "sSssssSssssssSss" : row));

const ROOF = [
  "rrrrrrrrrrrrrrrr",
  "rRRrrRRrrRRrrRRr",
  "rrrrrrrrrrrrrrrr",
  "RRrrRRrrRRrrRRrr",
  "rrrrrrrrrrrrrrrr",
  "rRRrrRRrrRRrrRRr",
  "rrrrrrrrrrrrrrrr",
  "RRrrRRrrRRrrRRrr",
  "rrrrrrrrrrrrrrrr",
  "rRRrrRRrrRRrrRRr",
  "rrrrrrrrrrrrrrrr",
  "RRrrRRrrRRrrRRrr",
  "rrrrrrrrrrrrrrrr",
  "rRRrrRRrrRRrrRRr",
  "xxxxxxxxxxxxxxxx",
  "hhhhhhhhhhhhhhhh",
];

const WALL = [
  "hhhhhhhhhhhhhhhh",
  "hHhhhhHhhhhHhhhh",
  "hhhhhhhhhhhhhhhh",
  "hhhHhhhhhHhhhhhh",
  "hhhhhhhhhhhhhhhh",
  "hHhhhhHhhhhHhhhh",
  "hhhhhhhhhhhhhhhh",
  "hhhHhhhhhHhhhhhh",
  "hhhhhhhhhhhhhhhh",
  "hHhhhhHhhhhHhhhh",
  "hhhhhhhhhhhhhhhh",
  "hhhHhhhhhHhhhhhh",
  "hhhhhhhhhhhhhhhh",
  "hHhhhhHhhhhHhhhh",
  "HHHHHHHHHHHHHHHH",
  "hhhhhhhhhhhhhhhh",
];

const DOOR = WALL.map((row, y) => {
  if (y < 4) return row;
  return `${row.slice(0, 4)}xkkkkkkkx${row.slice(13)}`.slice(0, 16);
});

const ROCK = [
  "gggggggggggggggg",
  "gggggggggggggggg",
  "ggggggmmmmgggggg",
  "gggggmmmmmmggggg",
  "ggggmmeemmmmgggg",
  "gggmmmemmmmmmggg",
  "gggmmmmmmmmmmggg",
  "ggmmmmmmmmmmmmgg",
  "ggmmmmmmmmxmmmgg",
  "ggmmmmmmmmmmmmgg",
  "ggxmmmmmmmmmmxgg",
  "gggxxmmmmmmxxggg",
  "gggggxxxxxxggggg",
  "gggGgggggggdgggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

const SNOW = R("zzzzzzzzzzzzzzzz").map((row, y) => (y % 5 === 2 ? "zzZzzzzzmzzzzZzz" : y % 7 === 4 ? "zzzzzZzzzzzmzzzz" : row));
const SWAMP = R("uuuuuuuuuuuuuuuu").map((row, y) => (y % 4 === 1 ? "uuUuuuuwuuuUuuuu" : y % 5 === 3 ? "uuuuUuuuuuwuuuuu" : row));

const SNOWTREE = [
  "....mmZZmm......",
  "...mZZZZZZm.....",
  "..mZZmZZZZZm....",
  ".mZZZZZZmZZZm...",
  ".mZmZZZZZZZZm...",
  "mZZZZmZZZZmZZm..",
  "mZZZZZZZZZZZZm..",
  ".mmZZZZmZZZmm...",
  "..mmmZZZZmmm....",
  "....mmbbmm......",
  ".....bbbb.......",
  ".....bbbb.......",
  "zzzzzbbbbzzzzzz.",
  "zzzzmzzzzzzZzzzz",
  "zzzzzzzmzzzzzzzz",
  "zzzZzzzzzzzzzzzz",
].map((r) => r.replaceAll(".", "z"));

const CACTUS = [
  "ssssssssssssssss",
  "ssssssxaaxssssss",
  "ssssssxaTxssssss",
  "ssssssxaaxssssss",
  "ssxaxsxaTxsxaxss",
  "ssxaxsxaaxsxaxss",
  "ssxaaxxaTxxaaxss",
  "sssxaaaaaaaaxsss",
  "ssssxxxaTxxxssss",
  "ssssssxaaxssssss",
  "ssssssxaTxssssss",
  "ssssssxaaxssssss",
  "ssssssxxxxssssss",
  "ssSsssssssssSsss",
  "ssssssssssssssss",
  "ssssssssssssssss",
];

const PAVEMENT = R("mmmmmmmmmmmmmmmm").map((row, y) => (y % 8 === 0 ? "xmmmmmmmxmmmmmmm" : y % 4 === 2 ? "mmmHmmmmmmmmHmmm" : row));

const RAIL = [
  "gggggggggggggggg",
  "ggbbbbbbbbbbbbgg".replaceAll("gg", "gg"),
  "gxxxxxxxxxxxxxxg",
  "gggggggggggggggg",
  "bbbbbbbbbbbbbbbb",
  "xxxxxxxxxxxxxxxx",
  "gggggggggggggggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
  "bbbbbbbbbbbbbbbb",
  "xxxxxxxxxxxxxxxx",
  "gggggggggggggggg",
  "ggggggggggggggggg".slice(0, 16),
  "gSggggggggggSggg".replaceAll("S", "b"),
  "gggggggggggggggg",
  "gggggggggggggggg",
];

const BUILDING_WALL = [
  "mmmmmmmmmmmmmmmm",
  "mxyyxmmxyyxmmxym",
  "mxyyxmmxyyxmmxym",
  "mmmmmmmmmmmmmmmm",
  "mHHHHHHHHHHHHHHm",
  "mxyyxmmxNNxmmxym",
  "mxyyxmmxNNxmmxym",
  "mmmmmmmmmmmmmmmm",
  "mHHHHHHHHHHHHHHm",
  "mxNNxmmxyyxmmxNm",
  "mxNNxmmxyyxmmxNm",
  "mmmmmmmmmmmmmmmm",
  "mHHHHHHHHHHHHHHm",
  "mxyyxmmxyyxmmxym",
  "mxyyxmmxyyxmmxym",
  "mmmmmmmmmmmmmmmm",
];

const BUILDING_ROOF = [
  "xxxxxxxxxxxxxxxx",
  "xmmmmmmmmmmmmmmx",
  "xmHHHHHHHHHHHHmx",
  "xmHmmmmmmmmmmHmx",
  "xmHmxxxxmmmmmHmx",
  "xmHmxeexmmmmmHmx",
  "xmHmxxxxmmmmmHmx",
  "xmHmmmmmmmmmmHmx",
  "xmHmmmmmxxxmmHmx",
  "xmHmmmmmxmxmmHmx",
  "xmHmmmmmxxxmmHmx",
  "xmHmmmmmmmmmmHmx",
  "xmHHHHHHHHHHHHmx",
  "xmmmmmmmmmmmmmmx",
  "xxxxxxxxxxxxxxxx",
  "mmmmmmmmmmmmmmmm",
];

const STATION = [
  "xxxxxxxxxxxxxxxx",
  "xrrrrrrrrrrrrrrx",
  "xRRRRRRRRRRRRRRx",
  "xrrrrrrrrrrrrrrx",
  "xxxxxxxxxxxxxxxx",
  "gxbggggggggggbxg",
  "gxbgeeeeeeeegbxg",
  "gxbgeyxxxxyegbxg",
  "gxbgeeeeeeeegbxg",
  "gxbggggggggggbxg",
  "gxbggggggggggbxg",
  "gxxxxxxxxxxxxxxg",
  "gmmmmmmmmmmmmmmg",
  "gmmmmmmmmmmmmmmg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

const POSTER = [
  "gggggggggggggggg",
  "ggxxxxxxxxxxxxgg",
  "ggxeeeeeeeeeexgg",
  "ggxereeeeeerexgg",
  "ggxeeexxxxeeexgg",
  "ggxeexkkkkxeexgg",
  "ggxeexkxxkxeexgg",
  "ggxeexkkkkxeexgg",
  "ggxeeexxxxeeexgg",
  "ggxereeeeeerexgg",
  "ggxexxexxexxexgg",
  "ggxeeeeeeeeeexgg",
  "ggxxxxxxxxxxxxgg",
  "gggggggbbgggggggg".slice(0, 16),
  "ggggggbbbbgggggg",
  "gggggggggggggggg",
];

const STALL = [
  "gggggggggggggggg",
  "gxRRRReeeeRRRRxg",
  "gxeeeeRRRReeeexg",
  "gxRRRReeeeRRRRxg",
  "gxxxxxxxxxxxxxxg",
  "ggxbggggggggbxgg",
  "ggxbggyyggggbxgg",
  "ggxbgyCCyoggbxgg",
  "ggxbggyyooggbxgg",
  "ggxbbbbbbbbbbxgg",
  "ggxbFFFFFFFFbxgg",
  "ggxbFFFFFFFFbxgg",
  "ggxbbbbbbbbbbxgg",
  "gggGgggggdgggggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

const FLOWER = [
  "gggggggggggggggg",
  "ggGggggggggdgggg",
  "gggggeegggggggg".slice(0, 16).padEnd(16, "g"),
  "ggggeyyegggggggg",
  "gggggeegggggggg".padEnd(16, "g").slice(0, 16),
  "gggggttggggeeggg",
  "ggdggttgggeyyegg",
  "gggggggggggeeggg",
  "ggeeggggggggttgg",
  "geyyeggGggggttgg",
  "ggeegggggggggggg",
  "ggttgggggggggggg",
  "ggttggggdggggggg",
  "gggggggggggggggg",
  "ggGggggggggGgggg",
  "gggggggggggggggg",
];

const WELL = [
  "gggggggggggggggg",
  "ggggxbbbbbbxgggg",
  "gggxbggggggbxggg",
  "ggxbbbbbbbbbbxgg",
  "ggxmmmmmmmmmmxgg",
  "ggxmeewwwweemxgg",
  "ggxmewwwwwwemxgg",
  "ggxmewwWwwwemxgg",
  "ggxmewwwwwwemxgg",
  "ggxmeewwwweemxgg",
  "ggxmmmmmmmmmmxgg",
  "ggxxxxxxxxxxxxgg",
  "gggGgggggdgggggg",
  "gggggggggggggggg",
  "ggdggggGgggggggg",
  "gggggggggggggggg",
];

const FARM = [
  "bbbbbbbbbbbbbbbb",
  "bSbbSbbSbbSbbSbb",
  "bbbbbbbbbbbbbbbb",
  "bTbbTbbTbbTbbTbb",
  "bbbbbbbbbbbbbbbb",
  "bSbbSbbSbbSbbSbb",
  "bbbbbbbbbbbbbbbb",
  "bTbbTbbTbbTbbTbb",
  "bbbbbbbbbbbbbbbb",
  "bSbbSbbSbbSbbSbb",
  "bbbbbbbbbbbbbbbb",
  "bTbbTbbTbbTbbTbb",
  "bbbbbbbbbbbbbbbb",
  "bSbbSbbSbbSbbSbb",
  "bbbbbbbbbbbbbbbb",
  "bbbbbbbbbbbbbbbb",
];

const LAMP = [
  "gggggggggggggggg",
  "ggggggxyyxgggggg",
  "gggggxyyyyxggggg",
  "gggggxyyyyxggggg",
  "ggggggxyyxgggggg",
  "gggggggxxggggggg",
  "gggggggbbggggggg",
  "gggggggbbggggggg",
  "gggggggbbggggggg",
  "gggggggbbggggggg",
  "gggggggbbggggggg",
  "ggggggbbbbgggggg",
  "gggggxbbbbxggggg",
  "gggGgggggggdgggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

/** A wall with a lit window, plaster and timber flavors. */
const winIn = (wall: readonly string[]): string[] =>
  wall.map((row, y) => (y >= 5 && y <= 9 ? `${row.slice(0, 5)}xyyyyyx${row.slice(12)}`.slice(0, 16) : row));

/** A wooden wall/door pair for the cabin-style houses. */
const WALL_WOOD = WALL.map((row) => row.replaceAll("h", "F").replaceAll("H", "b"));
const DOOR_WOOD = WALL_WOOD.map((row, y) => {
  if (y < 4) return row;
  return `${row.slice(0, 4)}xkkkkkkkx${row.slice(13)}`.slice(0, 16);
});

/** Roof recolor for civic buildings: swap the shingle colors. */
const roofIn = (dark: string, light: string): string[] => ROOF.map((row) => row.replaceAll("r", dark).replaceAll("R", light));

/** A door with a colored emblem band — the civic building's "sign" over the lintel. */
const doorWith = (emblem: string): string[] =>
  DOOR.map((row, y) => (y === 5 || y === 6 ? `${row.slice(0, 5)}${emblem.repeat(7)}${row.slice(12)}` : row));

const SIGN = [
  "gggggggggggggggg",
  "gggggggggggggggg",
  "gxxxxxxxxxxxxxxg",
  "gxFFFFFFFFFFFFxg",
  "gxFyyFyFyFyyFFxg",
  "gxFFFFFFFFFFFFxg",
  "gxFyFyyFyyFyFFxg",
  "gxFFFFFFFFFFFFxg",
  "gxxxxxxxxxxxxxxg",
  "gggggggbbgggggggg".slice(0, 16),
  "gggggggbbgggggggg".slice(0, 16),
  "gggggggbbgggggggg".slice(0, 16),
  "ggggggbbbbgggggg",
  "gggggggggggggggg",
  "gggGgggggggdgggg",
  "gggggggggggggggg",
];

const CHEST = [
  "gggggggggggggggg",
  "gggggggggggggggg",
  "ggxxxxxxxxxxxxgg",
  "ggxCCCCCCCCCCxgg",
  "ggxCccccccccCxgg",
  "ggxCCCCCCCCCCxgg",
  "ggxxxxxxxxxxxxgg",
  "ggxccccyyccccxgg",
  "ggxccccyyccccxgg",
  "ggxccccccccccxgg",
  "ggxccccccccccxgg",
  "ggxxxxxxxxxxxxgg",
  "gggggggggggggggg",
  "gggGgggggdgggggg",
  "gggggggggggggggg",
  "gggggggggggggggg",
];

/** A 16x16 DQ-style walker. `body` picks the tunic color key; two frames swap feet. */
function person(body: string, frame: 0 | 1): string[] {
  const b = body;
  const feet = frame === 0 ? `....xkk...kkx...` : `......xkkkx.....`;
  return [
    "................",
    ".....xxxxxx.....",
    "....xkkkkkkx....",
    "....xkkkkkkx....",
    "....xppppppx....",
    "....xpxppxpx....",
    "....xppppppx....",
    ".....xppppx.....",
    `....x${b}${b}${b}${b}${b}${b}x....`,
    `...x${b}${b}${b}${b}${b}${b}${b}${b}x...`,
    `...xp${b}${b}${b}${b}${b}${b}px...`,
    `....x${b}${b}${b}${b}${b}${b}x....`,
    `....x${b}${b}x${b}${b}x.....`.slice(0, 16),
    "....xkkxxkkx....",
    feet,
    "................",
  ];
}

interface HeroLook {
  readonly tunic: string;
  readonly headband: string;
  readonly cape?: string;
  readonly crown?: boolean;
}

/** The hero's look climbs with their title tier (see quests.titleTier). */
const HERO_LOOKS: readonly HeroLook[] = [
  { tunic: "B", headband: "y" }, // 0 traveler / villager — blue tunic
  { tunic: "o", headband: "y" }, // 1 あきんど — merchant orange
  { tunic: "B", headband: "y", cape: "r" }, // 2 そんちょう — red cape
  { tunic: "y", headband: "e", cape: "r" }, // 3 だいごうしょう — gold garb
  { tunic: "e", headband: "y", cape: "v", crown: true }, // 4 しんらいの おうじゃ
  { tunic: "y", headband: "y", cape: "e", crown: true }, // 5 でんせつの ゆうしゃ
];

function hero(look: HeroLook, frame: 0 | 1): string[] {
  const rows = person(look.tunic, frame);
  rows[1] = `.....x${look.headband.repeat(4)}x.....`;
  rows[2] = `....x${look.headband}kkkk${look.headband}x....`;
  if (look.crown) {
    rows[0] = ".....y.yy.y.....";
    rows[1] = ".....xyyyyx.....";
  }
  if (look.cape) {
    const c = look.cape;
    for (const y of [8, 9, 10, 11]) {
      const row = rows[y] ?? "";
      const left = row.indexOf("x");
      const right = row.lastIndexOf("x");
      if (left > 0 && right < 15) {
        rows[y] = row.slice(0, left - 1) + c + row.slice(left, right + 1) + c + row.slice(right + 2);
      }
    }
  }
  return rows;
}

const SLIME = [
  "................",
  "................",
  "................",
  "................",
  "......xxxx......",
  "....xxaTTaxx....",
  "...xaTTTTTTax...",
  "...xaTeTTeTax...",
  "..xaTTeTTeTTax..",
  "..xaTTTTTTTTax..",
  "..xaTTTxxTTTax..",
  "...xaTTTTTTax...",
  "....xxaaaaxx....",
  "......xxxx......",
  "................",
  "................",
];

const SCORPION = [
  "................",
  "................",
  "..........xx....",
  ".........x..x...",
  "..........xx....",
  ".........xx.....",
  "....xxxxxx......",
  "...xbbbbbbx.....",
  "..xbbxbbxbbx....",
  "...xbbbbbbx.....",
  "..x.x....x.x....",
  ".x..x....x..x...",
  "................",
  "................",
  "................",
  "................",
];

const YUKIDARUMA = [
  "................",
  "................",
  "....xxxxxx......",
  "...xZZZZZZx.....",
  "...xZxZZxZx.....",
  "...xZZZZZZx.....",
  "...xZZxxZZx.....",
  "..xxZZZZZZxx....",
  ".xZZZZZZZZZZx...",
  ".xZZxZZZZxZZx...",
  ".xZZZZZZZZZZx...",
  ".xZZZZxxZZZZx...",
  "..xZZZZZZZZx....",
  "...xxxxxxxx.....",
  "................",
  "................",
];

const OBAKE = [
  "................",
  "................",
  "....xxxxxx......",
  "...xeeeeeex.....",
  "..xeexeexeex....",
  "..xeeeeeeeex....",
  "..xeexxxxeex....",
  "..xeeeeeeeex....",
  "..xeeeeeeeex....",
  "..xeeeeeeeex....",
  "..xexeexeexx....",
  "..xx.xx.xx......",
  "................",
  "................",
  "................",
  "................",
];

const USAGI = [
  "................",
  "................",
  "....x..x........",
  "...xexxex.......",
  "...xexxex.......",
  "...xeeeex.......",
  "...xexxex.......",
  "..xeeeeeex......",
  "..xeeeeeeexx....",
  "..xeeeeeeeeex...",
  "..xeeexxeeeex...",
  "...xeex.xeex....",
  "................",
  "................",
  "................",
  "................",
];

export interface SpriteSet {
  readonly tiles: ReadonlyMap<Tile, HTMLCanvasElement>;
  /** The hero pair for a title tier (0..5); built lazily and cached. */
  heroFor(tier: number): readonly [HTMLCanvasElement, HTMLCanvasElement];
  readonly roles: Readonly<Record<string, readonly [HTMLCanvasElement, HTMLCanvasElement]>>;
  readonly critters: Readonly<Record<string, HTMLCanvasElement>>;
}

export function buildSprites(): SpriteSet {
  const tiles = new Map<Tile, HTMLCanvasElement>([
    [Tile.Grass, draw(GRASS)],
    [Tile.Grass2, draw(GRASS2)],
    [Tile.Tree, draw(TREE.map((r) => r.replaceAll(".", "g")))],
    [Tile.Water, draw(WATER)],
    [Tile.Sand, draw(SAND)],
    [Tile.Fence, draw(FENCE)],
    [Tile.Path, draw(PATH)],
    [Tile.HouseWall, draw(WALL)],
    [Tile.HouseRoof, draw(ROOF)],
    [Tile.HouseDoor, draw(DOOR)],
    [Tile.Sign, draw(SIGN)],
    [Tile.Chest, draw(CHEST)],
    [Tile.HallRoof, draw(roofIn("n", "N"))],
    [Tile.HallDoor, draw(doorWith("N"))],
    [Tile.MintRoof, draw(roofIn("q", "y"))],
    [Tile.MintDoor, draw(doorWith("y"))],
    [Tile.CourtRoof, draw(roofIn("m", "e"))],
    [Tile.CourtDoor, draw(doorWith("e"))],
    [Tile.Rock, draw(ROCK)],
    [Tile.Flower, draw(FLOWER)],
    [Tile.Stall, draw(STALL)],
    [Tile.RoofGreen, draw(roofIn("a", "T"))],
    [Tile.RoofBlue, draw(roofIn("w", "W"))],
    [Tile.RoofBrown, draw(roofIn("b", "F"))],
    [Tile.WallWood, draw(WALL_WOOD)],
    [Tile.DoorWood, draw(DOOR_WOOD)],
    [Tile.Well, draw(WELL)],
    [Tile.Farm, draw(FARM)],
    [Tile.Lamp, draw(LAMP)],
    [Tile.WallWindow, draw(winIn(WALL))],
    [Tile.WallWoodWindow, draw(winIn(WALL_WOOD))],
    [Tile.Snow, draw(SNOW)],
    [Tile.SnowTree, draw(SNOWTREE)],
    [Tile.Cactus, draw(CACTUS)],
    [Tile.Swamp, draw(SWAMP)],
    [Tile.Pavement, draw(PAVEMENT)],
    [Tile.Rail, draw(RAIL)],
    [Tile.BuildingWall, draw(BUILDING_WALL)],
    [Tile.BuildingRoof, draw(BUILDING_ROOF)],
    [Tile.Station, draw(STATION)],
    [Tile.Poster, draw(POSTER)],
    [Tile.HospitalRoof, draw(ROOF.map((row, y) => (y >= 5 && y <= 9 ? `${row.slice(0, 5)}rrrrrr${row.slice(11)}`.slice(0, 16) : row)).map((r) => r.replaceAll("r", "e").replaceAll("R", "e")).map((row, y) => (y >= 5 && y <= 9 ? `${row.slice(0, 7)}rr${row.slice(9)}` : y >= 6 && y <= 8 ? row : row)).map((row, y) => (y === 7 ? `${row.slice(0, 5)}rrrrrr${row.slice(11)}` : row)))],
    [Tile.HospitalDoor, draw(doorWith("r"))],
  ]);
  const pair = (key: string): readonly [HTMLCanvasElement, HTMLCanvasElement] => [draw(person(key, 0)), draw(person(key, 1))];
  const heroCache = new Map<number, readonly [HTMLCanvasElement, HTMLCanvasElement]>();
  return {
    tiles,
    heroFor(tier: number) {
      const clamped = Math.max(0, Math.min(tier, HERO_LOOKS.length - 1));
      let cached = heroCache.get(clamped);
      if (!cached) {
        const look = HERO_LOOKS[clamped] ?? HERO_LOOKS[0]!;
        cached = [draw(hero(look, 0)), draw(hero(look, 1))] as const;
        heroCache.set(clamped, cached);
      }
      return cached;
    },
    roles: { artisan: pair("a"), merchant: pair("o"), broker: pair("v"), treasury: pair("m"), tourist: pair("e") },
    critters: { slime: draw(SLIME), scorpion: draw(SCORPION), yukidaruma: draw(YUKIDARUMA), obake: draw(OBAKE), usagi: draw(USAGI) },
  };
}
