// The world's genome — an evolving DATA pack (vocabulary, wares, chatter,
// professions) grown by an LLM daemon that lives next to the node and reads
// the real event log. The game is complete without it; a genome only ADDS
// flavor. Whatever the daemon produces is validated structurally here before
// a single string reaches the screen: the LLM's output is data, never code.

export interface GenomeWare {
  readonly kind: string;
  readonly name: string;
  readonly price: number;
  readonly blurb: string;
}

export interface GenomeProfession {
  readonly name: string;
  readonly role: "artisan" | "merchant" | "broker";
  readonly craft: string;
  readonly greeting: string;
}

export interface Genome {
  readonly version: number;
  readonly vocab: Readonly<Record<string, string>>;
  readonly chatter: Readonly<Record<string, readonly string[]>>;
  readonly wares: readonly GenomeWare[];
  readonly professions: readonly GenomeProfession[];
  readonly headlines: readonly string[];
}

const isShortText = (x: unknown, max = 64): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const isKind = (x: unknown): x is string => typeof x === "string" && /^[a-z][a-z0-9]{1,23}$/.test(x);
const isName = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z][A-Za-z0-9]{1,23}$/.test(x);

/** Structural validation — drops anything malformed rather than failing. */
export function validateGenome(raw: unknown): Genome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const vocab: Record<string, string> = {};
  for (const [k, v] of Object.entries((g["vocab"] as Record<string, unknown> | undefined) ?? {})) {
    if (isKind(k) && isShortText(v, 24)) vocab[k] = v;
  }
  const chatter: Record<string, string[]> = {};
  for (const [k, v] of Object.entries((g["chatter"] as Record<string, unknown> | undefined) ?? {})) {
    if (!/^[a-z]{2,16}$/.test(k) || !Array.isArray(v)) continue;
    const lines = v.filter((l): l is string => isShortText(l, 64)).slice(0, 100);
    if (lines.length > 0) chatter[k] = lines;
  }
  const wares: GenomeWare[] = [];
  for (const w of Array.isArray(g["wares"]) ? (g["wares"] as unknown[]) : []) {
    const o = w as Record<string, unknown>;
    if (isKind(o["kind"]) && isShortText(o["name"], 24) && typeof o["price"] === "number" && o["price"] >= 1 && o["price"] <= 500 && isShortText(o["blurb"], 64)) {
      wares.push({ kind: o["kind"], name: o["name"], price: Math.floor(o["price"]), blurb: o["blurb"] });
    }
  }
  const professions: GenomeProfession[] = [];
  for (const p of Array.isArray(g["professions"]) ? (g["professions"] as unknown[]) : []) {
    const o = p as Record<string, unknown>;
    const role = o["role"];
    if (isName(o["name"]) && (role === "artisan" || role === "merchant" || role === "broker") && isKind(o["craft"]) && isShortText(o["greeting"], 64)) {
      professions.push({ name: o["name"], role, craft: o["craft"], greeting: o["greeting"] });
    }
  }
  const headlines = (Array.isArray(g["headlines"]) ? (g["headlines"] as unknown[]) : []).filter((h): h is string => isShortText(h, 64)).slice(0, 60);
  return { version: typeof g["version"] === "number" ? g["version"] : 0, vocab, chatter, wares, professions, headlines };
}

/** Fetch the live genome from the content proxy; null on any failure. */
export async function loadGenome(base = "/genome"): Promise<Genome | null> {
  try {
    const res = await fetch(base, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return validateGenome(await res.json());
  } catch {
    return null;
  }
}
