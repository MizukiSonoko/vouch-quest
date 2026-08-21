// The village item shop (道具屋) and diplomacy helpers — thin, pure rules over the
// node's real primitives. A purchase is two signed commands: pay the price into
// the village treasury (a real transfer, taxed like any other), then mint the
// item under the village's OWN minting institution. There is no buy-back: nobody
// holds an NPC's key, so nothing can pretend to sell on their behalf.

import type { RegionView, Snapshot, Stance } from "../shared";

export interface Ware {
  readonly kind: string;
  readonly name: string;
  readonly price: number;
  readonly blurb: string;
}

export const CATALOG: readonly Ware[] = [
  { kind: "herb", name: "やくそう", price: 8, blurb: "きずに よくきく のぐさ。" },
  { kind: "torch", name: "たいまつ", price: 12, blurb: "よみちを てらす ひかり。" },
  { kind: "tsubo", name: "つぼ", price: 15, blurb: "われると なにか でそうな つぼ。" },
  { kind: "shield", name: "かわのたて", price: 30, blurb: "しんらいは まもりから。" },
  { kind: "sword", name: "どうのつるぎ", price: 45, blurb: "かけだしの あかし。" },
  { kind: "gem", name: "ほうせき", price: 80, blurb: "とりひきの きらめき。" },
  { kind: "crown", name: "おうかん", price: 150, blurb: "そんちょうの けんい。" },
  { kind: "petslime", name: "ペットスライム", price: 30, blurb: "ぷるぷるが ついてくる。" },
  { kind: "petusagi", name: "こうさぎ", price: 35, blurb: "ぴょこぴょこと あとを ゆく。" },
  { kind: "hanabi", name: "はなびセット", price: 18, blurb: "よぞらに おおきな はなを さかせる。" },
  { kind: "gakki", name: "たびのがっき", price: 22, blurb: "ひとふし かなでれば こころ おどる。" },
];

export function wareByKind(kind: string): Ware | null {
  return CATALOG.find((w) => w.kind === kind) ?? null;
}

const EXTRA_NAMES: Readonly<Record<string, string>> = {
  yasai: "やさい",
  sakana: "さかな",
  byoki: "びょうき",
  bread: "パン",
  fish: "さかな",
  lantern: "ランタン",
  rope: "ロープ",
  boots: "ながぐつ",
  tea: "おちゃ",
  brick: "レンガ",
  gear: "はぐるま",
  kuzutetsu: "くずてつ",
  nisegane: "にせがね",
  garakuta: "ガラクタ",
  takara: "たから",
  mokuzai: "もくざい",
  ishi: "いし",
  tekko: "てっこう",
  kin: "きんのかたまり",
  daidogei: "げいのふだ",
};

// Vocabulary learned from the genome (see genome.ts) — merged at boot.
const LEARNED_NAMES: Record<string, string> = {};
const EXTRA_WARES: Ware[] = [];

export function registerKindNames(names: Readonly<Record<string, string>>): void {
  for (const [k, v] of Object.entries(names)) LEARNED_NAMES[k] = v;
}

/** Genome wares join the shop shelves — never shadowing the fixed catalog. */
export function registerWares(wares: readonly Ware[]): void {
  for (const w of wares) {
    if (CATALOG.some((c) => c.kind === w.kind) || EXTRA_WARES.some((c) => c.kind === w.kind)) continue;
    EXTRA_WARES.push(w);
  }
}

export function allWares(): readonly Ware[] {
  return [...CATALOG, ...EXTRA_WARES];
}

const BLD_JA: Readonly<Record<string, string>> = { house: "いえ", shop: "みせ", garden: "はなばたけ", tower: "とう", tree: "き", field: "はたけ" };

/** Parse a construction-deed kind (`bld<type><x>x<y>`), if it is one. */
export function parseBuilding(kind: string): { type: string; name: string; x: number; y: number } | null {
  const m = /^bld(house|shop|garden|tower|tree|field)(\d+)x(\d+)$/.exec(kind);
  if (!m) return null;
  return { type: m[1] ?? "", name: BLD_JA[m[1] ?? ""] ?? "たてもの", x: Number(m[2]), y: Number(m[3]) };
}

/** Display name for any item kind — catalog names for wares, the raw kind otherwise. */
export function kindName(kind: string): string {
  const bld = parseBuilding(kind);
  if (bld) return `${bld.name}の けんりしょ (${bld.x},${bld.y})`;
  const base = kind.replace(/\d+$/, "");
  return wareByKind(kind)?.name ?? EXTRA_WARES.find((w) => w.kind === base)?.name ?? EXTRA_NAMES[base] ?? LEARNED_NAMES[base] ?? kind;
}

/**
 * Whether the hero may shop in this village, mirroring the node's mint-item gate:
 * "owner" → the hero must own the region; "residents" → must live there; "anyone" → anyone.
 */
export function canShopHere(region: RegionView, snapshot: Snapshot): { ok: boolean; reason: string } {
  const minting = region.institutions.itemPolicy.minting;
  const heroRegion = snapshot.me.agentId?.split("@")[1];
  if (minting === "owner") {
    return region.owner === snapshot.me.heroName
      ? { ok: true, reason: "" }
      : { ok: false, reason: "この むらの おきてでは あるじしか しなものを つくれない…" };
  }
  if (minting === "residents") {
    return heroRegion === region.id ? { ok: true, reason: "" } : { ok: false, reason: "この みせは むらの じゅうみん せんようさ。" };
  }
  return { ok: true, reason: "" };
}

// ---- diplomacy --------------------------------------------------------------

/** The stance `region` takes toward `otherRegionId` (override, else default). */
export function stanceToward(region: RegionView, otherRegionId: string): Stance {
  return region.institutions.diplomacyPolicy.overrides[otherRegionId] ?? region.institutions.diplomacyPolicy.defaultStance;
}

export const STANCE_JA: Readonly<Record<Stance, string>> = {
  absorb: "うけいれ",
  map: "しんこう",
  reexamine: "ようすみ",
  reject: "こばみ",
};

export const STANCE_COLOR: Readonly<Record<Stance, string>> = {
  absorb: "#3fd05e",
  map: "#4a9fe8",
  reexamine: "#e8c840",
  reject: "#e04040",
};

/** Village pairs that are mutually friendly (both sides absorb or map) get a road. */
export function friendlyPairs(regions: readonly RegionView[]): [string, string][] {
  const warm = (s: Stance): boolean => s === "absorb" || s === "map";
  const pairs: [string, string][] = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      if (!a || !b) continue;
      if (warm(stanceToward(a, b.id)) && warm(stanceToward(b, a.id))) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

/** Prefectures: connected components of the friendship graph. The strongest
 * member is the seat; singleton villages stay independent. */
export interface Bloc {
  readonly name: string;
  readonly seat: string;
  readonly members: readonly string[];
}

export function prefectures(regions: readonly RegionView[], tierOf: (id: string) => number): Bloc[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const r of regions) parent.set(r.id, r.id);
  for (const [a, b] of friendlyPairs(regions)) union(a, b);
  const groups = new Map<string, string[]>();
  for (const r of regions) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r.id]);
  }
  const blocs: Bloc[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const seat = [...members].sort((a, b) => tierOf(b) - tierOf(a) || a.localeCompare(b))[0] ?? members[0] ?? "";
    const seatName = regions.find((r) => r.id === seat)?.displayName ?? seat;
    blocs.push({ name: `${seatName}けん`, seat, members });
  }
  return blocs;
}
