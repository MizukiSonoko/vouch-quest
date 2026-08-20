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
];

export function wareByKind(kind: string): Ware | null {
  return CATALOG.find((w) => w.kind === kind) ?? null;
}

/** Display name for any item kind — catalog names for wares, the raw kind otherwise. */
export function kindName(kind: string): string {
  return wareByKind(kind)?.name ?? kind;
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
