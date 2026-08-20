// The quest journal and hero titles — pure derivation from the world log plus the
// current snapshot. Nothing is stored: replaying the same history yields the same
// achievements for every player, in the spirit of the engine itself.

import type { AgentView, LogEventView, Snapshot } from "../shared";

export interface HeroStats {
  transfersSent: number;
  goldSent: number;
  transfersReceived: number;
  vouchesGiven: number;
  vouchesReceived: number;
  itemsMinted: number;
  itemsReceived: number;
  villagesFounded: number;
  migrations: number;
  votes: number;
  amendments: number;
  proposals: number;
}

const EMPTY: HeroStats = {
  transfersSent: 0,
  goldSent: 0,
  transfersReceived: 0,
  vouchesGiven: 0,
  vouchesReceived: 0,
  itemsMinted: 0,
  itemsReceived: 0,
  villagesFounded: 0,
  migrations: 0,
  votes: 0,
  amendments: 0,
  proposals: 0,
};

function at(payload: unknown, path: string): unknown {
  let v: unknown = payload;
  for (const key of path.split(".")) {
    v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
  }
  return v;
}

/** Fold the world log into this hero's lifetime statistics. */
export function heroStats(events: readonly LogEventView[], heroName: string | null): HeroStats {
  if (!heroName) return { ...EMPTY };
  const s = { ...EMPTY };
  const mine = (id: unknown): boolean => typeof id === "string" && (id === heroName || id.startsWith(`${heroName}@`));
  for (const e of events) {
    const p = e.payload;
    switch (e.type) {
      case "economy.settled": {
        const entries = at(p, "entries");
        if (!Array.isArray(entries)) break;
        for (const entry of entries as { agentId?: string; currencyDelta?: number }[]) {
          if (!mine(entry.agentId) || typeof entry.currencyDelta !== "number") continue;
          if (entry.currencyDelta < 0) {
            s.transfersSent++;
            s.goldSent += -entry.currencyDelta;
          } else if (entry.currencyDelta > 0) {
            s.transfersReceived++;
          }
        }
        break;
      }
      case "agent.vouched":
        if (mine(at(p, "from"))) s.vouchesGiven++;
        if (mine(at(p, "to"))) s.vouchesReceived++;
        break;
      case "item.minted":
        if (mine(at(p, "owner"))) s.itemsMinted++;
        break;
      case "item.transferred":
        if (mine(at(p, "to"))) s.itemsReceived++;
        break;
      case "region.founded":
        // The owner is a TOP-LEVEL payload field (the region object carries institutions only).
        if (mine(at(p, "owner")) || mine(at(p, "region.owner"))) s.villagesFounded++;
        break;
      case "agent.migrated":
        if (mine(at(p, "agentId"))) s.migrations++;
        break;
      case "gov.vote.cast":
        if (mine(at(p, "voter")) || mine(at(p, "by"))) s.votes++;
        break;
      case "region.institution.changed":
        if (mine(at(p, "by"))) s.amendments++;
        break;
      case "gov.proposal.opened":
        if (mine(at(p, "by"))) s.proposals++;
        break;
    }
  }
  return s;
}

export interface QuestContext {
  readonly stats: HeroStats;
  readonly snapshot: Snapshot;
  readonly hero: AgentView | null;
}

export interface Quest {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly done: (ctx: QuestContext) => boolean;
}

export const QUESTS: readonly Quest[] = [
  { id: "name", title: "なまえを きざむ", desc: "この せかいに なまえを とうろくする", done: (c) => !!c.snapshot.me.heroName && c.snapshot.me.registered },
  { id: "home", title: "すみかを もつ", desc: "どこかの むらの じゅうみんに なる", done: (c) => !!c.snapshot.me.agentId },
  { id: "founder", title: "そんちょうの うつわ", desc: "じぶんの むらを たてる", done: (c) => c.stats.villagesFounded > 0 },
  { id: "trade", title: "はじめての あきない", desc: "だれかに ゴールドを わたす", done: (c) => c.stats.transfersSent > 0 },
  { id: "patron", title: "きまえの よさ", desc: "あわせて 50G いじょう わたす", done: (c) => c.stats.goldSent >= 50 },
  { id: "voucher", title: "ほしょうにん", desc: "だれかを ほしょうする", done: (c) => c.stats.vouchesGiven > 0 },
  { id: "trusted", title: "しんらいの あかし", desc: "だれかに ほしょうしてもらう", done: (c) => c.stats.vouchesReceived > 0 },
  { id: "artisan", title: "ものづくりの こころ", desc: "どうぐを つくる", done: (c) => c.stats.itemsMinted > 0 },
  { id: "collector", title: "たからもの", desc: "どうぐを ゆずりうける", done: (c) => c.stats.itemsReceived > 0 },
  { id: "politician", title: "せいじの ちから", desc: "おきてを かえる・ていあんする・とうひょうする", done: (c) => c.stats.amendments + c.stats.proposals + c.stats.votes > 0 },
  { id: "nomad", title: "たびがらす", desc: "べつの むらへ ひっこす", done: (c) => c.stats.migrations > 0 },
  { id: "rich", title: "ちょうじゃ", desc: "200G いじょう ためる", done: (c) => (c.hero?.balances.currency ?? 0) >= 200 },
];

export function questProgress(ctx: QuestContext): { quest: Quest; done: boolean }[] {
  return QUESTS.map((quest) => ({ quest, done: quest.done(ctx) }));
}

/** The hero's current title — the highest rung they have reached. */
export function heroTitle(ctx: QuestContext): string {
  const doneCount = questProgress(ctx).filter((q) => q.done).length;
  if (doneCount >= QUESTS.length) return "でんせつの ゆうしゃ";
  const trust = ctx.hero?.trust ?? 0;
  const gold = ctx.hero?.balances.currency ?? 0;
  if (trust >= 10) return "しんらいの おうじゃ";
  if (gold >= 300) return "だいごうしょう";
  if (ctx.stats.villagesFounded > 0) return "そんちょう";
  if (ctx.stats.vouchesGiven >= 3) return "ほしょうにん";
  if (ctx.stats.transfersSent > 0) return "あきんど";
  if (ctx.snapshot.me.agentId) return "むらびと";
  return "かけだしの たびびと";
}

/** Sprite tier for a title (see sprites.HERO_LOOKS): 0 plain … 5 legendary. */
export function titleTier(title: string): number {
  switch (title) {
    case "でんせつの ゆうしゃ":
      return 5;
    case "しんらいの おうじゃ":
      return 4;
    case "だいごうしょう":
      return 3;
    case "そんちょう":
      return 2;
    case "ほしょうにん":
    case "あきんど":
      return 1;
    default:
      return 0;
  }
}
