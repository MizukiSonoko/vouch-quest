// The evolution daemon — the piece that lets the world grow WITHOUT anyone
// typing prompts. On a timer it reads the REAL event log, shows Claude the
// current genome plus what actually happened, and asks for additions:
// vocabulary, chatter, wares, professions, headlines. The reply is DATA,
// validated line by line; anything malformed is dropped. Merged append-only
// with hard caps, written atomically. No key → clean no-op.
//
// DEPLOYMENT: ~/vouch/vouch-cli/evolve.ts on the node host, fired by
// vouch-evolve.timer. Env (~/.config/vouch/evolver.env): ANTHROPIC_API_KEY.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const NODE = process.env["VOUCH_NODE_URL"] ?? "http://127.0.0.1:8787";
const GENOME_PATH = process.env["GENOME_PATH"] ?? `${process.env["HOME"]}/vouch-data/genome.json`;

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.log("evolve: ANTHROPIC_API_KEY not set — the world rests today.");
  process.exit(0);
}

// ---- current genome ------------------------------------------------------------

interface Mutation {
  id: number;
  kind: string;
  title: string;
  lines: string[];
}

interface Genome {
  version: number;
  updatedAt?: string;
  vocab: Record<string, string>;
  chatter: Record<string, string[]>;
  wares: { kind: string; name: string; price: number; blurb: string }[];
  professions: { name: string; role: string; craft: string; greeting: string }[];
  headlines: string[];
  mutations: Mutation[];
}

function loadGenome(): Genome {
  try {
    const g = JSON.parse(readFileSync(GENOME_PATH, "utf8")) as Partial<Genome>;
    return {
      version: typeof g.version === "number" ? g.version : 0,
      vocab: g.vocab ?? {},
      chatter: g.chatter ?? {},
      wares: g.wares ?? [],
      professions: g.professions ?? [],
      headlines: g.headlines ?? [],
      mutations: g.mutations ?? [],
    };
  } catch {
    return { version: 0, vocab: {}, chatter: {}, wares: [], professions: [], headlines: [], mutations: [] };
  }
}

// ---- observe the real world ----------------------------------------------------

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface RegionV {
  id: string;
  displayName: string;
  owner: string | null;
  institutions: { governance: { kind: string }; itemPolicy: { minting: string }; economyPolicy: { baseCostRate: number } };
}
interface AgentV {
  id: string;
  region: string;
  role: string;
  balances: { currency: number };
  trust: number;
  reputation: number;
}

async function worldBrief(): Promise<string> {
  const regions = await getJson<RegionV[]>("/regions");
  const agents = await getJson<AgentV[]>("/agents");
  const metrics = await getJson<{ log: { length: number } }>("/metrics");
  const since = Math.max(0, metrics.log.length - 80);
  const recent = await getJson<{ type: string; payload: Record<string, unknown> }[]>(`/log?since=${since}`);
  const kinds = new Map<string, number>();
  for (const e of recent) kinds.set(e.type, (kinds.get(e.type) ?? 0) + 1);
  const lines = [
    `log length: ${metrics.log.length}`,
    `regions (${regions.length}): ${regions
      .map((r) => {
        const pop = agents.filter((a) => a.region === r.id && a.role !== "treasury").length;
        const bank = agents.find((a) => a.id === `treasury@${r.id}`)?.balances.currency ?? 0;
        return `${r.id}(${r.displayName}) pop=${pop} bank=${bank}G gov=${r.institutions.governance.kind} mint=${r.institutions.itemPolicy.minting} tax=${r.institutions.economyPolicy.baseCostRate}`;
      })
      .join("; ")}`,
    `recent event mix (last ${recent.length}): ${[...kinds.entries()].map(([t, n]) => `${t}x${n}`).join(", ")}`,
    `richest: ${[...agents]
      .filter((a) => a.role !== "treasury")
      .sort((a, b) => b.balances.currency - a.balances.currency)
      .slice(0, 5)
      .map((a) => `${a.id}=${a.balances.currency}G`)
      .join(", ")}`,
  ];
  return lines.join("\n");
}

// ---- ask Claude for additions (structured output) ------------------------------

const ADDITIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vocab", "chatter", "wares", "professions", "headlines", "mutation"],
  properties: {
    vocab: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name"],
        properties: { kind: { type: "string" }, name: { type: "string" } },
      },
    },
    chatter: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pool", "lines"],
        properties: {
          pool: { type: "string", enum: ["artisan", "merchant", "broker", "child", "elder", "city", "hamlet", "festival", "married", "power", "dark", "generic", "market"] },
          lines: { type: "array", items: { type: "string" } },
        },
      },
    },
    wares: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "price", "blurb"],
        properties: { kind: { type: "string" }, name: { type: "string" }, price: { type: "integer" }, blurb: { type: "string" } },
      },
    },
    professions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "craft", "greeting"],
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["artisan", "merchant", "broker"] },
          craft: { type: "string" },
          greeting: { type: "string" },
        },
      },
    },
    headlines: { type: "array", items: { type: "string" } },
    mutation: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "title", "lines"],
      properties: {
        kind: { type: "string", enum: ["fashion", "legend", "boom", "omen", "festival"] },
        title: { type: "string" },
        lines: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

interface Additions {
  vocab: { kind: string; name: string }[];
  chatter: { pool: string; lines: string[] }[];
  wares: { kind: string; name: string; price: number; blurb: string }[];
  professions: { name: string; role: string; craft: string; greeting: string }[];
  headlines: string[];
  mutation: { kind: string; title: string; lines: string[] };
}

const MUTATION_SEEDS = ["りゅうこうの ふくそう", "むかしばなしの ふっかつ", "なぞの しょうばいブーム", "そらの いへん", "まぼろしの いきもの", "あたらしい あそび", "こいの うわさ", "きんの ねだんの うわさ", "ふるい のろい", "みらいの よげん"];
const MUTATION_SEED = MUTATION_SEEDS[Math.floor(Math.random() * MUTATION_SEEDS.length)];

async function askClaude(genome: Genome, brief: string): Promise<Additions> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: ADDITIONS_SCHEMA as unknown as Record<string, unknown> } },
    system: [
      "あなたは『vouch quest』というドット絵の社会シミュレーション世界の《進化の女神》です。",
      "世界はイベントソーシングされた本物の経済(通貨保存・署名済みコマンド)の上に立っています。",
      "あなたの仕事は、実際に起きた出来事を観察し、世界の語彙・文化・職業を少しずつ進化させることです。",
      "出力ルール:",
      "- すべてのセリフ・名前・見出しはドラクエ風の《ひらがな・カタカナ中心》、1行64文字以内。",
      "- kind/craft は英小文字 [a-z][a-z0-9]{1,23}。職業名は romaji で先頭大文字 [A-Za-z][A-Za-z0-9]{1,23}。",
      "- price は 1〜500 の整数。既存の kind と重複しない新しいものを。",
      "- 世界の観察(発展した町、金持ち、最近のイベント傾向、政治体制)を反映した内容にすること。",
      "- 追加量: vocab≦8, chatter 合計≦14行, wares≦2, professions≦2, headlines≦5。",
      `- さらに《とつぜんへんい》を必ず1件: kind は fashion(流行)/legend(伝説)/boom(ブーム)/omen(前兆)/festival(祭り)。title は24字以内、lines は住民が口にする噂 2〜4行。今回の変異の種は『${MUTATION_SEED}』— 世界の実データに絡めた、予想外で大胆なものを。`,
      "- 職業は世界に実在する住民として雇われ、craft を鋳造して暮らします。現実の職業の多様性(medic, brewer, poet, miner, weaver, courier...)を参考に。",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: `いまのゲノム(現在の語彙・文化):\n${JSON.stringify(genome).slice(0, 6000)}\n\n世界の観察:\n${brief}\n\nこの世界を一歩進化させる「追加分」だけを JSON で出力してください。`,
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("model refused");
  const text = message.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Additions;
}

// ---- validate + merge (append-only, capped) ------------------------------------

const okShort = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const okKind = (x: unknown): x is string => typeof x === "string" && /^[a-z][a-z0-9]{1,23}$/.test(x);
const okName = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z][A-Za-z0-9]{1,23}$/.test(x);

function merge(genome: Genome, add: Additions): { genome: Genome; grown: string[] } {
  const grown: string[] = [];
  for (const v of (add.vocab ?? []).slice(0, 8)) {
    if (okKind(v.kind) && okShort(v.name, 24) && !(v.kind in genome.vocab) && Object.keys(genome.vocab).length < 400) {
      genome.vocab[v.kind] = v.name;
      grown.push(`vocab:${v.kind}`);
    }
  }
  for (const c of add.chatter ?? []) {
    if (!/^[a-z]{2,16}$/.test(c.pool)) continue;
    const pool = (genome.chatter[c.pool] ??= []);
    for (const line of (c.lines ?? []).slice(0, 14)) {
      if (okShort(line, 64) && !pool.includes(line) && pool.length < 120) {
        pool.push(line);
        grown.push(`chatter:${c.pool}`);
      }
    }
  }
  for (const w of (add.wares ?? []).slice(0, 2)) {
    if (
      okKind(w.kind) && okShort(w.name, 24) && okShort(w.blurb, 64) &&
      Number.isInteger(w.price) && w.price >= 1 && w.price <= 500 &&
      !genome.wares.some((x) => x.kind === w.kind) && genome.wares.length < 60
    ) {
      genome.wares.push({ kind: w.kind, name: w.name, price: w.price, blurb: w.blurb });
      grown.push(`ware:${w.kind}`);
    }
  }
  for (const p of (add.professions ?? []).slice(0, 2)) {
    if (
      okName(p.name) && (p.role === "artisan" || p.role === "merchant" || p.role === "broker") &&
      okKind(p.craft) && okShort(p.greeting, 64) &&
      !genome.professions.some((x) => x.name === p.name) && genome.professions.length < 60
    ) {
      genome.professions.push({ name: p.name, role: p.role, craft: p.craft, greeting: p.greeting });
      grown.push(`profession:${p.name}`);
    }
  }
  const mu = add.mutation;
  if (mu && ["fashion", "legend", "boom", "omen", "festival"].includes(mu.kind) && okShort(mu.title, 24)) {
    const mlines = (mu.lines ?? []).filter((l) => okShort(l, 64)).slice(0, 4);
    if (mlines.length > 0) {
      genome.mutations.push({ id: genome.version + 1, kind: mu.kind, title: mu.title, lines: mlines });
      genome.mutations = genome.mutations.slice(-20);
      grown.push(`mutation:${mu.kind}:${mu.title}`);
    }
  }
  const fresh = (add.headlines ?? []).filter((h) => okShort(h, 64)).slice(0, 5);
  genome.headlines = [...genome.headlines, ...fresh].slice(-40);
  if (fresh.length > 0) grown.push(`headlines+${fresh.length}`);
  genome.version += 1;
  genome.updatedAt = new Date().toISOString();
  return { genome, grown };
}

// ---- run -----------------------------------------------------------------------

const genome = loadGenome();
const brief = await worldBrief();
console.log("evolve: observing the world…\n" + brief);
const additions = await askClaude(genome, brief);
const { genome: next, grown } = merge(genome, additions);
mkdirSync(dirname(GENOME_PATH), { recursive: true });
const tmp = `${GENOME_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(next, null, 2));
renameSync(tmp, GENOME_PATH);
console.log(`evolve: genome v${next.version} — grown: ${grown.join(", ") || "(nothing new survived validation)"}`);
