// The cycle of life, read out of the world log. Marriage is a mutual vouch;
// birth is the admission of a child-named agent; sickness is holding a `byoki`
// token; death is the one honest exit an append-only world allows — migrating
// to the afterlife region. Nothing here is stored: the log is the registry.

import type { LogEventView } from "../shared";

/** The afterlife: agents who migrate here have died. Never drawn on the map. */
export const AFTERLIFE = "anoyo";
/** The sickness token kind. */
export const BYOKI = "byoki";
/** Child names the midwives use — a trailing number keeps them unique. */
export const CHILD_NAMES = ["Kotaro", "Hanako", "Jiro", "Momoko", "Shinta", "Sakurako", "Anzu", "Mame", "Chibi", "Tonbo"];

export function isChildName(agentId: string): boolean {
  const name = (agentId.split("@")[0] ?? "").replace(/\d+$/, "");
  return CHILD_NAMES.includes(name);
}

export function isDead(agentRegion: string): boolean {
  return agentRegion === AFTERLIFE;
}

/** Incremental wedding detector: feed vouch edges, get completed marriages. */
export class WeddingBook {
  private readonly edges = new Set<string>();
  private readonly married = new Set<string>();

  /** Record a vouch edge; returns the couple if this completes a NEW mutual bond. */
  vouch(from: string, to: string): readonly [string, string] | null {
    this.edges.add(`${from}>${to}`);
    const pair = [from, to].sort().join("|");
    if (this.edges.has(`${to}>${from}`) && !this.married.has(pair)) {
      this.married.add(pair);
      return [from, to] as const;
    }
    return null;
  }

  /** The spouse of an agent, if any. */
  partnerOf(agentId: string): string | null {
    for (const pair of this.married) {
      const [a, b] = pair.split("|");
      if (a === agentId) return b ?? null;
      if (b === agentId) return a ?? null;
    }
    return null;
  }

  /** Whether an agent already has a spouse on record. */
  isMarried(agentId: string): boolean {
    for (const pair of this.married) {
      const [a, b] = pair.split("|");
      if (a === agentId || b === agentId) return true;
    }
    return false;
  }

  get marriages(): number {
    return this.married.size;
  }
}

/** Rebuild the wedding book (and count lives) from the whole history. */
export function foldLife(events: readonly LogEventView[]): { book: WeddingBook; births: number; deaths: number; sick: number } {
  const book = new WeddingBook();
  let births = 0;
  let deaths = 0;
  let sick = 0;
  for (const e of events) {
    const p = e.payload;
    if (e.type === "agent.vouched") {
      const from = typeof p["from"] === "string" ? (p["from"] as string) : "";
      const to = typeof p["to"] === "string" ? (p["to"] as string) : "";
      if (from && to) book.vouch(from, to);
    } else if (e.type === "agent.admitted") {
      const id = ((p["admission"] as Record<string, unknown> | undefined)?.["id"] as string | undefined) ?? "";
      if (isChildName(id)) births++;
    } else if (e.type === "agent.migrated") {
      if (p["toRegion"] === AFTERLIFE) deaths++;
    } else if (e.type === "item.minted") {
      if (p["kind"] === BYOKI) sick++;
    }
  }
  return { book, births, deaths, sick };
}
