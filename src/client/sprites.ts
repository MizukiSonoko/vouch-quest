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

function hero(frame: 0 | 1): string[] {
  const rows = person("B", frame);
  rows[1] = ".....xyyyyx.....";
  rows[2] = "....xykkkkyx....";
  return rows;
}

export interface SpriteSet {
  readonly tiles: ReadonlyMap<Tile, HTMLCanvasElement>;
  readonly hero: readonly [HTMLCanvasElement, HTMLCanvasElement];
  readonly roles: Readonly<Record<string, readonly [HTMLCanvasElement, HTMLCanvasElement]>>;
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
  ]);
  const pair = (key: string): readonly [HTMLCanvasElement, HTMLCanvasElement] => [draw(person(key, 0)), draw(person(key, 1))];
  return {
    tiles,
    hero: [draw(hero(0)), draw(hero(1))],
    roles: { artisan: pair("a"), merchant: pair("o"), broker: pair("v"), treasury: pair("m") },
  };
}
