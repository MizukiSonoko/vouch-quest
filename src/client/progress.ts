// The fun spine: experience, levels, unlocks, era goals — every point folded
// honestly from the hero's REAL deeds in the world log. Nothing is stored;
// replaying the log always yields the same level. Unlocks are pure UX gates
// (the node enforces nothing extra), pacing the 200+ verbs into a ladder.

import type { LogEventView } from "../shared";

export interface EraGoal {
  readonly label: string;
  readonly need: number;
  readonly have: number;
  readonly done: boolean;
}

export interface Progress {
  readonly xp: number;
  readonly level: number;
  /** XP inside the current level / needed for the next. */
  readonly xpInto: number;
  readonly xpNeed: number;
  readonly trades: number;
  readonly vouchesGiven: number;
  readonly vouchesGot: number;
  readonly crafts: number;
  readonly builds: number;
  readonly journeys: number;
  readonly donated: number;
  readonly goals: readonly EraGoal[];
}

/** Cumulative XP needed to REACH a level (Lv1 = 0). */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.floor(22 * (level - 1) ** 1.6);
}

export function levelFromXp(xp: number): number {
  let lv = 1;
  while (xpForLevel(lv + 1) <= xp && lv < 99) lv++;
  return lv;
}

/** What each level opens. Everything is free to SEE; gates create anticipation. */
export const UNLOCKS: Readonly<Record<number, readonly string[]>> = {
  2: ["けんちく (かざり・しぜん)", "むらづくりへの きふ"],
  3: ["だいどうげい", "むらを たてる"],
  4: ["ものづくり", "よきん (ぎんこう)"],
  5: ["でしいり", "けんちく (すまい)"],
  6: ["こくはく (れんあい)"],
  7: ["こどもを むかえる", "けんちく (みせ・しごと)"],
  8: ["おきての ていあん (せいじ)"],
  9: ["けんちく (こうきょう)"],
  10: ["ふどうさん (うる・ゆずる)"],
  12: ["むらの かいとり"],
};

/** The level a gated feature needs. */
export const GATE: Readonly<Record<string, number>> = {
  buildDecor: 2,
  donate: 2,
  perform: 3,
  found: 3,
  craft: 4,
  deposit: 4,
  apprentice: 5,
  buildHome: 5,
  propose2: 6,
  child: 7,
  buildShop: 7,
  proposeLaw: 8,
  buildCivic: 9,
  estate: 10,
  buyRegion: 12,
};

const GOAL_POOL: readonly (readonly [string, string, number])[] = [
  ["trade", "とりひきを する", 3],
  ["vouch", "だれかを ほしょうする", 1],
  ["build", "たてものを たてる", 1],
  ["craft", "どうぐを つくる", 2],
  ["donate", "きんこに きふする (10G)", 10],
  ["deliver", "どうぐを だれかに とどける", 1],
  ["journey", "べつの むらへ うつる/たびする", 1],
];

const ERA_SPAN = 500;

/** Fold the hero's whole career (and this era's goals) out of the log. */
export function foldProgress(events: readonly LogEventView[], heroAgentId: string | null, heroName: string | null): Progress {
  let trades = 0;
  let vouchesGiven = 0;
  let vouchesGot = 0;
  let crafts = 0;
  let builds = 0;
  let journeys = 0;
  let donated = 0;
  let founded = 0;
  let delivered = 0;
  const logLength = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) + 1 : 0;
  const eraStart = Math.floor(logLength / ERA_SPAN) * ERA_SPAN;
  const eraCounts: Record<string, number> = { trade: 0, vouch: 0, build: 0, craft: 0, donate: 0, deliver: 0, journey: 0 };

  for (const e of events) {
    const p = e.payload;
    const inEra = e.seq >= eraStart;
    if (!heroAgentId) continue;
    if (e.type === "economy.settled") {
      const entries = (p["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
      const mine = entries.find((x) => x.agentId === heroAgentId);
      if (mine && typeof mine.currencyDelta === "number" && mine.currencyDelta !== 0) {
        trades++;
        if (inEra) eraCounts["trade"] = (eraCounts["trade"] ?? 0) + 1;
        const gift = entries.find((x) => x.agentId?.startsWith("treasury@") && (x.currencyDelta ?? 0) > 0);
        if (mine.currencyDelta < 0 && gift) {
          donated += gift.currencyDelta ?? 0;
          if (inEra) eraCounts["donate"] = (eraCounts["donate"] ?? 0) + (gift.currencyDelta ?? 0);
        }
      }
    } else if (e.type === "agent.vouched") {
      if (p["from"] === heroAgentId) {
        vouchesGiven++;
        if (inEra) eraCounts["vouch"] = (eraCounts["vouch"] ?? 0) + 1;
      }
      if (p["to"] === heroAgentId) vouchesGot++;
    } else if (e.type === "item.minted") {
      if (p["owner"] === heroAgentId) {
        const kind = typeof p["kind"] === "string" ? (p["kind"] as string) : "";
        if (kind.startsWith("bld")) {
          builds++;
          if (inEra) eraCounts["build"] = (eraCounts["build"] ?? 0) + 1;
        } else {
          crafts++;
          if (inEra) eraCounts["craft"] = (eraCounts["craft"] ?? 0) + 1;
        }
      }
    } else if (e.type === "item.transferred") {
      if (p["from"] === heroAgentId && typeof p["to"] === "string" && !(p["to"] as string).startsWith("treasury@")) {
        delivered++;
        if (inEra) eraCounts["deliver"] = (eraCounts["deliver"] ?? 0) + 1;
      }
    } else if (e.type === "agent.migrated") {
      if (p["agentId"] === heroAgentId) {
        journeys++;
        if (inEra) eraCounts["journey"] = (eraCounts["journey"] ?? 0) + 1;
      }
    } else if (e.type === "region.founded") {
      const owner = p["owner"];
      if (heroName && owner === heroName) founded++;
    }
  }

  // Era goals: three per era, picked deterministically from the era number.
  const era = Math.floor(logLength / ERA_SPAN);
  const goals: EraGoal[] = [];
  for (let k = 0; k < 3; k++) {
    let hsh = (era * 7919 + k * 104729) % 233280;
    hsh = (hsh * 9301 + 49297) % 233280;
    const pick = GOAL_POOL[hsh % GOAL_POOL.length];
    if (!pick) continue;
    if (goals.some((g) => g.label === pick[1])) continue;
    const have = eraCounts[pick[0]] ?? 0;
    goals.push({ label: pick[1], need: pick[2], have: Math.min(have, pick[2]), done: have >= pick[2] });
  }

  const goalBonus = goals.filter((g) => g.done).length * 15;
  const xp =
    trades * 3 +
    vouchesGiven * 2 +
    vouchesGot * 2 +
    crafts * 4 +
    builds * 10 +
    journeys * 2 +
    Math.floor(donated / 2) +
    delivered * 5 +
    founded * 25 +
    goalBonus;
  const level = levelFromXp(xp);
  return {
    xp,
    level,
    xpInto: xp - xpForLevel(level),
    xpNeed: Math.max(1, xpForLevel(level + 1) - xpForLevel(level)),
    trades,
    vouchesGiven,
    vouchesGot,
    crafts,
    builds,
    journeys,
    donated,
    goals,
  };
}

/** みちびきのてがみ: the world writes to you at each level. */
export const LETTERS: Readonly<Record<number, readonly string[]>> = {
  2: ["たびびとよ、みちは ひらかれた。", "きづいたか? この せかいでは じぶんの てで にわも いえも つくれる。", "コマンドの「けんちく」— まずは はなを うえてみるといい。", "そして むらの きんこに きふを。まちは カネで そだつ。"],
  3: ["おぬしの うわさを きいた。", "ひろばで げいを ひろうしてみよ。みなが おひねりを くれる。", "じしんが あれば、じぶんの むらを たてるのも よい。", "「むらを たてる」— れきしは そこから はじまる。"],
  4: ["てさきが きようだな。", "「ものづくり」で しなを つくり、うりさばくがいい。", "かせいだ カネは Ginkoの ぎんこうへ。りそくが つく。"],
  5: ["★じるしの たみを みたか? しんかが うんだ しょくにんたちだ。", "かれらに でしいりすれば、あたらしい わざを ならえる。", "いえを たてる ゆるしも でた。「すまい」の たなを みよ。"],
  6: ["こころに きめた ひとは いるか?", "「こくはく」で おもいを つたえられる ようになった。", "おもいが かよえば、むらじゅうが いわう けっこんしきだ。"],
  7: ["かていを もつ ものは まちの みらいも つくる。", "こどもを むかえ、みせを ひらく ときが きた。"],
  8: ["まちの おきてに くちを だす しかくを えた。", "さいばんしょで ていあんし、とうひょうで きめよ。", "けんぽうも ぜいせいも、たみの こえで かわる。"],
  9: ["こうきょうの たてものが かいきんだ。", "ふんすいひろばや でんぱとうで まちを かざれ。"],
  10: ["おぬしは もう ふどうさんの めききだ。", "むらを うり、ゆずり、たたむ — とちの じだいが きた。"],
  12: ["さいごの とびらだ。", "うりに でた むらを かいとり、おうこくを きずけ。", "この せかいの れきしに、おぬしの なが のこる。"],
};
