// vouch quest — a DQ1-style pixel client over a live vouch world.
// The loop: render the overworld derived from the node's state, walk your hero,
// talk to agents (transfer / vouch / hand items), read village signboards
// (institutions / migrate / govern), and found new villages on empty land.
// Every action becomes a signed command; every world event scrolls the newspaper.

import type { AgentView, ItemView, LogEventView, Snapshot } from "../shared";
import { dayPhase, ParticleField, SkyShow, Weather, Wildlife } from "./ambience";
import { npcLines, registerChatter } from "./dialogue";
import { AFTERLIFE, BYOKI, CHILD_NAMES, foldLife, isChildName, isDead, WeddingBook } from "./life";
import { eventToMessage } from "./feed";
import { Biome, BIOME_JA, biomeAt, buildMap, heroSpawn, isSolid, MAP_H, MAP_W, placeNpcs, Tile, tileAt, type Village, villageContains, type WorldMap } from "./map";
import { loadGenome } from "./genome";
import { fetchAllLog, fetchWorld, postAct, postRegister } from "./net";
import { classifyRegime, type GovernanceValue, lawLayer, lawText, municipalRank, REGIME_COLOR, REGIME_JA, REGIMES } from "./politics";
import { heroStats, heroTitle, type QuestContext, questProgress, titleTier } from "./quests";
import { allWares, canShopHere, CATALOG, friendlyPairs, kindName, prefectures, registerKindNames, registerWares, STANCE_COLOR, STANCE_JA, stanceToward, type Ware } from "./shop";
import { bgmEnabled, se, startAudio, toggleBgm } from "./sound";
import { buildSprites, CELL } from "./sprites";
import { drawText, drawWindow, Info, Menu, MessageLog, TextInput, UiStack } from "./ui";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("canvas 2d context unavailable");
ctx.imageSmoothingEnabled = false;

const sprites = buildSprites();
const ui = new UiStack();
const log = new MessageLog();
const particles = new ParticleField();
const wildlife = new Wildlife();
const weather = new Weather();
const sky = new SkyShow();
const festivals = new Map<string, number>();
const prevTiers = new Map<string, number>();
let gogai: { text: string; until: number } | null = null;
let shakeUntil = 0;
interface Critter {
  kind: string;
  x: number;
  y: number;
  px: number;
  py: number;
  timer: number;
}
let critters: Critter[] = [];
const construction = new Map<string, number>();
const prevResidents = new Map<string, number>();
let prevFriendships = new Set<string>();
interface Tourist {
  x: number;
  y: number;
  px: number;
  py: number;
  timer: number;
  home: Village;
}
let tourists: Tourist[] = [];
let weddingBook = new WeddingBook();

// たびのきろく — the personal travel journal (presentation-side, per browser).
const JOURNAL_KEY = "vouchquest.journal";
interface Journal {
  visited: string[];
  critters: string[];
  rides: number;
  /** Crafts learned through でしいり (apprenticeship to genome-born artisans). */
  learned: string[];
}
function journal(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "{}") as Partial<Journal>;
    return { visited: j.visited ?? [], critters: j.critters ?? [], rides: j.rides ?? 0, learned: j.learned ?? [] };
  } catch {
    return { visited: [], critters: [], rides: 0, learned: [] };
  }
}
function saveJournal(j: Journal): void {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(j));
}

function extraExtra(text: string): void {
  gogai = { text, until: performance.now() + 4600 };
  shakeUntil = performance.now() + 700;
  se("fanfare");
}
let scene: "title" | "game" | "interior" = "title";
interface InteriorRoom {
  readonly village: Village;
  readonly occupant: AgentView | null;
  readonly furniture: readonly { x: number; y: number; kind: "bed" | "table" | "shelf" | "pot" }[];
  readonly exit: readonly [number, number];
  px: number;
  py: number;
}
let interior: InteriorRoom | null = null;
const ROOM_W = 11;
const ROOM_H = 8;

function enterHouse(village: Village, homeIndex: number): void {
  const residents = (snapshot?.agents ?? [])
    .filter((a) => a.region === village.regionId && a.role !== "treasury" && a.id !== snapshot?.me.agentId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const occupant = residents[homeIndex % Math.max(1, residents.length)] ?? null;
  const furniture: { x: number; y: number; kind: "bed" | "table" | "shelf" | "pot" }[] = [
    { x: 1, y: 1, kind: "bed" },
    { x: ROOM_W - 3, y: 1, kind: "shelf" },
    { x: 4 + Math.floor(Math.random() * 3), y: 3, kind: "table" },
    { x: 1, y: ROOM_H - 3, kind: "pot" },
  ];
  interior = { village, occupant, furniture, exit: [Math.floor(ROOM_W / 2), ROOM_H - 1] as const, px: Math.floor(ROOM_W / 2), py: ROOM_H - 2 };
  scene = "interior";
  se("confirm");
  log.push(occupant ? `${occupant.id}の いえに おじゃまします…` : "だれも いない いえだ…");
}

function interiorSolid(x: number, y: number): boolean {
  if (!interior) return true;
  if (x <= 0 || y <= 0 || x >= ROOM_W - 1 || y >= ROOM_H - 1) {
    return !(x === interior.exit[0] && y === interior.exit[1]);
  }
  return interior.furniture.some((f) => f.x === x && f.y === y) || (interior.occupant !== null && x === 3 && y === 2);
}
let banner: { text: string; until: number } | null = null;
let tickerText = "";
let tickerX = 0;
let nextGoal = "";
let camXg = 0;
let camYg = 0;
const pendingCelebrations: LogEventView[] = [];

interface Mob {
  readonly agent: AgentView;
  x: number;
  y: number;
  px: number;
  py: number;
  timer: number;
  frame: number;
  home: Village | undefined;
  /** Where this villager is headed on an errand, if anywhere. */
  target: readonly [number, number] | null;
  /** A speech bubble while chatting with a neighbor. */
  bubble: { text: string; until: number } | null;
  /** Indoors until this time (they went home for a bit). */
  hiddenUntil: number;
}

interface Player {
  x: number;
  y: number;
  px: number;
  py: number;
  dx: number;
  dy: number;
  moving: boolean;
  frame: number;
}

let snapshot: Snapshot | null = null;
let map: WorldMap | null = null;
let mobs: Mob[] = [];
let allEvents: LogEventView[] = [];
const questsDone = new Set<string>();
const player: Player = { x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 1, moving: false, frame: 0 };

/** Vertical layer the hero stands on: 0 ちじょう, +1 こうか/おくじょう, -1 ちかどう.
 * Purely presentation — like walking, it moves no world state. */
let layerZ: 0 | 1 | -1 = 0;
const ELEVATED_TILES: ReadonlySet<Tile> = new Set([Tile.RailElevated, Tile.RoadElevated, Tile.TowerTop]);
let subwayCells: ReadonlySet<number> = new Set();
const held = new Set<string>();
const SPEED = 3.2; // px per frame at 60fps-ish

function heroAgent(): AgentView | null {
  if (!snapshot?.me.agentId) return null;
  return snapshot.agents.find((a) => a.id === snapshot?.me.agentId) ?? null;
}

function myItems(): ItemView[] {
  const id = snapshot?.me.agentId;
  return id ? snapshot?.items.filter((i) => i.owner === id) ?? [] : [];
}

function occupied(x: number, y: number): boolean {
  return mobs.some((m) => m.x === x && m.y === y && performance.now() >= m.hiddenUntil);
}

function walkable(x: number, y: number): boolean {
  // People pass THROUGH each other (narrow lanes must never jam) — DQ crowds,
  // not DQ collisions. occupied() is kept only for spawn placement.
  return !!map && !isSolid(map, x, y);
}

/** The hero's layer-aware step rule; NPCs always use ground rules (walkable). */
function heroWalkable(x: number, y: number): boolean {
  if (!map) return false;
  if (layerZ === 1) return ELEVATED_TILES.has(tileAt(map, x, y));
  if (layerZ === -1) return subwayCells.has(y * MAP_W + x);
  return walkable(x, y);
}

async function refreshWorld(repositionHero: boolean): Promise<void> {
  const snap = await fetchWorld();
  snapshot = snap;
  map = buildMap(snap);
  {
    const cells = new Set<number>();
    for (const line of map.subways) for (const [cx, cy] of line) cells.add(cy * MAP_W + cx);
    for (const v of map.villages) {
      if (!v.station) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.add((v.station[1] + dy) * MAP_W + (v.station[0] + dx));
    }
    subwayCells = cells;
    if (layerZ === 1 && !ELEVATED_TILES.has(tileAt(map, player.x, player.y))) layerZ = 0;
    if (layerZ === -1 && !subwayCells.has(player.y * MAP_W + player.x)) layerZ = 0;
  }
  mobs = placeNpcs(snap, map).map((p) => ({
    agent: p.agent,
    x: p.x,
    y: p.y,
    px: p.x * CELL,
    py: p.y * CELL,
    timer: 500 + Math.random() * 2000,
    frame: 0,
    home: map?.villages.find((v) => v.regionId === p.agent.region),
    target: null,
    bubble: null,
    hiddenUntil: 0,
  }));
  const flowers: (readonly [number, number])[] = [];
  for (let fy = 0; fy < MAP_H; fy++) {
    for (let fx = 0; fx < MAP_W; fx++) {
      if (tileAt(map, fx, fy) === Tile.Flower) flowers.push([fx * CELL + 16, fy * CELL + 8] as const);
    }
  }
  wildlife.seedButterflies(flowers);
  // Development leaps make the front page — and start a festival.
  for (const v of map.villages) {
    const prev = prevTiers.get(v.regionId);
    if (prev !== undefined && v.tier > prev) {
      const rank = v.tier >= 2 ? "とし" : "まち";
      extraExtra(`ごうがい! ${v.displayName}が 「${rank}」に はってん!`);
      festivals.set(v.regionId, performance.now() + 120_000);
      particles.firework((v.x + v.w / 2) * CELL, (v.y + v.h / 2) * CELL);
    }
    prevTiers.set(v.regionId, v.tier);
  }
  // Construction: population growth turns into visible building work.
  for (const v of map.villages) {
    const residents = snap.agents.filter((a) => a.region === v.regionId && a.role !== "treasury").length;
    const prev = prevResidents.get(v.regionId);
    if (prev !== undefined && residents > prev) construction.set(v.regionId, performance.now() + 180_000);
    prevResidents.set(v.regionId, residents);
  }

  // Sister cities: a NEW mutual friendship makes the front page, twice over.
  const pairsNow = new Set(friendlyPairs(snap.regions).map(([a2, b2]) => `${a2}|${b2}`));
  for (const pair of pairsNow) {
    if (!prevFriendships.has(pair) && prevFriendships.size > 0) {
      const [aId, bId] = pair.split("|");
      const va = map.villages.find((v) => v.regionId === aId);
      const vb = map.villages.find((v) => v.regionId === bId);
      extraExtra(`ごうがい! ${va?.displayName ?? aId}と ${vb?.displayName ?? bId}が ゆうこうとしに!`);
      if (va) particles.firework((va.x + va.w / 2) * CELL, (va.y + va.h / 2) * CELL);
      if (vb) particles.firework((vb.x + vb.w / 2) * CELL, (vb.y + vb.h / 2) * CELL);
    }
  }
  prevFriendships = pairsNow;

  // Tourists visit cities and parties (the travel industry at work).
  tourists = [];
  for (const v of map.villages) {
    if (!(v.tier >= 2 || v.station || festivals.has(v.regionId))) continue;
    for (let i = 0; i < 2; i++) {
      const spot = v.spots[Math.floor(Math.random() * v.spots.length)];
      if (spot) tourists.push({ x: spot[0], y: spot[1], px: spot[0] * CELL, py: spot[1] * CELL, timer: Math.random() * 1500, home: v });
    }
  }

  // Wild critters, seeded per biome out in the open country.
  critters = [];
  for (let tries = 0; critters.length < 54 && tries < 900; tries++) {
    const cx = 4 + Math.floor(Math.random() * (MAP_W - 8));
    const cy = 4 + Math.floor(Math.random() * (MAP_H - 8));
    if (isSolid(map, cx, cy) || map.villages.some((v) => villageContains(v, cx, cy))) continue;
    const biome = biomeAt(cx, cy);
    const kind =
      biome === Biome.Desert ? "scorpion" : biome === Biome.Snow ? "yukidaruma" : biome === Biome.Swamp ? "obake" : Math.random() < 0.5 ? "slime" : "usagi";
    critters.push({ kind, x: cx, y: cy, px: cx * CELL, py: cy * CELL, timer: Math.random() * 2000 });
  }
  rebuildTicker();
  if (repositionHero || isSolid(map, player.x, player.y)) {
    const [sx, sy] = heroSpawn(snap, map);
    player.x = sx;
    player.y = sy;
    player.px = sx * CELL;
    player.py = sy * CELL;
    player.moving = false;
  }
}

function questContext(): QuestContext | null {
  if (!snapshot) return null;
  return { stats: heroStats(allEvents, snapshot.me.heroName), snapshot, hero: heroAgent() };
}

/** Pull any log events we have not seen; narrate them; return whether anything arrived. */
async function syncEvents(announce: boolean): Promise<boolean> {
  const fresh = (await fetchAllLog(allEvents.length)).filter((e) => e.seq >= allEvents.length);
  if (fresh.length === 0) return false;
  allEvents.push(...fresh);
  if (announce) {
    for (const event of fresh) {
      log.push(`▶ ${eventToMessage(event)}`);
      pendingCelebrations.push(event);
    }
  }
  return true;
}

function pick(payload: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    let v: unknown = payload;
    for (const key of path.split(".")) v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
    if (typeof v === "string") return v;
  }
  return null;
}

function villageCenterPx(regionId: string | null): readonly [number, number] | null {
  const v = regionId ? map?.villages.find((x) => x.regionId === regionId) : null;
  return v ? ([(v.x + v.w / 2) * CELL, (v.y + v.h / 2) * CELL] as const) : null;
}

function regionOfAgent(agentId: string | null): string | null {
  return agentId ? (snapshot?.agents.find((a) => a.id === agentId)?.region ?? agentId.split("@")[1] ?? null) : null;
}

/** Stage each fresh world event: fireworks for foundings, sparkles for the rest. */
function celebrate(): void {
  const now = performance.now();
  for (const e of pendingCelebrations.splice(0)) {
    const p = e.payload;
    switch (e.type) {
      case "region.founded": {
        const at = villageCenterPx(pick(p, "region.id"));
        if (at) particles.firework(at[0], at[1]);
        extraExtra(eventToMessage(e));
        break;
      }
      case "economy.settled": {
        const entries = (p["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
        const at = villageCenterPx(regionOfAgent(entries[0]?.agentId ?? null));
        if (at) particles.sparkle(at[0], at[1], "#ffd75e");
        // A big gift straight into a treasury throws a festival (きふ culture).
        const gift = entries.find((x) => x.agentId?.startsWith("treasury@") && (x.currencyDelta ?? 0) >= 50);
        const giver = entries.find((x) => (x.currencyDelta ?? 0) < 0 && !x.agentId?.startsWith("treasury@"));
        if (gift?.agentId && giver) {
          const rid2 = gift.agentId.split("@")[1] ?? "";
          const v2 = map?.villages.find((x) => x.regionId === rid2);
          festivals.set(rid2, now + 120_000);
          extraExtra(`ごうがい! ${v2?.displayName ?? rid2}に おおきな きふ! むらは おまつりだ!`);
        }
        break;
      }
      case "agent.vouched": {
        const at = villageCenterPx(regionOfAgent(pick(p, "to")));
        if (at) particles.sparkle(at[0], at[1], "#ff9de2");
        const from = pick(p, "from");
        const to = pick(p, "to");
        if (from && to) {
          const couple = weddingBook.vouch(from, to);
          if (couple) {
            extraExtra(`ごうがい! ${couple[0]}と ${couple[1]}が けっこんした!`);
            if (at) particles.firework(at[0], at[1]);
            // The village throws a ceremony: couple to the hall, guests gather.
            const va = map?.villages.find((v) => v.regionId === (couple[0].split("@")[1] ?? ""));
            if (va) {
              wedding = { a: couple[0], b: couple[1], village: va, until: performance.now() + 14_000 };
              const [hx, hy] = va.hall;
              for (const m of mobs) {
                if (m.agent.id === couple[0]) m.target = [hx - 1, hy + 1];
                else if (m.agent.id === couple[1]) m.target = [hx + 1, hy + 1];
                else if (m.home?.regionId === va.regionId && Math.random() < 0.8) {
                  m.target = [hx - 3 + Math.floor(Math.random() * 7), hy + 2 + Math.floor(Math.random() * 3)];
                  m.hiddenUntil = 0;
                  m.bubble = { text: Math.random() < 0.5 ? "おめでとう!" : "おしあわせに!", until: performance.now() + 6000 };
                }
              }
            }
          }
        }
        break;
      }
      case "item.minted":
      case "item.transferred": {
        const at = villageCenterPx(regionOfAgent(pick(p, "owner", "to")));
        if (at) particles.sparkle(at[0], at[1], "#6ad2ff");
        break;
      }
      case "agent.admitted":
      case "agent.migrated": {
        const rid = pick(p, "admission.region", "toRegion");
        if (e.type === "agent.migrated" && rid === AFTERLIFE) {
          // A quiet passing: a somber banner and a single low bell.
          banner = { text: eventToMessage(e), until: now + 4200 };
          se("cancel");
          break;
        }
        const at = villageCenterPx(rid);
        if (at) particles.sparkle(at[0], at[1], "#a5ff8a");
        banner = { text: eventToMessage(e), until: now + 3200 };
        // A population milestone throws a festival for the whole village.
        if (e.type === "agent.admitted" && rid) {
          const residents = snapshot?.agents.filter((a) => a.region === rid && a.role !== "treasury").length ?? 0;
          if (residents > 0 && residents % 5 === 0) {
            const v = map?.villages.find((x) => x.regionId === rid);
            festivals.set(rid, now + 120_000);
            extraExtra(`ごうがい! ${v?.displayName ?? rid}は じゅうみん${residents}にん! むらは おまつりだ!`);
          }
        }
        break;
      }
      case "region.ownership.transferred": {
        const at = villageCenterPx(pick(p, "regionId"));
        if (at) particles.firework(at[0], at[1]);
        extraExtra(eventToMessage(e));
        break;
      }
      case "region.institution.changed": {
        const at = villageCenterPx(pick(p, "regionId"));
        const isConstitution = ((p as Record<string, unknown>)["change"] as Record<string, unknown> | undefined)?.["policy"] === "governance";
        if (at && isConstitution) particles.firework(at[0], at[1]);
        else if (at) particles.sparkle(at[0], at[1], "#8fd0ff");
        if (isConstitution) extraExtra(eventToMessage(e));
        else banner = { text: eventToMessage(e), until: now + 3200 };
        break;
      }
      case "gov.proposal.opened":
      case "gov.vote.cast": {
        const at = villageCenterPx(pick(p, "regionId"));
        if (at) particles.sparkle(at[0], at[1], "#8fd0ff");
        banner = { text: eventToMessage(e), until: now + 3200 };
        break;
      }
    }
  }
}

/** The かわらばん: real headlines that scroll along the top of the screen. */
function rebuildTicker(): void {
  if (!snapshot) return;
  const folk = snapshot.agents.filter((a) => a.role !== "treasury" && !isDead(a.region));
  const richest = [...folk].sort((a, b) => b.balances.currency - a.balances.currency)[0];
  const trusted = [...folk].sort((a, b) => b.trust - a.trust)[0];
  const newest = snapshot.regions[snapshot.regions.length - 1];
  const items = [
    ...allEvents.slice(-4).map((e) => eventToMessage(e)),
    richest ? `ちょうじゃ: ${richest.id} (${richest.balances.currency}G)` : "",
    trusted && trusted.trust > 0 ? `しんらいNo.1: ${trusted.id} (しんらい${trusted.trust})` : "",
    newest ? `さいしんのむら: ${newest.displayName}` : "",
    genomeHeadlines.length > 0 ? `【しんか】${genomeHeadlines[snapshot.logLength % genomeHeadlines.length] ?? ""}` : "",
    `むら${snapshot.regions.filter((r) => r.id !== AFTERLIFE).length} / じゅうみん${folk.length}にん / けっこん${weddingBook.marriages}くみ / できごと${snapshot.logLength}`,
  ].filter((t) => t.length > 0);
  tickerText = items.join("  ◆  ");
}

// Headlines the genome daemon wrote — sprinkled into the かわらばん rotation.
let genomeHeadlines: readonly string[] = [];
/** Genome professions by romaji name — the LLM-born trades, looked up per NPC. */
let genomeProfs: ReadonlyMap<string, { craft: string; greeting: string }> = new Map();

function genomeProfOf(agentId: string): { craft: string; greeting: string } | null {
  return genomeProfs.get((agentId.split("@")[0] ?? "").replace(/\d+$/, "")) ?? null;
}

let title = "かけだしの たびびと";

/** Recompute quest completion; on `announce`, celebrate anything newly achieved. */
function checkQuests(announce: boolean): void {
  const ctx = questContext();
  if (!ctx) return;
  title = heroTitle(ctx);
  for (const { quest, done } of questProgress(ctx)) {
    if (!done || questsDone.has(quest.id)) continue;
    questsDone.add(quest.id);
    if (announce) {
      log.push(`★ クエストたっせい! 「${quest.title}」`);
      se("fanfare");
    }
  }
  if (announce && questsDone.size === questProgress(ctx).length) {
    log.push("すべての クエストを なしとげた! あなたこそ でんせつの ゆうしゃだ!");
  }
  const undone = questProgress(ctx).find((q) => !q.done);
  nextGoal = undone ? `つぎ: ${undone.quest.title} — ${undone.quest.desc}` : "でんせつ かんせい!";
  rebuildTicker();
}

// ---- actions -------------------------------------------------------------

async function runAct(action: Record<string, unknown>, doing: string): Promise<void> {
  ui.clear();
  log.push(`${doing}…`);
  try {
    const result = await postAct(action);
    if (result.ok) {
      se("coin");
      await syncEvents(true);
      await refreshWorld(false);
      checkQuests(true);
      celebrate();
    } else {
      se("error");
      log.push(`だめだった… (${result.reason})`);
    }
  } catch (error) {
    log.push(error instanceof Error ? error.message : "なにかが おかしい…");
  }
}

/** みのうえばなし: one resident's whole life, folded honestly from the log. */
function biographyOf(agentId: string): string[] {
  let paid = 0;
  let got = 0;
  let trades = 0;
  let vouchOut = 0;
  let vouchIn = 0;
  let minted = 0;
  let sickness = 0;
  let bornSeq: number | null = null;
  const moves: string[] = [];
  for (const e of allEvents) {
    const p = e.payload;
    if (e.type === "agent.admitted") {
      const id = (p["admission"] as Record<string, unknown> | undefined)?.["id"] ?? p["id"];
      if (id === agentId) bornSeq = e.seq;
    } else if (e.type === "agent.migrated") {
      if (p["agentId"] === agentId && typeof p["toRegion"] === "string") moves.push(p["toRegion"] as string);
    } else if (e.type === "economy.settled") {
      const entries = (p["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
      const mine = entries.find((x) => x.agentId === agentId);
      if (mine && typeof mine.currencyDelta === "number" && mine.currencyDelta !== 0) {
        trades++;
        if (mine.currencyDelta > 0) got += mine.currencyDelta;
        else paid -= mine.currencyDelta;
      }
    } else if (e.type === "agent.vouched") {
      if (p["from"] === agentId) vouchOut++;
      if (p["to"] === agentId) vouchIn++;
    } else if (e.type === "item.minted") {
      if (p["owner"] === agentId) {
        if (p["kind"] === BYOKI) sickness++;
        else minted++;
      }
    }
  }
  const name = agentId.split("@")[0] ?? agentId;
  const lines: string[] = [];
  lines.push(bornSeq !== null ? `だい${bornSeq}のできごとで この せかいに やってきた。` : "いつからか この せかいに いる ふるつわものだ。");
  if (moves.length > 0) lines.push(`これまで ${moves.length}かい ひっこした (いまは ${moves[moves.length - 1]})。`);
  else lines.push("うまれた むらから いちども でたことがない。");
  if (trades > 0) lines.push(`とりひき ${trades}かい — かせぎ ${got}G / つかい ${paid}G ${got > paid * 2 ? "(なかなかの やりて)" : paid > got * 2 ? "(きまえが よすぎる…)" : ""}`);
  else lines.push("まだ いちども しょうばいを したことがない。");
  if (vouchOut + vouchIn > 0) lines.push(`しんらいを ${vouchOut}かい おくり、${vouchIn}かい うけとった。${vouchOut > vouchIn * 3 && vouchOut >= 3 ? "…かたおもいが おおいらしい。" : vouchIn > vouchOut * 3 && vouchIn >= 3 ? "みんなの にんきものだ。" : ""}`);
  if (minted > 0) lines.push(`つくった どうぐは ${minted}こ。しょくにんの てだ。`);
  if (sickness > 0) lines.push(`びょうきを ${sickness}かい のりこえた。`);
  const spouse = weddingBook.isMarried(agentId);
  if (spouse) lines.push(`はんりょが いる。しあわせそうだ。`);
  lines.push(`— ${name}の みのうえばなし、これにて。`);
  return lines;
}

/** The ware this villager wishes for — deterministic, so the bot side can pay
 * a fair thanks for ANY delivered good without needing to agree on the wish. */
function wantOf(agent: AgentView): Ware | null {
  if (agent.role !== "merchant" && agent.role !== "broker") return null;
  if (agent.balances.currency < 15) return null;
  const wares = allWares();
  if (wares.length === 0) return null;
  let h = 0;
  for (let i = 0; i < agent.id.length; i++) h = (Math.imul(h, 31) + agent.id.charCodeAt(i)) | 0;
  return wares[Math.abs(h) % wares.length] ?? null;
}

/** たいまつ: a lit torch pushes back the night around the hero for a while. */
let torchUntil = 0;

/** A wedding in progress: the couple and guests gather at the town hall. */
let wedding: { a: string; b: string; village: Village; until: number } | null = null;

const OMIKUJI = ["だいきち! きょうは しんらいが めぐる ひ。", "きち。とりひきに よき ひ。", "ちゅうきち。たびに でるが よい。", "しょうきち。ちいさな しんせつが かえってくる。", "すえきち。あわてず こつこつ。", "きょう…は きにせず わらって すごせ。"];

function useItem(item: ItemView): void {
  if (item.kind === "torch") {
    torchUntil = performance.now() + 180_000;
    log.push("たいまつに ひを ともした! しばらく よみちが あかるい。");
    se("confirm");
    ui.clear();
  } else if (item.kind === "tsubo") {
    let h = 0;
    for (let i = 0; i < item.id.length; i++) h = (Math.imul(h, 31) + item.id.charCodeAt(i)) | 0;
    ui.push(new Info("つぼうらない", ["つぼに みみを あてると こえが きこえた…", `「${OMIKUJI[Math.abs(h) % OMIKUJI.length]}」`], () => ui.clear()));
  } else if (item.kind === "herb") {
    ui.push(new Info("やくそう", ["いま つかうほど つかれていない。", "びょうきの ひとに 「おみまい」で とどけると よろこばれる。"], () => ui.clear()));
  } else {
    ui.push(new Info(kindName(item.kind), [`${kindName(item.kind)}を ためつすがめつ ながめた。`, "いい しなものだ。だれかに おくっても よろこばれそうだ。"], () => ui.clear()));
  }
}

function npcMenu(mob: Mob): void {
  const a = mob.agent;
  const items = myItems();
  ui.push(
    new Menu(
      a.id,
      [
        { label: "はなす", value: "talk" },
        { label: "みのうえを きく", value: "bio" },
        { label: "ゴールドを わたす", value: "gold" },
        { label: "ほしょうする", value: "vouch" },
        { label: "こくはくする", value: "propose", disabled: weddingBook.isMarried(a.id) || !!(snapshot?.me.agentId && weddingBook.isMarried(snapshot.me.agentId)) },
        { label: "ほしいものを きく", value: "want" },
        { label: "おみまいする (やくそう)", value: "care", disabled: !snapshot?.items.some((i) => i.owner === a.id && i.kind === BYOKI) || !myItems().some((i) => i.kind === "herb") },
        { label: "でしいりする (10G)", value: "apprentice", disabled: !genomeProfOf(a.id) },
        { label: "どうぐを わたす", value: "item", disabled: items.length === 0 },
        { label: "やめる", value: "cancel" },
      ],
      (value) => {
        if (value === "talk") {
          const owner = snapshot?.regions.find((r) => r.id === a.region)?.owner ?? null;
          ui.push(
            new Info(a.id, [
              ...(genomeProfOf(a.id) ? [`「${genomeProfOf(a.id)?.greeting ?? ""}」`] : []),
              ...npcLines(
                a,
                snapshot?.items ?? [],
                owner,
                map?.villages.find((v) => v.regionId === a.region)?.biome ?? Biome.Plains,
                (snapshot?.logLength ?? 500) - (a.admittedAtSeq ?? 0),
                isChildName(a.id),
                {
                  powered: map?.villages.find((v) => v.regionId === a.region)?.powered,
                  tier: map?.villages.find((v) => v.regionId === a.region)?.tier,
                  married: weddingBook.isMarried(a.id),
                  festival: festivals.has(a.region),
                },
              ),
              "",
              `しょくぎょう: ${genomeProfOf(a.id) ? `${kindName(genomeProfOf(a.id)?.craft ?? "")}づくりの ${roleJa(a.role)} ★しんかのたみ` : roleJa(a.role)}`,
              `しょじきん: ${a.balances.currency}G  くれじっと: ${a.balances.credit}`,
              `ひょうばん: ${a.reputation}  しんらい: ${a.trust}`,
              `すんでいるむら: ${a.region}`,
            ], () => ui.pop()),
          );
        } else if (value === "bio") {
          ui.push(new Info(`${a.id}の みのうえ`, biographyOf(a.id), () => ui.pop()));
        } else if (value === "propose") {
          ui.push(
            new Menu(`${a.id.split("@")[0]}に おもいを つたえる? (さいだいの ほしょうを おくる)`, [
              { label: "つたえる", value: "yes" },
              { label: "やっぱり やめる", value: "cancel" },
            ], (v) => {
              if (v === "yes") {
                void runAct({ kind: "vouch", to: a.id, weight: 5 }, "おもいを つたえる").then(() => {
                  log.push(`${a.id.split("@")[0]}に おもいを つたえた… へんじは あいての こころ しだいだ。`);
                });
              }
              ui.clear();
            }, () => ui.clear()),
          );
        } else if (value === "want") {
          const want = wantOf(a);
          ui.push(new Info(a.id, want
            ? [
                `「${want.name}が ほしいなあ。」`,
                "「もってきてくれたら おれいを はずむよ。」",
                "(どうぐを わたすと、あいてが めをさましたとき だいきん+おれいを はらってくれる)",
              ]
            : ["「いまは とくに ほしいものは ないなあ。」"], () => ui.pop()));
        } else if (value === "care") {
          const herb = myItems().find((i) => i.kind === "herb");
          if (herb) {
            void runAct({ kind: "transferItem", itemId: herb.id, to: a.id }, "おみまいを とどける").then(() => {
              log.push(`${a.id.split("@")[0]}に やくそうを とどけた。はやく よくなりますように…`);
            });
          }
        } else if (value === "apprentice") {
          const prof = genomeProfOf(a.id);
          if (prof) {
            const j = journal();
            if (j.learned.includes(prof.craft)) {
              ui.push(new Info(a.id, [`「${kindName(prof.craft)}の わざは もう おしえたよ。」`, "「あとは かずを こなすことだ。」"], () => ui.pop()));
            } else {
              void runAct({ kind: "transfer", to: a.id, amount: 10 }, "じゅぎょうりょうを はらう").then(() => {
                const j2 = journal();
                if (!j2.learned.includes(prof.craft)) {
                  j2.learned.push(prof.craft);
                  saveJournal(j2);
                }
                extraExtra(`でしいり! ${kindName(prof.craft)}づくりを ならった!`);
                log.push("コマンドの「ものづくり」で じぶんでも つくれるようになった。");
              });
            }
          }
        } else if (value === "gold") {
          ui.push(
            new TextInput(`いくら わたす? (もちがね ${heroAgent()?.balances.currency ?? 0}G)`, { numeric: true, maxLen: 7 }, (v) => {
              void runAct({ kind: "transfer", to: a.id, amount: Number(v) }, `${a.id}に ${v}G わたす`);
            }, () => ui.pop()),
          );
        } else if (value === "vouch") {
          ui.push(
            new Menu(
              "どのくらい しんじる?",
              [1, 2, 3, 4, 5].map((w) => ({ label: `おもみ ${w}`, value: String(w) })),
              (w) => void runAct({ kind: "vouch", to: a.id, weight: Number(w) }, `${a.id}を ほしょうする`),
              () => ui.pop(),
            ),
          );
        } else if (value === "item") {
          ui.push(
            new Menu(
              "どの どうぐを わたす?",
              items.map((i) => ({ label: `${kindName(i.kind)} (${i.id})`, value: i.id })),
              (itemId) => void runAct({ kind: "transferItem", itemId, to: a.id }, `どうぐを わたす`),
              () => ui.pop(),
            ),
          );
        } else ui.clear();
      },
      () => ui.clear(),
    ),
  );
}

interface VillageContext {
  readonly region: NonNullable<Snapshot["regions"][number]>;
  readonly isOwner: boolean;
  readonly livesHere: boolean;
  readonly isCouncil: boolean;
  readonly mintingOpen: boolean;
}

function villageContext(village: Village): VillageContext | null {
  const region = snapshot?.regions.find((r) => r.id === village.regionId);
  if (!region || !snapshot) return null;
  const hero = heroAgent();
  return {
    region,
    isOwner: region.owner === snapshot.me.heroName,
    livesHere: hero?.region === region.id,
    isCouncil: region.institutions.governance.kind === "council",
    mintingOpen: region.institutions.itemPolicy.minting === "anyone",
  };
}

function villageInfo(ctx: VillageContext): void {
  const { region } = ctx;
  const residents = snapshot?.agents.filter((a) => a.region === region.id && a.role !== "treasury") ?? [];
  const treasury = snapshot?.agents.find((a) => a.id === `treasury@${region.id}`);
  ui.push(
    new Info(`むら「${region.displayName}」(${region.id})`, [
      `あるじ: ${region.owner ?? "なし"}  じょうたい: ${region.lifecycle === "active" ? "うんえいちゅう" : "きゅうそん"}${region.salePrice !== null ? `  ★うりだしちゅう ${region.salePrice}G` : ""}`,
      (() => {
        const v = map?.villages.find((x) => x.regionId === region.id);
        return `きこう: ${BIOME_JA[v?.biome ?? Biome.Plains]}  はってん: ${["むら", "まち", "とし", "だいとし"][v?.tier ?? 0]}  でんき: ${v?.powered ? "つうでん" : "みでんか"}`;
      })(),
      (() => {
        const v = map?.villages.find((x) => x.regionId === region.id);
        const host = v?.parent ? map?.villages.find((o) => o.regionId === v.parent) : null;
        const bloc = prefectures(
          snapshot?.regions.filter((r) => r.id !== AFTERLIFE) ?? [],
          (id) => map?.villages.find((o) => o.regionId === id)?.tier ?? 0,
        ).find((bl) => bl.members.includes(region.id));
        return `しちょうそん: ${region.displayName}${municipalRank(v?.tier ?? 0)}${host ? ` — ${host.displayName}${municipalRank(host.tier)}の ちく` : ""}${bloc ? `  しょぞく: ${bloc.name}` : ""}`;
      })(),
      `せいじ: ${REGIME_JA[classifyRegime(region.institutions.governance as GovernanceValue)].label}`,
      `どうぐづくり: ${ctx.mintingOpen ? "だれでも" : "あるじのみ"}`,
      `ぜいりつ: ${region.institutions.economyPolicy.baseCostRate} (さいてい ${region.institutions.economyPolicy.minCostRate})`,
      `きんこ: ${treasury?.balances.currency ?? 0}G  じゅうみん: ${residents.length}にん`,
      ...residents.map((r) => `  ${r.id} (${roleJa(r.role)}) ${r.balances.currency}G`),
      region.openProposal ? `ひょうけつちゅう! とうひょう ${region.openProposal.votes.length}` : "ひょうけつは ない",
      (() => {
        const owner = region.owner;
        const group = owner ? (snapshot?.regions ?? []).filter((r) => r.owner === owner && r.id !== AFTERLIFE) : [];
        return group.length > 1 ? `けいれつ: ${owner}グループ (${group.map((g) => g.displayName).join("・")})` : "どくりつけいえい";
      })(),
      (() => {
        const friends = friendlyPairs(snapshot?.regions ?? [])
          .filter(([a, b]) => a === region.id || b === region.id)
          .map(([a, b]) => (a === region.id ? b : a));
        return friends.length > 0 ? `ゆうこうとし: ${friends.join(", ")}` : "ゆうこうとしは まだ ない";
      })(),
    ], () => ui.pop()),
  );
}

/** しさつ — study a foreign village's institutions and take lessons home. */
function inspectVillage(ctx2: VillageContext): void {
  const { region } = ctx2;
  const homeId = snapshot?.me.agentId?.split("@")[1];
  const home = snapshot?.regions.find((r) => r.id === homeId);
  const theirTax = region.institutions.economyPolicy.baseCostRate;
  const theirRegime = REGIME_JA[classifyRegime(region.institutions.governance as GovernanceValue)].label;
  const residents = snapshot?.agents.filter((a) => a.region === region.id && a.role !== "treasury") ?? [];
  const treasury = snapshot?.agents.find((a) => a.id === `treasury@${region.id}`)?.balances.currency ?? 0;
  const lessons: string[] = [
    `せいじ: ${theirRegime} / ぜいりつ: ${Math.round(theirTax * 100)}%`,
    `じゅうみん ${residents.length}にん / きんこ ${treasury}G / どうぐづくり: ${ctx2.mintingOpen ? "だれでも" : "あるじのみ"}`,
  ];
  if (home) {
    const myTax = home.institutions.economyPolicy.baseCostRate;
    if (theirTax < myTax) lessons.push(`【まなび】ぜいが わがまちより やすい。こうえきを よぶ ちえか…`);
    else if (theirTax > myTax) lessons.push(`【まなび】ぜいは たかいが、きんこは ${treasury}G。ふくしに つかえそうだ`);
    if (ctx2.mintingOpen) lessons.push("【まなび】ちゅうぞうを ひらくと ものづくりが さかんに なるようだ");
    if (ctx2.isCouncil) lessons.push("【まなび】ひょうぎの しくみは ごうい に じかんが かかるが あんてい する");
  }
  const j = journal();
  if (!j.visited.includes(region.id)) {
    j.visited.push(region.id);
    saveJournal(j);
    lessons.push(`★ しさつメモに きろくした (${j.visited.length}むらめ)`);
    se("fanfare");
  }
  ui.push(new Info(`しさつレポート: ${region.displayName}`, lessons, () => ui.pop()));
}

/** Pick a constitution: every regime the raw governance primitive can express. */
function regimePicker(regionId: string, mode: "amend" | "propose"): void {
  const current = snapshot?.regions.find((r) => r.id === regionId);
  const now = current ? classifyRegime(current.institutions.governance as GovernanceValue) : "dictatorship";
  ui.push(
    new Menu(mode === "amend" ? "けんぽうを さだめる" : "けんぽうかいせいを ていあんする", [
      ...REGIMES.filter((r) => r !== now).map((r) => ({ label: `${REGIME_JA[r].label} — ${REGIME_JA[r].desc}`, value: r })),
      { label: "やめる", value: "cancel" },
    ], (regime) => {
      if (regime === "cancel") return ui.clear();
      const kind = mode === "amend" ? "amendGovernance" : "proposeGovernance";
      void runAct({ kind, regionId, regime }, "けんぽうを かえる");
    }, () => ui.pop()),
  );
}

/** 役場 — residency and the shape of power. */
/** むらの きろく と いれいひ: the village's history and its dead, from the log.
 * The dead are those whose agent id was born here (name@region) and whose last
 * road led to the afterlife. Every count is folded from real events. */
function memorialLines(regionId: string, displayName: string): string[] {
  const dead: { id: string; seq: number }[] = [];
  const trades = new Map<string, number>();
  const vouchedIn = new Map<string, number>();
  for (const e of allEvents) {
    const p = e.payload;
    if (e.type === "agent.migrated" && p["toRegion"] === AFTERLIFE) {
      const id = typeof p["agentId"] === "string" ? p["agentId"] : "";
      if (id.endsWith(`@${regionId}`)) dead.push({ id, seq: e.seq });
    } else if (e.type === "economy.settled") {
      for (const en of (p["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? []) {
        if (en.agentId && (en.currencyDelta ?? 0) !== 0 && !en.agentId.startsWith("treasury@")) {
          trades.set(en.agentId, (trades.get(en.agentId) ?? 0) + 1);
        }
      }
    } else if (e.type === "agent.vouched") {
      if (typeof p["to"] === "string") vouchedIn.set(p["to"] as string, (vouchedIn.get(p["to"] as string) ?? 0) + 1);
    }
  }
  const region = snapshot?.regions.find((r) => r.id === regionId);
  const v = map?.villages.find((x) => x.regionId === regionId);
  const pop = snapshot?.agents.filter((a2) => a2.region === regionId && a2.role !== "treasury").length ?? 0;
  const lines: string[] = [
    `だい${region?.foundedAtSeq ?? 0}のできごとで たんじょう。ひらいたのは ${region?.owner ?? "なぞのひと"}。`,
    `いまは ${displayName}${municipalRank(v?.tier ?? 0)} — じんこう ${pop}にん。`,
    "",
  ];
  if (dead.length === 0) {
    lines.push("いれいひは まだ まっさらだ。", "だれも しんでいない、へいわな むらである。");
    return lines;
  }
  const EPITAPHS = [
    "よく はたらき よく わらった",
    "しんらいに いきた ひとだった",
    "たびと しょうばいを あいした",
    "しずかな くらしを まもった",
    "みなに めぐみを わけた",
    "さいごまで ゆめを おった",
  ];
  lines.push(`― いれいひ ― てんに めされた ${dead.length}めい:`);
  for (const d of dead.sort((p1, p2) => p2.seq - p1.seq).slice(0, 8)) {
    const name = d.id.split("@")[0] ?? d.id;
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
    const t = trades.get(d.id) ?? 0;
    const vc = vouchedIn.get(d.id) ?? 0;
    lines.push(` ☆ ${name} (とりひき${t}・しんらい${vc}) 「${EPITAPHS[Math.abs(h) % EPITAPHS.length]}」`);
  }
  if (dead.length > 8) lines.push(` …ほか ${dead.length - 8}めいの なが きざまれている。`);
  return lines;
}

function hallMenu(village: Village): void {
  const ctx = villageContext(village);
  if (!ctx) return;
  const { region } = ctx;
  ui.push(
    new Menu(`${region.displayName} やくば`, [
      { label: "むらの じょうほう", value: "info" },
      { label: "むらの きろく (いれいひ)", value: "memorial" },
      { label: region.salePrice !== null ? `この むらを かいとる (${region.salePrice}G)` : "かいとる (うりに でていない)", value: "buy", disabled: region.salePrice === null || ctx.isOwner || !heroAgent() },
      { label: "むらづくりに きふする", value: "donate", disabled: heroAgent()?.region !== region.id },
      { label: "ふどうさん (うる・ゆずる・たたむ)", value: "estate", disabled: !ctx.isOwner },
      { label: ctx.isCouncil ? "ぜいせい (さいばんしょで ていあん)" : "ぜいせいを あらためる", value: "tax", disabled: !ctx.isOwner || ctx.isCouncil },
      { label: "しさつする (まなび)", value: "inspect", disabled: ctx.livesHere },
      { label: "この むらに ひっこす", value: "migrate", disabled: !heroAgent() || ctx.livesHere },
      { label: "いじゅうしゃを まねく", value: "admit", disabled: !ctx.isOwner },
      {
        label: ctx.isCouncil ? "けんぽう (さいばんしょで ていあん)" : "けんぽうを さだめる",
        value: "governance",
        disabled: !ctx.isOwner || ctx.isCouncil,
      },
      {
        label: ctx.isCouncil ? "がいこう (ていあん)" : "がいこう",
        value: "diplomacy",
        disabled: ctx.isCouncil ? !ctx.livesHere : !ctx.isOwner,
      },
      { label: "やめる", value: "cancel" },
    ], (value) => {
      if (value === "donate") {
        const treasury = snapshot?.agents.find((a2) => a2.id === `treasury@${region.id}`)?.balances.currency ?? 0;
        const v = map?.villages.find((x) => x.regionId === region.id);
        const tier = v?.tier ?? 0;
        const nextGold = tier === 0 ? 25 : tier === 1 ? 80 : tier === 2 ? 200 : null;
        ui.push(
          new Menu(
            `きんこ ${treasury}G ${nextGold !== null ? `— あと${Math.max(0, nextGold - treasury)}Gで ${municipalRank(tier + 1)}` : "— さいこうの はってんだ"}`,
            [
              { label: "10G きふする", value: "10" },
              { label: "25G きふする", value: "25" },
              { label: "50G きふする (おまつりつき)", value: "50" },
              { label: "100G きふする (おまつりつき)", value: "100" },
              { label: "やめる", value: "cancel" },
            ],
            (v2) => {
              if (v2 !== "cancel") {
                void runAct({ kind: "transfer", to: `treasury@${region.id}`, amount: Number(v2) }, `${region.displayName}に きふする`).then(() => {
                  log.push("きふが きんこに おさめられた。むらの みらいが ちかづく…");
                });
              } else ui.clear();
            },
            () => ui.clear(),
          ),
        );
      } else if (value === "buy") {
        const ownerAgent = snapshot?.agents.find((a2) => region.owner && a2.id.startsWith(`${region.owner}@`) && a2.role !== "treasury");
        const price = region.salePrice ?? 0;
        if (!ownerAgent) {
          ui.push(new Info("ふどうさんや", ["あるじの うけとりぐちが みつからない。", "この とりひきは いまは できない。"], () => ui.pop()));
          return;
        }
        ui.push(
          new Menu(`${region.displayName}を ${price}Gで かいとる? (だいきんは あるじ ${ownerAgent.id}へ)`, [
            { label: `はらう (${price}G)`, value: "pay" },
            { label: "やめる", value: "cancel" },
          ], (v) => {
            if (v === "pay") {
              void runAct({ kind: "buyRegion", regionId: region.id, ownerAgent: ownerAgent.id, price }, `${region.displayName}の かいとり`).then(() => {
                log.push("だいきんを はらったなら、あるじが てつづきを すませば むらは あなたのもの。しばし またれよ…");
              });
            }
            ui.clear();
          }, () => ui.clear()),
        );
      } else if (value === "estate") {
        ui.push(
          new Menu(`${region.displayName} — ふどうさん`, [
            { label: region.salePrice !== null ? `うりね を かえる (いま ${region.salePrice}G)` : "うりにだす (ねだんを つける)", value: "list" },
            { label: "うりやめ", value: "delist", disabled: region.salePrice === null },
            { label: "ゆずりわたす (ただで)", value: "handover" },
            { label: region.lifecycle === "active" ? "むらを たたむ (きゅうそん)" : "むらを ひらきなおす", value: "lifecycle" },
            { label: "やめる", value: "cancel" },
          ], (v) => {
            if (v === "list") {
              ui.push(new TextInput("いくらで うる? (G)", { numeric: true, maxLen: 6 }, (t) => {
                const price = Number(t);
                if (Number.isInteger(price) && price > 0) void runAct({ kind: "listRegion", regionId: region.id, price }, "うりにだす");
                ui.clear();
              }, () => ui.clear()));
            } else if (v === "delist") {
              void runAct({ kind: "listRegion", regionId: region.id, price: null }, "うりやめ");
              ui.clear();
            } else if (v === "handover") {
              ui.push(new TextInput("だれに ゆずる? (romaji めいぎ)", { maxLen: 24 }, (to) => {
                ui.push(new Menu(`ほんとうに ${region.displayName}を ${to}に ゆずる? もどせないぞ。`, [
                  { label: "ゆずる", value: "yes" },
                  { label: "やめる", value: "cancel" },
                ], (v2) => {
                  if (v2 === "yes") void runAct({ kind: "handoverRegion", regionId: region.id, to }, `${to}に ゆずる`);
                  ui.clear();
                }, () => ui.clear()));
              }, () => ui.clear()));
            } else if (v === "lifecycle") {
              void runAct({ kind: "lifecycleRegion", regionId: region.id, lifecycle: region.lifecycle === "active" ? "dormant" : "active" }, "むらの とじひらき");
              ui.clear();
            } else ui.clear();
          }, () => ui.clear()),
        );
      } else if (value === "tax") {
        ui.push(
          new Menu(`ぜいせい (いま ${Math.round(region.institutions.economyPolicy.baseCostRate * 100)}%)`, [
            { label: "げんぜい 5%", value: "0.05" },
            { label: "ちゅうよう 10%", value: "0.1" },
            { label: "ひょうじゅん 20%", value: "0.2" },
            { label: "じゅうぜい 30%", value: "0.3" },
            { label: "やめる", value: "cancel" },
          ], (v) => {
            if (v !== "cancel") void runAct({ kind: "amendEconomy", regionId: region.id, baseCostRate: Number(v) }, "ぜいせいの あらため");
            ui.clear();
          }, () => ui.clear()),
        );
      } else if (value === "memorial") {
        ui.push(new Info(`${region.displayName} — むらの きろく`, memorialLines(region.id, region.displayName), () => ui.pop()));
      } else if (value === "info") villageInfo(ctx);
      else if (value === "inspect") inspectVillage(ctx);
      else if (value === "migrate") void runAct({ kind: "migrate", toRegion: region.id }, `${region.id}へ ひっこす`);
      else if (value === "admit") {
        ui.push(
          new TextInput("だれを まねく? (なまえ: romaji)", { maxLen: 16 }, (agentName) => {
            ui.push(
              new Menu("しょくぎょうは?", [
                { label: "しょくにん (artisan)", value: "artisan" },
                { label: "しょうにん (merchant)", value: "merchant" },
                { label: "なかがいにん (broker)", value: "broker" },
              ], (role) => void runAct({ kind: "admit", agentName, region: region.id, role, currency: 50 }, `${agentName}を まねく`), () => ui.pop()),
            );
          }, () => ui.pop()),
        );
      } else if (value === "diplomacy") {
        diplomacyMenu(ctx);
      } else if (value === "governance") {
        regimePicker(region.id, "amend");
      } else ui.clear();
    }, () => ui.clear()),
  );
}

/** 造幣局 — items and the rule of who may make them. */
function mintMenu(village: Village): void {
  const ctx = villageContext(village);
  if (!ctx) return;
  const { region } = ctx;
  const treasury = snapshot?.agents.find((a) => a.id === `treasury@${region.id}`);
  ui.push(
    new Menu(`${region.displayName} ぞうへいきょく`, [
      { label: "どうぐを つくる", value: "mint", disabled: !(ctx.isOwner || (ctx.mintingOpen && ctx.livesHere)) },
      {
        label: `どうぐづくりのおきて: ${ctx.mintingOpen ? "だれでも→あるじのみ" : "あるじのみ→だれでも"}`,
        value: "amend",
        disabled: !ctx.isOwner || ctx.isCouncil,
      },
      { label: "きんこを のぞく", value: "treasury" },
      { label: "やめる", value: "cancel" },
    ], (value) => {
      if (value === "mint") {
        ui.push(
          new TextInput("なにを つくる? (romaji: sword, tsubo…)", { lowercase: true, maxLen: 16 }, (kind) => {
            const owner = snapshot?.me.agentId;
            if (owner) void runAct({ kind: "mintItem", itemKind: kind, owner }, `「${kind}」を つくる`);
          }, () => ui.pop()),
        );
      } else if (value === "amend") {
        void runAct({ kind: "amendMinting", regionId: region.id, minting: ctx.mintingOpen ? "owner" : "anyone" }, "どうぐづくりの おきてを かえる");
      } else if (value === "treasury") {
        ui.push(new Info("きんこ", [`むらの きんこには ${treasury?.balances.currency ?? 0}G はいっている。`, "てすうりょうが ここに つみあがる。"], () => ui.pop()));
      } else ui.clear();
    }, () => ui.clear()),
  );
}

/** 裁判所 — proposals, votes, and the ledger of trust. */
function courtMenu(village: Village): void {
  const ctx = villageContext(village);
  if (!ctx) return;
  const { region } = ctx;
  ui.push(
    new Menu(`${region.displayName} さいばんしょ`, [
      { label: "ひょうけつを みる", value: "proposal" },
      { label: "とうひょうする", value: "vote", disabled: !region.openProposal || !ctx.livesHere },
      { label: "おきてを ていあんする", value: "propose", disabled: !ctx.isCouncil || !ctx.livesHere || !!region.openProposal },
      { label: "ろっぽうぜんしょ (ほうたいけい)", value: "lawbook" },
      { label: "しんらいの だいちょう", value: "trust" },
      { label: "やめる", value: "cancel" },
    ], (value) => {
      if (value === "proposal") {
        ui.push(
          new Info("ひょうけつ", region.openProposal
            ? [
                `ぎだい: 【${lawLayer(String((region.openProposal.change as Record<string, unknown> | undefined)?.["policy"] ?? ""))}】${lawText(region.openProposal.change)}`,
                `ていあんしゃ: ${region.openProposal.proposedBy}`,
                `とうひょう: ${region.openProposal.votes.length}`,
                ...region.openProposal.votes.map((v) => `  ${v}`),
              ]
            : ["いま ひょうけつは ひらかれていない。", ctx.isCouncil ? "「おきてを ていあんする」で はじめられる。" : "この むらは どくさいせい — あるじが きめる。"], () => ui.pop()),
        );
      } else if (value === "vote") {
        void runAct({ kind: "vote", regionId: region.id }, "とうひょうする");
      } else if (value === "propose") {
        ui.push(
          new Menu("なにを ていあんする?", [
            { label: `どうぐづくり: ${ctx.mintingOpen ? "あるじのみに もどす" : "だれでもに ひらく"}`, value: "minting" },
            { label: "けんぽうかいせい (せいじたいせい)", value: "governance" },
            { label: "ぜいせいかいせい", value: "tax" },
          ], (v) => {
            if (v === "minting") {
              void runAct({ kind: "proposeMinting", regionId: region.id, minting: ctx.mintingOpen ? "owner" : "anyone" }, "おきてを ていあんする");
            } else if (v === "tax") {
              ui.push(
                new Menu(`ぜいせいかいせい (いま ${Math.round(region.institutions.economyPolicy.baseCostRate * 100)}%)`, [
                  { label: "げんぜい 5%", value: "0.05" },
                  { label: "ちゅうよう 10%", value: "0.1" },
                  { label: "ひょうじゅん 20%", value: "0.2" },
                  { label: "じゅうぜい 30%", value: "0.3" },
                  { label: "やめる", value: "cancel" },
                ], (v2) => {
                  if (v2 !== "cancel") void runAct({ kind: "proposeEconomy", regionId: region.id, baseCostRate: Number(v2) }, "ぜいせいかいせいを ていあん");
                  ui.clear();
                }, () => ui.clear()),
              );
            } else {
              regimePicker(region.id, "propose");
            }
          }, () => ui.pop()),
        );
      } else if (value === "lawbook") {
        const v = map?.villages.find((x) => x.regionId === region.id);
        const host = v?.parent ? snapshot?.regions.find((r) => r.id === v.parent) : null;
        const lines = [
          `【けんぽう】 せいじたいせい: ${REGIME_JA[classifyRegime(region.institutions.governance as GovernanceValue)].label}`,
          `【ほうりつ】 ちゅうぞうほう: ${region.institutions.itemPolicy.minting === "anyone" ? "だれでも" : region.institutions.itemPolicy.minting === "residents" ? "じゅうみんのみ" : "あるじのみ"}`,
          `【ほうりつ】 ぜいせい: てすうりょう ${Math.round(region.institutions.economyPolicy.baseCostRate * 100)}%`,
          `【じょうれい】 がいこう: ${STANCE_JA[region.institutions.diplomacyPolicy.defaultStance]} (こべつのとりきめ ${Object.keys(region.institutions.diplomacyPolicy.overrides).length}けん)`,
          ...(host
            ? [
                `── じょういほう: ${host.displayName}${municipalRank(map?.villages.find((o) => o.regionId === host.id)?.tier ?? 0)}の ほう ──`,
                `【けんぽう】 ${REGIME_JA[classifyRegime(host.institutions.governance as GovernanceValue)].label}`,
                `【ほうりつ】 ちゅうぞう ${host.institutions.itemPolicy.minting} / ぜい ${Math.round(host.institutions.economyPolicy.baseCostRate * 100)}%`,
              ]
            : []),
          "けんぽう > ほうりつ > じょうれい の じゅんに つよい。",
        ];
        ui.push(new Info("ろっぽうぜんしょ", lines, () => ui.pop()));
      } else if (value === "trust") {
        const residents = snapshot?.agents.filter((a) => a.region === region.id && a.role !== "treasury") ?? [];
        ui.push(
          new Info("しんらいの だいちょう", residents.length
            ? residents.map((r) => `${r.id}: しんらい ${r.trust} / ひょうばん ${r.reputation}`)
            : ["まだ だれも すんでいない。"], () => ui.pop()),
        );
      } else ui.clear();
    }, () => ui.clear()),
  );
}

/** 道具屋 — real gold into the treasury, a real item minted under the village's rule. */
function shopMenu(village: Village): void {
  const ctx2 = villageContext(village);
  if (!ctx2 || !snapshot) return;
  const { region } = ctx2;
  const gate = canShopHere(region, snapshot);
  if (!gate.ok) {
    ui.push(new Info(`${region.displayName}の どうぐや`, ["「いらっしゃい… といいたいところだが。」", gate.reason, `(どうぐづくりのおきて: ${region.institutions.itemPolicy.minting})`], () => ui.pop()));
    return;
  }
  const gold = heroAgent()?.balances.currency ?? 0;
  const sale = festivals.has(region.id);
  const vTier = map?.villages.find((v) => v.regionId === region.id)?.tier ?? 0;
  const priceOf = (base: number): number => (sale ? Math.max(1, Math.ceil(base * 0.8)) : base);
  // Infrastructure decides the stock: fine goods only reach developed towns.
  const stocked = (w2: (typeof CATALOG)[number]): boolean => (w2.price >= 80 ? vTier >= 2 : w2.price >= 30 ? vTier >= 1 : true);
  ui.push(
    new Menu(`${region.displayName}の どうぐや ${sale ? "★まつりセール★" : ""}(もちがね ${gold}G)`, [
      ...allWares().map((w) => ({
        label: stocked(w) ? `${w.name}  ${priceOf(w.price)}G${sale ? ` (もと${w.price}G)` : ""}` : `${w.name}  — にゅうかは まちいこう`,
        value: w.kind,
        disabled: !stocked(w) || gold < priceOf(w.price),
      })),
      { label: "やめる", value: "cancel" },
    ], (kind) => {
      if (kind === "cancel") return ui.clear();
      const ware = allWares().find((w) => w.kind === kind);
      if (!ware) return ui.clear();
      ui.push(
        new Menu(`${ware.name} — ${ware.blurb} ${priceOf(ware.price)}Gで かう?`, [
          { label: "かう", value: "yes" },
          { label: "やめる", value: "no" },
        ], (v) => {
          if (v === "yes") void runAct({ kind: "buyItem", regionId: region.id, ware: ware.kind, price: priceOf(ware.price) }, `${ware.name}を かう`);
          else ui.pop();
        }, () => ui.pop()),
      );
    }, () => ui.clear()),
  );
}

/** 外交 — set this village's stance toward another (roads appear when both sides warm). */
function diplomacyMenu(ctx2: VillageContext): void {
  const { region } = ctx2;
  const others = (snapshot?.regions ?? []).filter((r) => r.id !== region.id);
  if (others.length === 0) return;
  ui.push(
    new Menu("どの むらへの たいどを かえる?",
      others.map((r) => ({ label: `${r.displayName} (いま: ${STANCE_JA[stanceToward(region, r.id)]})`, value: r.id })),
      (target) => {
        ui.push(
          new Menu(`${target}への たいどは?`, [
            { label: "うけいれ (absorb) — みちが つながる", value: "absorb" },
            { label: "しんこう (map)  — みちが つながる", value: "map" },
            { label: "ようすみ (reexamine)", value: "reexamine" },
            { label: "こばみ (reject)", value: "reject" },
          ], (stance) => {
            const kind = ctx2.isCouncil ? "proposeDiplomacy" : "amendDiplomacy";
            void runAct({ kind, regionId: region.id, target, stance }, `がいこうを かえる`);
          }, () => ui.pop()),
        );
      }, () => ui.pop()),
  );
}

const JUNK_KINDS = new Set(["kuzutetsu", "nisegane", "garakuta"]);

/** けいじばん — town notices, including the wanted poster earned by real crimes. */
/** いらいのふだ: what the world is asking of you RIGHT NOW, derived live. */
/** けんちく: mint a coordinate-deed item — the map builds it for everyone. */
const BUILD_COSTS: Readonly<Record<string, { label: string; fee: number }>> = {
  house: { label: "いえ (2x2)", fee: 15 },
  shop: { label: "みせ (やたい)", fee: 10 },
  garden: { label: "はなばたけ (2x2)", fee: 3 },
  tree: { label: "き (うえる)", fee: 2 },
  tower: { label: "とう (4かいだて)", fee: 40 },
};
const BUILDABLE_TILES: ReadonlySet<Tile> = new Set([Tile.Grass, Tile.Grass2, Tile.Flower, Tile.Sand, Tile.Snow, Tile.Swamp, Tile.Path]);

function buildMenu(): void {
  if (!map || !snapshot) return;
  const me = heroAgent();
  if (!me) {
    ui.push(new Info("けんちく", ["まずは どこかの むらに すもう。", "「むらを たてる」か やくばで ひっこしを。"], () => ui.pop()));
    return;
  }
  const fx = player.x + player.dx;
  const fy = player.y + player.dy;
  const hostVillage = map.villages.find((v) => villageContains(v, fx, fy));
  if (hostVillage && hostVillage.regionId !== me.region && snapshot.regions.find((r) => r.id === hostVillage.regionId)?.owner !== snapshot.me.heroName) {
    ui.push(new Info("けんちく", ["ここは よその むらの とちだ。", "じぶんの むらか、あれのに たてよう。"], () => ui.pop()));
    return;
  }
  if (!BUILDABLE_TILES.has(tileAt(map, fx, fy))) {
    ui.push(new Info("けんちく", ["めのまえの じめんには たてられない。", "くさちや すなちに むかって たてよう。"], () => ui.pop()));
    return;
  }
  const gold = me.balances.currency;
  ui.push(
    new Menu(`めのまえ (${fx},${fy})に なにを たてる? (もちがね ${gold}G)`, [
      ...Object.entries(BUILD_COSTS).map(([k, v]) => ({ label: `${v.label} — ${v.fee}G`, value: k, disabled: gold < v.fee })),
      { label: "やめる", value: "cancel" },
    ], (k) => {
      const cost = BUILD_COSTS[k];
      if (!cost) return ui.clear();
      void runAct({ kind: "build", structure: k, x: fx, y: fy, fee: cost.fee }, `${cost.label}を たてる`).then(() => {
        extraExtra("けんちく かんりょう! せかいの ちずに きざまれた!");
      });
    }, () => ui.clear()),
  );
}

function requestBoard(): string[] {
  if (!snapshot) return ["よみこみちゅう…"];
  const lines: string[] = [];
  const hero = heroAgent();

  const sick = snapshot.items
    .filter((i) => i.kind === BYOKI)
    .map((i) => snapshot?.agents.find((a2) => a2.id === i.owner))
    .filter((a2): a2 is AgentView => !!a2 && !isDead(a2.region))
    .slice(0, 3);
  for (const a2 of sick) lines.push(`◆ ${a2.id}が びょうきだ。やくそうで おみまいを (おれいあり)`);

  for (const r of snapshot.regions) {
    if (r.openProposal) lines.push(`◆ ${r.displayName}で ひょうけつちゅう:【${lawLayer(String((r.openProposal.change as Record<string, unknown> | undefined)?.["policy"] ?? ""))}】${lawText(r.openProposal.change)}`);
  }

  for (const r of snapshot.regions) {
    if (r.salePrice !== null && r.owner !== snapshot.me.heroName) lines.push(`◆ ${r.displayName}が ${r.salePrice}Gで うりだしちゅう — やくばで かいとれる`);
  }

  if (hero) {
    const inbound = new Set<string>();
    const answered = new Set<string>();
    for (const e of allEvents) {
      if (e.type !== "agent.vouched") continue;
      if (e.payload["to"] === hero.id && typeof e.payload["from"] === "string") inbound.add(e.payload["from"] as string);
      if (e.payload["from"] === hero.id && typeof e.payload["to"] === "string") answered.add(e.payload["to"] as string);
    }
    for (const from of [...inbound].filter((f) => !answered.has(f)).slice(0, 3)) {
      lines.push(`◆ ${from}から しんらいが とどいている。こたえて あげよう?`);
    }
  }

  const wishers = [...snapshot.agents]
    .filter((a2) => (a2.role === "merchant" || a2.role === "broker") && !isDead(a2.region))
    .sort((p1, p2) => p2.balances.currency - p1.balances.currency)
    .slice(0, 3);
  for (const a2 of wishers) {
    const want = wantOf(a2);
    if (want) lines.push(`◆ ${a2.id}が ${want.name}を さがしている (とどければ だいきん+おれい)`);
  }

  for (const v of map?.villages ?? []) {
    if (v.tier >= 1 && !v.powered) lines.push(`◆ ${v.displayName}は まだ みでんか。きんこが そだてば はつでんしょが たつ`);
  }

  if (hero) {
    const myRegion = snapshot.regions.find((r) => r.id === hero.region);
    const treasury = snapshot.agents.find((a2) => a2.id === `treasury@${hero.region}`)?.balances.currency ?? 0;
    const residents = snapshot.agents.filter((a2) => a2.region === hero.region && a2.role !== "treasury").length;
    const tier = map?.villages.find((v) => v.regionId === hero.region)?.tier ?? 0;
    const nextGold = tier === 0 ? 25 : tier === 1 ? 80 : tier === 2 ? 200 : null;
    if (myRegion && nextGold !== null && treasury < nextGold) {
      lines.push(`◆ ${myRegion.displayName}の きんこは ${treasury}G。あと${nextGold - treasury}Gの きふで ${municipalRank(tier + 1)}に はってんする!`);
    }
    void residents;
  }

  return lines.length > 0 ? lines.slice(0, 14) : ["いまは とくに いらいは ない。へいわだ。"];
}

function posterMenu(village: Village): void {
  let junk = 0;
  let borrowed = 0;
  let repaid = 0;
  let wantedName: string | null = null;
  for (const e of allEvents) {
    const p = e.payload;
    if (e.type === "item.minted") {
      const owner = typeof p["owner"] === "string" ? (p["owner"] as string) : "";
      const kind = typeof p["kind"] === "string" ? (p["kind"] as string) : "";
      if (owner.startsWith("Kuro@") && JUNK_KINDS.has(kind)) {
        junk++;
        wantedName = "Kuro";
      }
    } else if (e.type === "economy.settled") {
      const entries = (p["entries"] as { agentId?: string; currencyDelta?: number }[] | undefined) ?? [];
      const bank = entries.find((x) => x.agentId?.startsWith("Ginko@"));
      const kuro = entries.find((x) => x.agentId?.startsWith("Kuro@"));
      if (bank && kuro && typeof bank.currencyDelta === "number") {
        if (bank.currencyDelta < 0) borrowed += -bank.currencyDelta;
        else repaid += bank.currencyDelta;
      }
    }
  }
  const debt = borrowed - repaid;
  if (!wantedName && debt <= 0) {
    ui.push(new Info("けいじばん", ["「へいわな ひびが つづいて います」", "「おちましもの は やくばへ」"], () => ui.pop()));
    return;
  }
  const kuroAgent = snapshot?.agents.find((a) => a.id.startsWith("Kuro@"));
  ui.push(
    new Info("しめいてはい", [
      "★ テハイ ★  Kuro",
      `つみ: がらくたの らんぞう (${junk}けん)`,
      debt > 0 ? `つみ: ぎんこうへの ふみたおし (${debt}G)` : "ぎんこうへの かりは かえした もよう",
      kuroAgent ? `もくげきじょうほう: ${kuroAgent.region} ちほう` : "ゆくえ ふめい",
      "みつけたら むらの おきてを しめる べし。",
    ], () => ui.pop()),
  );
}

/** びょういん — the house of healing: real fees, real recovery. */
function hospitalMenu(village: Village): void {
  const life = foldLife(allEvents);
  const myByoki = myItems().find((i) => i.kind === BYOKI);
  // Electrified hospitals treat you cheaper — infrastructure you can feel.
  const fee = village.powered ? 3 : 5;
  const entries = [
    { label: myByoki ? `てあてを うける (${fee}G${village.powered ? "・でんきで おとく" : ""})` : "てあてを うける (けんこうだ)", value: "cure", disabled: !myByoki },
    { label: "むらの けんこうきろく", value: "stats" },
    { label: "やめる", value: "cancel" },
  ];
  ui.push(
    new Menu(`${village.displayName} びょういん`, entries, (value) => {
      if (value === "cure" && myByoki) {
        void (async () => {
          ui.clear();
          log.push("てあてを うけている…");
          const paid = await postAct({ kind: "transfer", to: `treasury@${village.regionId}`, amount: fee });
          if (!paid.ok) {
            se("error");
            log.push(`はらえなかった… (${paid.reason})`);
            return;
          }
          const cured = await postAct({ kind: "transferItem", itemId: myByoki.id, to: `treasury@${village.regionId}` });
          if (cured.ok) {
            se("fanfare");
            log.push("びょうきが なおった! からだが かるい!");
          } else {
            log.push(`てあてに しっぱいした… (${cured.reason})`);
          }
          await refreshWorld(false);
          await syncEvents(true);
          checkQuests(true);
          celebrate();
        })();
      } else if (value === "stats") {
        ui.push(new Info("けんこうきろく", [
          `これまでの びょうき: ${life.sick}けん`,
          `うまれた いのち: ${life.births}にん`,
          `てんに めされた いのち: ${life.deaths}にん`,
          `むすばれた ふうふ: ${life.book.marriages}くみ`,
        ], () => ui.pop()));
      } else ui.clear();
    }, () => ui.clear()),
  );
}

/** くうこう — fly between metropolises (presentation-level travel, like the train). */
function airportMenu(village: Village): void {
  const destinations = (map?.villages ?? []).filter((v) => v.airport && v.regionId !== village.regionId);
  if (destinations.length === 0) {
    ui.push(new Info(`${village.displayName}くうこう`, ["かっそうろは あるが、ゆきさきが まだ ない。", "べつの まちが「だいとし」に そだてば ろせんが ひらく。"], () => ui.pop()));
    return;
  }
  ui.push(
    new Menu(`${village.displayName}くうこう — どこへ とぶ?`, [
      ...destinations.map((v) => ({ label: `${v.displayName} (${BIOME_JA[v.biome]})`, value: v.regionId })),
      { label: "やめる", value: "cancel" },
    ], (rid) => {
      if (rid === "cancel") return ui.clear();
      const dest = map?.villages.find((v) => v.regionId === rid);
      if (dest) {
        layerZ = 0;
        player.x = dest.gate[0];
        player.y = dest.gate[1] + 1;
        player.px = player.x * CELL;
        player.py = player.y * CELL;
        se("fanfare");
        log.push(`ひこうきで ${dest.displayName}へ ひとっとび!`);
        const j = journal();
        j.rides++;
        saveJournal(j);
      }
      ui.clear();
    }, () => ui.clear()),
  );
}

/** 駅 — ride the train between cities (movement is presentation; no world state moves). */
function stationMenu(village: Village): void {
  const destinations = (map?.villages ?? []).filter((v) => v.station && v.regionId !== village.regionId);
  if (destinations.length === 0) {
    ui.push(new Info(`${village.displayName}えき`, ["れっしゃは あるが、まだ ゆきさきが ない。", "べつの まちが「とし」に そだてば せんろが つながる。"], () => ui.pop()));
    return;
  }
  ui.push(
    new Menu(`${village.displayName}えき — どこへ いく?`, [
      ...destinations.map((v) => ({ label: `${v.displayName} (${BIOME_JA[v.biome]})`, value: v.regionId })),
      { label: "ちかつうろに おりる", value: "subway" },
      { label: "やめる", value: "cancel" },
    ], (rid) => {
      if (rid === "cancel") return ui.clear();
      if (rid === "subway") {
        const st = village.station;
        if (st) {
          layerZ = -1;
          player.x = st[0];
          player.y = st[1];
          player.px = st[0] * CELL;
          player.py = st[1] * CELL;
          se("confirm");
          log.push("ちかつうろに おりた。せんろぞいに となりまちまで あるける。");
        }
        return ui.clear();
      }
      const dest = map?.villages.find((v) => v.regionId === rid);
      if (dest) {
        layerZ = 0;
        player.x = dest.gate[0];
        player.y = dest.gate[1] + 1;
        player.px = player.x * CELL;
        player.py = player.y * CELL;
        se("coin");
        log.push(`でんしゃに のって ${dest.displayName}へ ついた!`);
        const j = journal();
        j.rides++;
        saveJournal(j);
      }
      ui.clear();
    }, () => ui.clear()),
  );
}

/** The gate signboard is now just the village's public notice. */
function signMenu(village: Village): void {
  const ctx = villageContext(village);
  if (ctx) villageInfo(ctx);
}

function questJournal(): void {
  const ctx = questContext();
  if (!ctx) return;
  const rows = questProgress(ctx).map(({ quest, done }) => `${done ? "★" : "・"} ${quest.title} — ${quest.desc}`);
  const doneCount = rows.filter((r) => r.startsWith("★")).length;
  const j = journal();
  rows.push("", `たびのきろく: しさつ ${j.visited.length}むら / いきもの ${j.critters.length}しゅ / でんしゃ ${j.rides}かい`);
  ui.push(new Info(`クエストちょう (${doneCount}/${rows.length - 2})`, rows, () => ui.pop()));
}

function worldRecords(): void {
  const m = snapshot;
  if (!m) return;
  const folk = m.agents.filter((a) => a.role !== "treasury" && !isDead(a.region));
  const byGold = [...folk].sort((a, b) => b.balances.currency - a.balances.currency).slice(0, 3);
  const byTrust = [...folk].sort((a, b) => b.trust - a.trust).slice(0, 3);
  const byPeople = [...m.regions]
    .map((r) => ({ r, n: folk.filter((a) => a.region === r.id).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  ui.push(
    new Info("せかいの きろく", [
      `むら ${m.regions.length} / じゅうみん ${folk.length}にん / どうぐ ${m.items.length}こ / できごと ${m.logLength}`,
      "～ちょうじゃばんづけ~",
      ...byGold.map((a, i) => ` ${i + 1}. ${a.id}  ${a.balances.currency}G`),
      "～しんらいばんづけ~",
      ...byTrust.map((a, i) => ` ${i + 1}. ${a.id}  しんらい${a.trust}`),
      "～にぎわうむら~",
      ...byPeople.map(({ r, n }, i) => ` ${i + 1}. ${r.displayName} (${r.id})  ${n}にん`),
    ], () => ui.pop()),
  );
}

function fieldMenu(): void {
  const hero = heroAgent();
  ui.push(
    new Menu(
      "コマンド?",
      [
        { label: "つよさ", value: "status" },
        { label: "クエスト", value: "quests" },
        { label: "いらいのふだ (いま できること)", value: "requests" },
        { label: "どうぐ", value: "items" },
        { label: "ものづくり (ならったわざ)", value: "craft" },
        { label: "けんちく (めのまえに たてる)", value: "build" },
        { label: "こどもを むかえる", value: "child" },
        { label: "ちず (M)", value: "map" },
        { label: "むらを たてる", value: "found" },
        { label: "せかいの きろく", value: "world" },
        { label: "せかいのログ (L)", value: "rawlog" },
        { label: `おと: ${bgmEnabled() ? "ON" : "OFF"}`, value: "sound" },
        { label: "やめる", value: "cancel" },
      ],
      (value) => {
        if (value === "status") {
          ui.push(
            new Info(snapshot?.me.heroName ?? "たびびと", hero
              ? [
                  `しょうごう: ${title}`,
                  `エージェント: ${hero.id}`,
                  `しょじきん: ${hero.balances.currency}G  くれじっと: ${hero.balances.credit}`,
                  `ひょうばん: ${hero.reputation}  しんらい: ${hero.trust}`,
                  `すんでいるむら: ${hero.region}`,
                  (() => {
                    const partner = weddingBook.partnerOf(hero.id);
                    return partner ? `はんりょ: ${partner.split("@")[0]}` : "どくしん";
                  })(),
                  `ならったわざ: ${journal().learned.map((k) => kindName(k)).join("・") || "まだ ない"}`,
                ]
              : ["まだ どこにも すんでいない。", "「むらを たてる」で じぶんのむらを つくろう!"], () => ui.pop()),
          );
        } else if (value === "items") {
          const items = myItems();
          if (items.length === 0) {
            ui.push(new Info("どうぐぶくろ", ["なにも もっていない。"], () => ui.pop()));
          } else {
            ui.push(
              new Menu("どうぐぶくろ — つかう?", [
                ...items.map((i) => ({ label: kindName(i.kind), value: i.id })),
                { label: "とじる", value: "cancel" },
              ], (itemId) => {
                if (itemId === "cancel") return ui.clear();
                const item = items.find((i) => i.id === itemId);
                if (!item) return ui.clear();
                useItem(item);
              }, () => ui.clear()),
            );
          }
        } else if (value === "craft") {
          const learned = journal().learned;
          if (learned.length === 0) {
            ui.push(new Info("ものづくり", ["まだ わざを ならっていない。", "★じるしの しんかのたみに 「でしいり」して わざを ならおう。"], () => ui.pop()));
          } else {
            ui.push(
              new Menu("なにを つくる? (むらの おきてに したがう)", [
                ...learned.map((k) => ({ label: `${kindName(k)}を つくる`, value: k })),
                { label: "やめる", value: "cancel" },
              ], (k) => {
                if (k !== "cancel") void runAct({ kind: "forage", itemKind: k }, `${kindName(k)}づくり`);
                else ui.clear();
              }, () => ui.clear()),
            );
          }
        } else if (value === "build") {
          buildMenu();
        } else if (value === "child") {
          const me = heroAgent();
          const married = me ? weddingBook.isMarried(me.id) : false;
          const myVillage = snapshot?.regions.find((r) => r.owner === snapshot?.me.heroName && r.id !== AFTERLIFE);
          if (!me || !married) {
            ui.push(new Info("こどもを むかえる", ["まずは はんりょが ひつようだ。", "きになる ひとに 「こくはく」して、おもいが かよえば ふうふに なれる。"], () => ui.pop()));
          } else if (!myVillage) {
            ui.push(new Info("こどもを むかえる", ["こどもを むかえるには じぶんの むらが いる。", "「むらを たてる」か、むらを かいとろう。"], () => ui.pop()));
          } else {
            const pick2 = CHILD_NAMES[Math.floor(Math.random() * CHILD_NAMES.length)] ?? "Kotaro";
            const suffix = (snapshot?.agents ?? []).filter((a2) => (a2.id.split("@")[0] ?? "").replace(/\d+$/, "") === pick2).length;
            const childName = suffix > 0 ? `${pick2}${suffix + 1}` : pick2;
            ui.push(
              new Menu(`${myVillage.displayName}に あかちゃんを むかえる? (なまえ: ${childName})`, [
                { label: "むかえる", value: "yes" },
                { label: "やめる", value: "cancel" },
              ], (v) => {
                if (v === "yes") {
                  void runAct({ kind: "admit", agentName: childName, region: myVillage.id, role: "artisan", currency: 10 }, "こどもを むかえる").then(() => {
                    extraExtra(`${myVillage.displayName}に あかちゃんが うまれた! なまえは ${childName}!`);
                  });
                }
                ui.clear();
              }, () => ui.clear()),
            );
          }
        } else if (value === "requests") {
          ui.push(new Info("いらいのふだ — いま せかいが もとめていること", requestBoard(), () => ui.pop()));
        } else if (value === "quests") {
          questJournal();
        } else if (value === "map") {
          ui.pop();
          ui.push(new MapOverlay(() => ui.clear()));
        } else if (value === "sound") {
          const on = toggleBgm();
          log.push(on ? "♪ おんがくが ながれはじめた。" : "おんがくが やんだ。");
          ui.clear();
        } else if (value === "found") {
          ui.push(
            new TextInput("むらの なまえは? (romaji こもじ)", { lowercase: true, maxLen: 16 }, (rid) => {
              ui.push(
                new TextInput("かんばんに かく なまえは?", { maxLen: 20 }, (display) => {
                  void runAct({ kind: "found", regionId: rid, displayName: display }, `むら「${rid}」を たてる`);
                }, () => ui.pop()),
              );
            }, () => ui.pop()),
          );
        } else if (value === "world") {
          worldRecords();
        } else if (value === "rawlog") {
          ui.pop();
          ui.push(new LogViewer());
        } else ui.clear();
      },
      () => ui.clear(),
    ),
  );
}

function interact(): void {
  if (!map || !snapshot) return;
  const fx = player.x + player.dx;
  const fy = player.y + player.dy;
  if (layerZ === 1) {
    // From up here the only interaction is coming down where the ground is open.
    const below = tileAt(map, fx, fy);
    if (!ELEVATED_TILES.has(below) && !isSolid(map, fx, fy)) {
      layerZ = 0;
      player.x = fx;
      player.y = fy;
      player.px = fx * CELL;
      player.py = fy * CELL;
      se("confirm");
      log.push("ちじょうに おりた。");
    } else {
      log.push("ここからは おりられない。ふちを さがそう。");
    }
    return;
  }
  if (layerZ === -1) {
    const near = map.villages.find((v) => v.station && Math.abs(v.station[0] - player.x) <= 1 && Math.abs(v.station[1] - player.y) <= 1);
    if (near?.station) {
      layerZ = 0;
      const gx = near.station[0];
      const gy = near.station[1] + 1;
      const spot: readonly [number, number] = !isSolid(map, gx, gy) ? [gx, gy] : [near.gate[0], near.gate[1] + 1];
      player.x = spot[0];
      player.y = spot[1];
      player.px = spot[0] * CELL;
      player.py = spot[1] * CELL;
      se("confirm");
      log.push(`${near.displayName}えきから ちじょうに あがった。`);
    } else {
      log.push("のぼりかいだんは えきの ちかにある。あかりを めざそう。");
    }
    return;
  }
  const mob = mobs.find((m) => m.x === fx && m.y === fy);
  if (mob) return npcMenu(mob);
  const critter = critters.find((c) => c.x === fx && c.y === fy);
  if (critter) {
    const lines: Record<string, string[]> = {
      slime: ["スライムは ぷるぷる している。", "なにか いいたげだが、ぷるぷる しか いわない。"],
      usagi: ["うさぎは みみを ぴんと たてた。", "はなを ひくひく させている。かわいい。"],
      scorpion: ["さそりだ! …こちらを みている。そっと しておこう。", "さばくの ぬしかもしれない。"],
      yukidaruma: ["ゆきだるまだ。だれが つくったのだろう…", "…いま、うごかなかったか?"],
      obake: ["ひやりと した かぜが ふいた。", "おばけは にっこり わらった。わるい こは いないか、と。"],
    };
    const j = journal();
    if (!j.critters.includes(critter.kind)) {
      j.critters.push(critter.kind);
      saveJournal(j);
    }
    ui.push(new Info("いきもの", lines[critter.kind] ?? ["なにかが いる。"], () => ui.pop()));
    return;
  }
  const tile = tileAt(map, fx, fy);
  if (tile === Tile.RailElevated || tile === Tile.RoadElevated) {
    ui.push(
      new Menu("こうかせんが あたまの うえを はしっている。", [
        { label: "はしらを のぼる", value: "up" },
        { label: "やめる", value: "cancel" },
      ], (v) => {
        if (v === "up") {
          layerZ = 1;
          player.x = fx;
          player.y = fy;
          player.px = fx * CELL;
          player.py = fy * CELL;
          se("confirm");
          log.push("こうかに のぼった! ふちで Enterを おすと おりられる。");
        }
        ui.clear();
      }, () => ui.clear()),
    );
    return;
  }
  if (tile === Tile.TowerWall || tile === Tile.TowerGlass) {
    let ty = fy;
    while (ty > 0 && (tileAt(map, fx, ty) === Tile.TowerWall || tileAt(map, fx, ty) === Tile.TowerGlass)) ty--;
    if (tileAt(map, fx, ty) === Tile.TowerTop) {
      const roofY = ty;
      ui.push(
        new Menu("ちょうこうそうビルの エレベーターだ。", [
          { label: "おくじょうへ あがる", value: "up" },
          { label: "やめる", value: "cancel" },
        ], (v) => {
          if (v === "up") {
            layerZ = 1;
            player.x = fx;
            player.y = roofY;
            player.px = fx * CELL;
            player.py = roofY * CELL;
            se("fanfare");
            log.push("おくじょうに でた! まちが いちぼうできる。");
          }
          ui.clear();
        }, () => ui.clear()),
      );
      return;
    }
  }
  if (tile === Tile.Sign) {
    const village = map.villages.find((v) => v.sign[0] === fx && v.sign[1] === fy);
    if (village) return signMenu(village);
  }
  if (tile === Tile.HallDoor) {
    const village = map.villages.find((v) => v.hall[0] === fx && v.hall[1] === fy);
    if (village) return hallMenu(village);
  }
  if (tile === Tile.MintDoor) {
    const village = map.villages.find((v) => v.mint[0] === fx && v.mint[1] === fy);
    if (village) return mintMenu(village);
  }
  if (tile === Tile.CourtDoor) {
    const village = map.villages.find((v) => v.court[0] === fx && v.court[1] === fy);
    if (village) return courtMenu(village);
  }
  if (tile === Tile.Stall) {
    const village = map.villages.find((v) => v.stall[0] === fx && v.stall[1] === fy);
    if (village) return shopMenu(village);
  }
  if (tile === Tile.Farm) {
    ui.push(
      new Menu("はたけが よく そだっている。", [
        { label: "しゅうかくする (やさい)", value: "harvest", disabled: !snapshot.me.agentId },
        { label: "やめる", value: "cancel" },
      ], (v) => {
        if (v === "harvest") void runAct({ kind: "forage", itemKind: "yasai" }, "やさいを しゅうかくする");
        else ui.clear();
      }, () => ui.clear()),
    );
    return;
  }
  if (tile === Tile.Water) {
    ui.push(
      new Menu("みずべだ。さかなの かげが みえる。", [
        { label: "つりを する", value: "fish", disabled: !snapshot.me.agentId },
        { label: "やめる", value: "cancel" },
      ], (v) => {
        if (v === "fish") void runAct({ kind: "forage", itemKind: "sakana" }, "つりを する");
        else ui.clear();
      }, () => ui.clear()),
    );
    return;
  }
  if (tile === Tile.Well) {
    ui.push(new Info("いど", ["つめたい みずを ごくり。", "…げんきが でた!"], () => ui.pop()));
    se("confirm");
    return;
  }
  if (tile === Tile.Poster) {
    const village = map.villages.find((v) => v.poster[0] === fx && v.poster[1] === fy);
    if (village) return posterMenu(village);
  }
  if (tile === Tile.HouseDoor || tile === Tile.DoorWood) {
    const village = map.villages.find((v) => villageContains(v, fx, fy));
    const homeIndex = village?.homes.findIndex(([hx2, hy2]) => hx2 === fx && hy2 === fy) ?? -1;
    if (village && homeIndex >= 0) return enterHouse(village, homeIndex);
  }
  if (tile === Tile.HospitalDoor) {
    const village = map.villages.find((v) => v.hospital && v.hospital[0] === fx && v.hospital[1] === fy);
    if (village) return hospitalMenu(village);
  }
  if (tile === Tile.Plant) {
    const village = map.villages.find((v) => v.plant && v.plant[0] === fx && v.plant[1] === fy);
    if (village && snapshot) {
      const treasury = snapshot.agents.find((a) => a.id === `treasury@${village.regionId}`)?.balances.currency ?? 0;
      const served = map.villages.filter((v) => v.powered).length;
      ui.push(new Info(`${village.displayName} はつでんしょ`, [
        `しゅつりょく: ${100 + treasury * 2}kW (きんこ ${treasury}Gで うんてん)`,
        `そうでんちゅう: ${served}まち に でんきを おくっている`,
        "「でんきは ぶんめいの ちからだ」",
      ], () => ui.pop()));
    }
    return;
  }
  if (tile === Tile.Substation) {
    const village = map.villages.find((v) => v.substation && v.substation[0] === fx && v.substation[1] === fy);
    if (village) {
      ui.push(new Info(`${village.displayName} へんでんしょ`, village.powered
        ? ["つうでんちゅう。よるには まちの まどが ともる。", "『さわるな キケン』"]
        : ["まだ でんきが きていない…", "どこかに「だいとし」の はつでんしょが できれば つながる。"], () => ui.pop()));
    }
    return;
  }
  if (tile === Tile.Airport) {
    const village = map.villages.find((v) => v.airport && v.airport[0] === fx && v.airport[1] === fy);
    if (village) return airportMenu(village);
  }
  if (tile === Tile.Station) {
    const village = map.villages.find((v) => v.station && v.station[0] === fx && v.station[1] === fy);
    if (village) return stationMenu(village);
  }
  if (tile === Tile.Chest) {
    const village = map.villages.find((v) => v.chest[0] === fx && v.chest[1] === fy);
    const treasury = snapshot.agents.find((a) => a.id === `treasury@${village?.regionId}`);
    if (village) return ui.push(new Info(`${village.displayName}の きんこ`, [`むらの きんこには ${treasury?.balances.currency ?? 0}G はいっている。`, "てをふれては いけない きがする…"], () => ui.pop()));
  }
  fieldMenu();
}

// ---- raw log viewer (the meta view: seq / type / raw payload, newest first) ----

class LogViewer {
  private top = 0;

  handleKey(keyName: string): void {
    const rows = 16;
    const max = Math.max(0, allEvents.length - rows);
    if (keyName === "ArrowDown" || keyName === "s") this.top = Math.min(this.top + 1, max);
    else if (keyName === "ArrowUp" || keyName === "w") this.top = Math.max(0, this.top - 1);
    else if (["Escape", "Enter", " ", "l", "L", "x", "z"].includes(keyName)) ui.clear();
  }

  render(c: CanvasRenderingContext2D, width: number, height: number): void {
    const w = width - 48;
    const h = height - 96;
    const x = 24;
    const y = 24;
    drawWindow(c, x, y, w, h);
    drawText(c, `せかいのログ (メタ)  ${allEvents.length}けん`, x + 24, y + 14, "#ffd75e");
    c.font = '14px "DotGothic16", monospace';
    const rows = 16;
    const newestFirst = [...allEvents].reverse();
    const page = newestFirst.slice(this.top, this.top + rows);
    page.forEach((e, i) => {
      const ry = y + 52 + i * 25;
      c.fillStyle = "#8fd0ff";
      c.fillText(`#${e.seq}`.padStart(5), x + 20, ry);
      c.fillStyle = "#ffd75e";
      c.fillText(e.type.padEnd(28), x + 70, ry);
      c.fillStyle = "#9ab";
      c.fillText(`by ${e.actor}`, x + 320, ry);
      c.fillStyle = "#ffffff";
      const payload = JSON.stringify(e.payload);
      const room = Math.floor((w - 460) / 7.2);
      c.fillText(payload.length > room ? `${payload.slice(0, room)}…` : payload, x + 420, ry);
    });
    c.fillStyle = "#9ab";
    c.fillText(`↑↓:スクロール  Esc:とじる  (${this.top + 1}〜${Math.min(this.top + rows, allEvents.length)})`, x + 20, y + h - 28);
  }
}

// ---- world map overlay ------------------------------------------------------

const MINI_COLORS: Record<number, string> = {
  [Tile.Grass]: "#1c7c2c",
  [Tile.Grass2]: "#238234",
  [Tile.Tree]: "#0d4718",
  [Tile.Water]: "#1a4fbb",
  [Tile.Sand]: "#d8c07a",
  [Tile.Fence]: "#8a5a2b",
  [Tile.Path]: "#e0cd92",
  [Tile.HouseWall]: "#cfc6a8",
  [Tile.HouseRoof]: "#b33326",
  [Tile.HouseDoor]: "#3a2a16",
  [Tile.Sign]: "#e8c840",
  [Tile.Chest]: "#c49a45",
  [Tile.HallRoof]: "#24408e",
  [Tile.HallDoor]: "#24408e",
  [Tile.MintRoof]: "#b8860b",
  [Tile.MintDoor]: "#b8860b",
  [Tile.CourtRoof]: "#e8e8e8",
  [Tile.CourtDoor]: "#e8e8e8",
  [Tile.Rock]: "#6a6a6a",
  [Tile.Flower]: "#f0a0c0",
  [Tile.Stall]: "#d9553f",
  [Tile.Snow]: "#dde8f2",
  [Tile.SnowTree]: "#a9c2d4",
  [Tile.Cactus]: "#2c8a4a",
  [Tile.Swamp]: "#4a5a30",
  [Tile.Pavement]: "#8a8a8a",
  [Tile.Rail]: "#5b4a30",
  [Tile.BuildingWall]: "#9a9aa8",
  [Tile.BuildingRoof]: "#3a3a44",
  [Tile.Station]: "#c23a2e",
  [Tile.HospitalRoof]: "#f0f0f0",
  [Tile.HospitalDoor]: "#c23a2e",
  [Tile.Airport]: "#b8c8d8",
  [Tile.Plant]: "#8890a0",
  [Tile.Substation]: "#c8b830",
  [Tile.TowerWall]: "#7a8598",
  [Tile.TowerGlass]: "#8fc0e8",
  [Tile.TowerTop]: "#aab4c0",
  [Tile.RailElevated]: "#8a7a60",
  [Tile.RoadElevated]: "#9a9aa2",
};
const MINI_SCALE = 2;
let miniCache: { forMap: WorldMap; canvas: HTMLCanvasElement } | null = null;

function miniMapCanvas(m: WorldMap): HTMLCanvasElement {
  if (miniCache?.forMap === m) return miniCache.canvas;
  const c = document.createElement("canvas");
  c.width = MAP_W * MINI_SCALE;
  c.height = MAP_H * MINI_SCALE;
  const mc = c.getContext("2d");
  if (mc) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        mc.fillStyle = MINI_COLORS[tileAt(m, x, y)] ?? "#000";
        mc.fillRect(x * MINI_SCALE, y * MINI_SCALE, MINI_SCALE, MINI_SCALE);
      }
    }
  }
  miniCache = { forMap: m, canvas: c };
  return c;
}

/** けいざいしんぶん (E key): the whole economy, folded live from the log. */
class EconomyOverlay {
  constructor(private readonly onClose: () => void) {}

  handleKey(key: string): void {
    if (["Escape", "Enter", " ", "e", "E", "x", "z"].includes(key)) this.onClose();
  }

  render(c: CanvasRenderingContext2D, width: number, height: number): void {
    if (!snapshot) return;
    const w = Math.min(920, width - 40);
    const h = Math.min(620, height - 40);
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    drawWindow(c, x, y, w, h);
    c.textBaseline = "top";
    drawText(c, "けいざいしんぶん", x + 24, y + 14, "#ffd75e");
    c.font = '15px "DotGothic16", monospace';

    const folk = snapshot.agents.filter((a2) => a2.role !== "treasury" && !isDead(a2.region));
    const balances = folk.map((a2) => a2.balances.currency).sort((p1, p2) => p1 - p2);
    const total = balances.reduce((s2, v) => s2 + v, 0);
    // Gini: mean absolute difference over 2*mean (0 = equal, 1 = one owns all).
    let giniNum = 0;
    for (let i = 0; i < balances.length; i++) giniNum += (2 * (i + 1) - balances.length - 1) * (balances[i] ?? 0);
    const gini = total > 0 ? giniNum / (balances.length * total) : 0;
    const settles = allEvents.filter((ev) => ev.type === "economy.settled");
    let volume = 0;
    for (const ev of settles) {
      const entries = (ev.payload["entries"] as { currencyDelta?: number }[] | undefined) ?? [];
      for (const en of entries) if ((en.currencyDelta ?? 0) > 0) volume += en.currencyDelta ?? 0;
    }
    c.fillStyle = "#ffffff";
    c.fillText(`つうかそうりょう ${total}G  ひとりあたり ${folk.length > 0 ? Math.round(total / folk.length) : 0}G  ジニけいすう ${gini.toFixed(2)} ${gini > 0.4 ? "(かくさ大)" : gini > 0.25 ? "(かくさ中)" : "(びょうどう)"}`, x + 24, y + 44);
    c.fillText(`とりひき ${settles.length}けん / うごいた おかね ${volume}G / けっこん ${weddingBook.marriages}くみ`, x + 24, y + 66);

    // ---- trade activity sparkline (12 buckets over the last 600 events) ----
    drawText(c, "とりひきの いきおい (ちかごろ)", x + 24, y + 96, "#8fd0ff");
    const recent = allEvents.slice(-600);
    const bucketN = 12;
    const per = Math.max(1, Math.ceil(recent.length / bucketN));
    const buckets: number[] = Array.from({ length: bucketN }, () => 0);
    recent.forEach((ev, i) => {
      if (ev.type === "economy.settled") buckets[Math.min(bucketN - 1, Math.floor(i / per))]!++;
    });
    const bMax = Math.max(1, ...buckets);
    for (let i = 0; i < bucketN; i++) {
      const bh = Math.round(((buckets[i] ?? 0) / bMax) * 54);
      c.fillStyle = "#4a9fe8";
      c.fillRect(x + 24 + i * 24, y + 178 - bh, 18, bh);
    }
    c.strokeStyle = "#5a6a85";
    c.strokeRect(x + 22, y + 122, bucketN * 24 + 4, 58);

    // ---- wealth histogram ----
    drawText(c, "とみの ぶんぷ", x + 360, y + 96, "#8fd0ff");
    const bins = [0, 10, 25, 50, 100, 200];
    const labels = ["<10", "<25", "<50", "<100", "<200", "200+"];
    const hist: number[] = Array.from({ length: bins.length }, () => 0);
    for (const b of balances) {
      let bi = bins.length - 1;
      for (let i = 0; i < bins.length - 1; i++) {
        if (b < bins[i + 1]!) {
          bi = i;
          break;
        }
      }
      hist[bi]!++;
    }
    const hMax = Math.max(1, ...hist);
    c.font = '12px "DotGothic16", monospace';
    for (let i = 0; i < hist.length; i++) {
      const bh = Math.round(((hist[i] ?? 0) / hMax) * 44);
      c.fillStyle = "#3fd05e";
      c.fillRect(x + 360 + i * 34, y + 168 - bh, 26, bh);
      c.fillStyle = "#c9d4e8";
      c.fillText(labels[i] ?? "", x + 360 + i * 34, y + 172);
    }

    // ---- village treasuries ----
    c.font = '15px "DotGothic16", monospace';
    drawText(c, "むらの きんこ ランキング (ぜいりつ / せいじ / じんこう)", x + 24, y + 206, "#8fd0ff");
    const rows = snapshot.regions
      .filter((r) => r.id !== AFTERLIFE)
      .map((r) => ({
        r,
        bank: snapshot?.agents.find((a2) => a2.id === `treasury@${r.id}`)?.balances.currency ?? 0,
        pop: snapshot?.agents.filter((a2) => a2.region === r.id && a2.role !== "treasury").length ?? 0,
      }))
      .sort((p1, p2) => p2.bank - p1.bank || p2.pop - p1.pop)
      .slice(0, 8);
    rows.forEach(({ r, bank, pop }, i) => {
      const regime = REGIME_JA[classifyRegime(r.institutions.governance as GovernanceValue)].label;
      c.fillStyle = i === 0 ? "#ffd75e" : "#ffffff";
      c.fillText(
        `${i + 1}. ${r.displayName}  ${bank}G  ぜい${Math.round(r.institutions.economyPolicy.baseCostRate * 100)}%  ${regime}  ${pop}にん`,
        x + 24,
        y + 232 + i * 24,
      );
    });

    // ---- richest citizens ----
    drawText(c, "ちょうじゃばんづけ", x + 500, y + 206, "#8fd0ff");
    [...folk]
      .sort((p1, p2) => p2.balances.currency - p1.balances.currency)
      .slice(0, 8)
      .forEach((a2, i) => {
        c.fillStyle = i === 0 ? "#ffd75e" : "#ffffff";
        c.fillText(`${i + 1}. ${a2.id}  ${a2.balances.currency}G`, x + 500, y + 232 + i * 24);
      });

    c.fillStyle = "#8090a8";
    c.fillText("Eか Escで とじる", x + 24, y + h - 32);
  }
}

class MapOverlay {
  constructor(private readonly onClose: () => void) {}

  handleKey(key: string): void {
    if (["Escape", "Enter", " ", "m", "M", "x", "z"].includes(key)) this.onClose();
  }

  render(c: CanvasRenderingContext2D, width: number, height: number): void {
    if (!map) return;
    const w = MAP_W * MINI_SCALE + 48;
    const h = MAP_H * MINI_SCALE + 76;
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    drawWindow(c, x, y, w, h);
    drawText(c, "せかいちず", x + 24, y + 16, "#ffd75e");
    const ox = x + 24;
    const oy = y + 52;
    c.drawImage(miniMapCanvas(map), ox, oy);
    c.font = '13px "DotGothic16", monospace';
    for (const v of map.villages) {
      c.fillStyle = "#ffffff";
      c.fillText(v.displayName, ox + v.x * MINI_SCALE, oy + v.y * MINI_SCALE - 3);
    }
    if (Math.floor(performance.now() / 300) % 2 === 0) {
      c.fillStyle = "#ffffff";
      c.fillRect(ox + player.x * MINI_SCALE - 2, oy + player.y * MINI_SCALE - 2, MINI_SCALE + 4, MINI_SCALE + 4);
    }
  }
}

function roleJa(role: string): string {
  return { artisan: "しょくにん", merchant: "しょうにん", broker: "なかがいにん", treasury: "きんこばん" }[role] ?? role;
}

// ---- input ----------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  startAudio();
  if (scene === "title") {
    if (e.key === "Enter" || e.key === " " || e.key === "z") {
      scene = "game";
      se("confirm");
      onboard();
    }
    return;
  }
  if (ui.active) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") se("cursor");
    else if (e.key === "Enter" || e.key === " " || e.key === "z") se("confirm");
    else if (e.key === "Escape" || e.key === "x") se("cancel");
    ui.handleKey(e.key);
    return;
  }
  if (scene === "interior" && interior) {
    if (!ui.active) {
      const dir = DIRS[e.key];
      if (dir) {
        const nx = interior.px + dir[0];
        const ny = interior.py + dir[1];
        if (nx === interior.exit[0] && ny === interior.exit[1]) {
          scene = "game";
          interior = null;
          se("cancel");
          return;
        }
        if (!interiorSolid(nx, ny)) {
          interior.px = nx;
          interior.py = ny;
        }
        return;
      }
      if (e.key === "Escape" || e.key === "x") {
        scene = "game";
        interior = null;
        se("cancel");
        return;
      }
      if ((e.key === "Enter" || e.key === " " || e.key === "z") && interior.occupant) {
        // Face-adjacent to the occupant? Then chat, using the same real menu.
        if (Math.abs(interior.px - 3) + Math.abs(interior.py - 2) === 1) {
          se("confirm");
          npcMenu({ agent: interior.occupant, x: 0, y: 0, px: 0, py: 0, timer: 0, frame: 0, home: undefined, target: null, bubble: null, hiddenUntil: 0 });
          return;
        }
      }
    } else {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") se("cursor");
      ui.handleKey(e.key);
    }
    return;
  }
  if (e.key === "m" || e.key === "M") {
    se("confirm");
    ui.push(new MapOverlay(() => ui.clear()));
    return;
  }
  if (e.key === "l" || e.key === "L") {
    se("confirm");
    ui.push(new LogViewer());
    return;
  }
  if (e.key === "h" || e.key === "H") {
    se("confirm");
    ui.push(new Info("たすけ — できることの すべて", [
      "やじるしキー: あるく (Shift: ダッシュ)  Enter: はなす/しらべる",
      "E: けいざいしんぶん  M: ちず  L: せかいのログ  Q: いらいのふだ  H: このヘルプ",
      "",
      "― ひととの かかわり ―",
      "はなす / みのうえを きく / ゴールドや どうぐを わたす / ほしょうする",
      "こくはくする (りょうおもいで けっこんしき) / おみまい / でしいり / ほしいものを きく",
      "",
      "― むらの いとなみ ―",
      "やくば: じょうほう・きろく(いれいひ)・きふ(むらが はってんする)・いじゅう",
      "ふどうさん: むらを うる/かう/ゆずる/たたむ  ぜいせい: ぜいりつの あらため",
      "さいばんしょ: ていあんと とうひょう / ろっぽうぜんしょ  ぞうへいきょく: どうぐづくり",
      "どうぐや: かいもの  びょういん / えき(ちかつうろ) / くうこう / こうかせん",
      "",
      "― じぶんの じんせい ―",
      "むらを たてる / けんちく(いえ・みせ・とう を たてる) / ものづくり / こどもを むかえる",
    ], () => ui.clear()));
    return;
  }
  if (e.key === "q" || e.key === "Q") {
    se("confirm");
    ui.push(new Info("いらいのふだ — いま せかいが もとめていること", requestBoard(), () => ui.clear()));
    return;
  }
  if (e.key === "e" || e.key === "E") {
    se("confirm");
    ui.push(new EconomyOverlay(() => ui.clear()));
    return;
  }
  if (e.key === "Enter" || e.key === " " || e.key === "z") {
    se("confirm");
    interact();
  }
  else {
    held.add(e.key);
    // A single tap moves one tile even if the key is released before the next
    // frame (DQ-style tap movement; held keys keep walking via update()).
    const dir = DIRS[e.key];
    if (dir && player.px === player.x * CELL && player.py === player.y * CELL) tryStep(dir[0], dir[1]);
  }
});
window.addEventListener("keyup", (e) => held.delete(e.key));

const DIRS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  w: [0, -1],
  ArrowDown: [0, 1],
  s: [0, 1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
};

function tryStep(dx: number, dy: number): void {
  player.dx = dx;
  player.dy = dy;
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (heroWalkable(nx, ny)) {
    player.x = nx;
    player.y = ny;
    player.moving = true;
  }
}

// ---- update / render -------------------------------------------------------

function update(dt: number): void {
  particles.update(dt);
  wildlife.update(dt, canvas.width, canvas.height, camXg, camYg);
  weather.update(dt, biomeAt(player.x, player.y), dayPhase().night, canvas.width, canvas.height);
  sky.update(dt, dayPhase().night);

  // Festival confetti rains over celebrating villages; expired festivals end.
  for (const [rid, until] of festivals) {
    if (performance.now() > until) {
      festivals.delete(rid);
      continue;
    }
    const v = map?.villages.find((x) => x.regionId === rid);
    if (v && Math.random() < 0.5) {
      particles.confetti((v.x + 1 + Math.random() * (v.w - 2)) * CELL, (v.y + 1) * CELL);
    }
  }

  // Tourists stroll the sights.
  for (const t2 of tourists) {
    const tx2 = t2.x * CELL;
    const ty2 = t2.y * CELL;
    if (t2.px !== tx2 || t2.py !== ty2) {
      const step = 1.3 * (dt / 16.7);
      t2.px += Math.sign(tx2 - t2.px) * Math.min(step, Math.abs(tx2 - t2.px));
      t2.py += Math.sign(ty2 - t2.py) * Math.min(step, Math.abs(ty2 - t2.py));
      continue;
    }
    t2.timer -= dt;
    if (t2.timer > 0) continue;
    t2.timer = 700 + Math.random() * 1600;
    const dirs2 = [[0, 1], [0, -1], [1, 0], [-1, 0]] as const;
    const [ddx, ddy] = dirs2[Math.floor(Math.random() * dirs2.length)] ?? [0, 0];
    const nx2 = t2.x + ddx;
    const ny2 = t2.y + ddy;
    if (villageContains(t2.home, nx2, ny2) && walkable(nx2, ny2)) {
      t2.x = nx2;
      t2.y = ny2;
    }
  }

  // Critters amble about the wild.
  for (const c of critters) {
    const cx = c.x * CELL;
    const cy = c.y * CELL;
    if (c.px !== cx || c.py !== cy) {
      const step = 1.1 * (dt / 16.7);
      c.px += Math.sign(cx - c.px) * Math.min(step, Math.abs(cx - c.px));
      c.py += Math.sign(cy - c.py) * Math.min(step, Math.abs(cy - c.py));
      continue;
    }
    c.timer -= dt;
    if (c.timer > 0) continue;
    c.timer = 1200 + Math.random() * 2600;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]] as const;
    const [dx2, dy2] = dirs[Math.floor(Math.random() * dirs.length)] ?? [0, 0];
    const nx = c.x + dx2;
    const ny = c.y + dy2;
    if (map && !isSolid(map, nx, ny) && !map.villages.some((v) => villageContains(v, nx, ny))) {
      c.x = nx;
      c.y = ny;
    }
  }
  tickerX -= dt * 0.06;
  // Player: tween toward the target tile; accept a new step when settled.
  const tx = player.x * CELL;
  const ty = player.y * CELL;
  if (player.px !== tx || player.py !== ty) {
    // Hold Shift to dash, DQ-B-button style.
    const step = (held.has("Shift") ? SPEED * 1.9 : SPEED) * (dt / 16.7);
    player.px += Math.sign(tx - player.px) * Math.min(step, Math.abs(tx - player.px));
    player.py += Math.sign(ty - player.py) * Math.min(step, Math.abs(ty - player.py));
    player.frame = Math.floor(performance.now() / 160) % 2;
  } else {
    player.moving = false;
    if (!ui.active) {
      if (held.has("ArrowUp") || held.has("w")) tryStep(0, -1);
      else if (held.has("ArrowDown") || held.has("s")) tryStep(0, 1);
      else if (held.has("ArrowLeft") || held.has("a")) tryStep(-1, 0);
      else if (held.has("ArrowRight") || held.has("d")) tryStep(1, 0);
    }
  }

  // NPCs: run errands around their village, and stop for a chat when they meet.
  for (const mob of mobs) {
    const mx = mob.x * CELL;
    const my = mob.y * CELL;
    if (mob.px !== mx || mob.py !== my) {
      const step = (isChildName(mob.agent.id) ? 2.6 : 1.6) * (dt / 16.7);
      mob.px += Math.sign(mx - mob.px) * Math.min(step, Math.abs(mx - mob.px));
      mob.py += Math.sign(my - mob.py) * Math.min(step, Math.abs(my - mob.py));
      mob.frame = Math.floor(performance.now() / 200) % 2;
      continue;
    }
    if (mob.bubble && performance.now() > mob.bubble.until) mob.bubble = null;
    mob.timer -= dt;
    if (mob.timer > 0) continue;

    // A neighbor within arm's reach? Stop and gossip (both of them).
    const neighbor = mobs.find((o) => o !== mob && Math.abs(o.x - mob.x) + Math.abs(o.y - mob.y) === 1 && !o.bubble);
    if (!mob.bubble && neighbor && Math.random() < 0.6) {
      const now = performance.now();
      mob.bubble = { text: chatterLine(mob), until: now + 2600 };
      neighbor.bubble = { text: replyLine(neighbor), until: now + 3200 };
      mob.timer = 3000 + Math.random() * 1500;
      neighbor.timer = Math.max(neighbor.timer, 3400);
      mob.target = null;
      neighbor.target = null;
      continue;
    }

    const home = mob.home;
    // Festival! Everyone drifts toward the stall square.
    if (home && festivals.has(home.regionId) && !mob.target && Math.random() < 0.7) {
      mob.target = [home.stall[0], home.stall[1] + 1] as const;
    }
    // Pick an errand now and then: the stall, the signboard, a house front, a neighbor.
    if (!mob.target && home && Math.random() < 0.45) {
      const pois: (readonly [number, number])[] = [
        [home.stall[0], home.stall[1] + 1],
        [home.sign[0], home.sign[1] - 1],
        [home.hall[0], home.hall[1] + 1],
        [home.mint[0], home.mint[1] + 1],
        [home.court[0], home.court[1] + 1],
        ...(home.hospital ? [[home.hospital[0], home.hospital[1] + 1] as const] : []),
        ...home.homes.map(([hx2, hy2]) => [hx2, hy2 + 1] as const),
        ...home.spots,
        ...mobs.filter((o) => o !== mob && o.home === home).map((o) => [o.x, o.y] as const),
      ];
      mob.target = pois[Math.floor(Math.random() * pois.length)] ?? null;
      // Sometimes the errand is simply going home for a while.
      if (Math.random() < 0.18 && home.homes.length > 0) {
        const door = home.homes[Math.floor(Math.random() * home.homes.length)];
        if (door) mob.target = [door[0], door[1] + 1] as const;
      }
    }

    let dx = 0;
    let dy = 0;
    if (mob.target) {
      const [gx2, gy2] = mob.target;
      if (mob.x === gx2 && mob.y === gy2) {
        // Arrived at a doorstep? Step inside for a spell.
        if (mob.home?.homes.some(([hx2, hy2]) => hx2 === gx2 && hy2 === gy2 - 1) && Math.random() < 0.7) {
          mob.hiddenUntil = performance.now() + 4000 + Math.random() * 6000;
        }
        mob.target = null;
      }
      else if (Math.abs(gx2 - mob.x) >= Math.abs(gy2 - mob.y)) dx = Math.sign(gx2 - mob.x);
      else dy = Math.sign(gy2 - mob.y);
      if (Math.random() < 0.08) mob.target = null; // sometimes they forget the errand
    }
    if (dx === 0 && dy === 0) {
      const dirs = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ] as const;
      [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)] ?? [0, 0];
    }
    mob.timer = mob.target ? 420 + Math.random() * 400 : 800 + Math.random() * 1800;
    const nx = mob.x + dx;
    const ny = mob.y + dy;
    const inside = !home || villageContains(home, nx, ny);
    if (inside && walkable(nx, ny) && !(nx === player.x && ny === player.y)) {
      mob.x = nx;
      mob.y = ny;
    } else if (mob.target) {
      mob.target = null; // blocked: give up rather than shove
    }
  }
}

// Ambient one-liners: flavored by the villager's real ledger where it shows.
function chatterLine(mob: Mob): string {
  const gold = mob.agent.balances.currency;
  if (gold < 10) return "はらへった…";
  if (gold >= 150) return "わっはっは!";
  if (mob.agent.trust >= 5) return "しんらいが いちばん";
  if (isChildName(mob.agent.id)) return pick2(["あそぼー!", "みてみて!", "かけっこ しよう!"]);
  const pool = [
    "やあ!", "きいたかい?", "もうかった?", "いいてんきだ", "せいが でるね",
    "でんしゃ のった?", "ひこうきって すごいね", "ぜいきん あがるらしい…",
    "Kuroに きをつけな", "ほけん はいった?", "となりまち いった?",
  ];
  return pick2(pool);
}

function pick2<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)] as T;
}

function replyLine(mob: Mob): string {
  if (mob.agent.balances.currency < 10) return "ごちそうしてくれ…";
  const pool = ["うんうん", "なるほどね", "はっはっは", "ぼちぼちさ", "そうかい?", "それは いいね", "しらなかった!", "ないしょだよ", "むりむり", "けんこう だいいち"];
  return pick2(pool);
}

/** Trains shuttle along the rails, back and forth. `lift` raises them for the elevated view. */
function drawTrains(camX: number, camY: number, lift: number): void {
  if (!ctx || !map) return;
  for (const rail of map.rails) {
    if (rail.length < 4) continue;
    const span = rail.length - 1;
    const t = Math.floor(performance.now() / 130) % (span * 2);
    const head = t <= span ? t : span * 2 - t;
    for (let car = 0; car < 3; car++) {
      const idx = Math.max(0, Math.min(span, head + (t <= span ? -car : car)));
      const pt = rail[idx];
      if (!pt) continue;
      const px = pt[0] * CELL - camX + 6;
      const py = pt[1] * CELL - camY + 10 - lift;
      ctx.fillStyle = car === 0 ? "#c23a2e" : "#e8e8e8";
      ctx.fillRect(px, py, 36, 24);
      ctx.fillStyle = "#2a3a55";
      ctx.fillRect(px + 5, py + 5, 10, 8);
      ctx.fillRect(px + 21, py + 5, 10, 8);
    }
  }
}

/** The vertical world: redraw only what exists on the hero's current layer,
 * floating above a dimmed ground (こうか) or in lamp-lit darkness (ちかどう). */
function renderLayer(camX: number, camY: number, w: number, h: number): void {
  if (!ctx || !map) return;
  const x0 = Math.floor(camX / CELL);
  const y0 = Math.floor(camY / CELL);
  ctx.fillStyle = layerZ === 1 ? "rgba(6, 10, 22, 0.5)" : "rgba(0, 0, 6, 0.92)";
  ctx.fillRect(0, 0, w, h);
  const lift = layerZ === 1 ? 8 : 0;
  for (let y = y0; y <= y0 + Math.ceil(h / CELL); y++) {
    for (let x = x0; x <= x0 + Math.ceil(w / CELL); x++) {
      if (layerZ === 1) {
        const t = tileAt(map, x, y);
        if (!ELEVATED_TILES.has(t)) continue;
        const sp = sprites.tiles.get(t);
        if (sp) ctx.drawImage(sp, x * CELL - camX, y * CELL - camY - lift);
      } else {
        if (!subwayCells.has(y * MAP_W + x)) continue;
        const t = tileAt(map, x, y);
        const sp = sprites.tiles.get(t === Tile.Rail || t === Tile.Station ? Tile.Rail : Tile.Pavement);
        if (sp) {
          ctx.globalAlpha = 0.8;
          ctx.drawImage(sp, x * CELL - camX, y * CELL - camY);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
  if (layerZ === -1) {
    for (const v of map.villages) {
      if (!v.station) continue;
      const px = v.station[0] * CELL - camX + CELL / 2;
      const py = v.station[1] * CELL - camY + CELL / 2;
      const grad = ctx.createRadialGradient(px, py, 4, px, py, CELL * 2.5);
      grad.addColorStop(0, "rgba(255, 220, 140, 0.55)");
      grad.addColorStop(1, "rgba(255, 220, 140, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(px - CELL * 2.5, py - CELL * 2.5, CELL * 5, CELL * 5);
      drawText(ctx, `${v.displayName}えき`, v.station[0] * CELL - camX - 8, v.station[1] * CELL - camY - 20, "#ffd75e");
    }
  }
  drawTrains(camX, camY, layerZ === 1 ? 8 : 0);
  const heroPair = sprites.heroFor(titleTier(title));
  if (layerZ === 1) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(player.px - camX + CELL / 2, player.py - camY + CELL - 2, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.drawImage(heroPair[player.frame === 0 ? 0 : 1], player.px - camX, player.py - camY - lift);
  const label = layerZ === 1 ? "― こうか ―  (ふちで Enter: おりる)" : "― ちかどう ―  (えきで Enter: あがる)";
  drawText(ctx, label, 16, h - 96, "#8fd0ff");
}

function render(): void {
  if (!ctx) return;
  ctx.textBaseline = "top";
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (!map || !snapshot) {
    drawText(ctx, "よみこみちゅう…", 40, 40);
    return;
  }

  const shake = performance.now() < shakeUntil ? 5 : 0;
  const camX = Math.max(0, Math.min(player.px - w / 2 + CELL / 2, MAP_W * CELL - w)) + (Math.random() - 0.5) * shake;
  const camY = Math.max(0, Math.min(player.py - h / 2 + CELL / 2, MAP_H * CELL - h)) + (Math.random() - 0.5) * shake;
  camXg = camX;
  camYg = camY;
  const x0 = Math.floor(camX / CELL);
  const y0 = Math.floor(camY / CELL);
  const animFrame = Math.floor(performance.now() / 520) % 2 === 1;

  const lights: (readonly [number, number])[] = [];
  for (let y = y0; y <= y0 + Math.ceil(h / CELL); y++) {
    for (let x = x0; x <= x0 + Math.ceil(w / CELL); x++) {
      const t = tileAt(map, x, y);
      const sprite = (animFrame ? sprites.tilesAlt.get(t) : undefined) ?? sprites.tiles.get(t);
      if (sprite) ctx.drawImage(sprite, x * CELL - camX, y * CELL - camY);
      if (t === Tile.Lamp || t === Tile.WallWindow || t === Tile.WallWoodWindow || t === Tile.TowerGlass) lights.push([x, y] as const);
    }
  }

  for (const village of map.villages) {
    const hostV = village.parent ? map.villages.find((o) => o.regionId === village.parent) : null;
    drawText(
      ctx,
      `${village.displayName}${municipalRank(village.tier)}${hostV ? `〔${hostV.displayName}${municipalRank(hostV.tier)}内〕` : ""} (${BIOME_JA[village.biome]})`,
      village.x * CELL - camX + 8,
      (village.y - 1) * CELL - camY + 20,
      "#ffd75e",
    );
    ctx.font = '13px "DotGothic16", monospace';
    ctx.fillStyle = "#ffffff";
    const label = (text: string, at: readonly [number, number]) =>
      ctx.fillText(text, (at[0] - 0.5) * CELL - camX + 4, (at[1] - 1) * CELL - camY - 4);
    label("やくば", village.hall);
    label("ぞうへい", village.mint);
    label("さいばん", village.court);
    // The constitution flies over the town hall as a colored flag.
    const gov = snapshot.regions.find((r) => r.id === village.regionId)?.institutions.governance;
    if (gov) {
      const regime = classifyRegime(gov as GovernanceValue);
      const fpx = village.hall[0] * CELL - camX + CELL + 8;
      const fpy = (village.hall[1] - 2) * CELL - camY;
      ctx.fillStyle = "#5b3a1e";
      ctx.fillRect(fpx, fpy - 6, 4, 44);
      ctx.fillStyle = REGIME_COLOR[regime];
      const wave = Math.floor(performance.now() / 300) % 2 === 0 ? 0 : 2;
      ctx.fillRect(fpx + 4, fpy - 6 + wave, 26, 14);
      ctx.font = '12px "DotGothic16", monospace';
      ctx.fillStyle = "#ffffff";
      ctx.fillText(REGIME_JA[regime].label, fpx - 10, fpy + 50);
    }
    // Construction banners while a settlement is actively growing.
    if (construction.has(village.regionId)) {
      if (performance.now() > (construction.get(village.regionId) ?? 0)) construction.delete(village.regionId);
      else {
        ctx.font = '14px "DotGothic16", monospace';
        ctx.fillStyle = "#ffb020";
        ctx.fillText("🔨こうじちゅう", (village.x + 1) * CELL - camX, (village.y - 1) * CELL - camY + 38);
        if (Math.random() < 0.06) {
          particles.sparkle((village.x + 1 + Math.random() * (village.w - 2)) * CELL, (village.y + 2 + Math.random() * (village.h - 4)) * CELL, "#c8a060");
        }
      }
    }
    // Festival lanterns swing along the fence while the party lasts.
    if (festivals.has(village.regionId)) {
      const sway = Math.sin(performance.now() / 260) * 3;
      for (let lx = village.x + 1; lx < village.x + village.w - 1; lx += 2) {
        ctx.fillStyle = (lx / 2) % 2 === 0 ? "#ff5a4a" : "#ffd75e";
        ctx.beginPath();
        ctx.arc(lx * CELL - camX + CELL / 2, village.y * CELL - camY + 10 + sway, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = '20px "DotGothic16", monospace';
      ctx.fillStyle = "#ffd75e";
      ctx.fillText("★まつり★", (village.x + village.w / 2 - 2) * CELL - camX, (village.y - 1) * CELL - camY - 4 + sway);
    }
    // 関所ばた: this village's diplomatic stance toward the hero's home village.
    const myHome = snapshot.me.agentId?.split("@")[1];
    const region = snapshot.regions.find((r) => r.id === village.regionId);
    if (myHome && region && region.id !== myHome) {
      const stance = stanceToward(region, myHome);
      const fx = village.gate[0] * CELL - camX + CELL + 4;
      const fy = (village.gate[1] + 1) * CELL - camY;
      ctx.fillStyle = "#5b3a1e";
      ctx.fillRect(fx, fy - 30, 4, 34);
      ctx.fillStyle = STANCE_COLOR[stance];
      ctx.fillRect(fx + 4, fy - 30, 22, 14);
      ctx.font = '12px "DotGothic16", monospace';
      ctx.fillStyle = "#ffffff";
      ctx.fillText(STANCE_JA[stance], fx - 4, fy + 12);
    }
  }

  for (const mob of mobs) {
    if (performance.now() < mob.hiddenUntil) continue; // indoors
    const pair = sprites.roles[mob.agent.role] ?? sprites.roles["artisan"];
    if (pair) ctx.drawImage(pair[mob.frame === 0 ? 0 : 1], mob.px - camX, mob.py - camY);
    if (genomeProfOf(mob.agent.id)) {
      const bob = Math.sin(performance.now() / 300 + mob.px) * 2;
      ctx.fillStyle = "#ffd75e";
      const mx = mob.px - camX + CELL / 2;
      const my = mob.py - camY - 8 + bob;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const ang = (Math.PI / 5) * k - Math.PI / 2;
        const rr = k % 2 === 0 ? 5 : 2.2;
        ctx.lineTo(mx + Math.cos(ang) * rr, my + Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.font = '13px "DotGothic16", monospace';
  for (const mob of mobs) {
    if (!mob.bubble) continue;
    const bw = Math.max(ctx.measureText(mob.bubble.text).width + 14, 34);
    const bx = mob.px - camX + CELL / 2 - bw / 2;
    const by = mob.py - camY - 26;
    ctx.fillStyle = "#f8f8f8";
    ctx.fillRect(bx, by, bw, 20);
    ctx.fillRect(mob.px - camX + CELL / 2 - 3, by + 20, 6, 5);
    ctx.fillStyle = "#111";
    ctx.textBaseline = "top";
    ctx.fillText(mob.bubble.text, bx + 7, by + 4);
  }

  // Tourists (white travelers snapping the sights).
  const touristPair = sprites.roles["tourist"];
  for (const t2 of tourists) {
    if (touristPair) ctx.drawImage(touristPair[Math.floor(performance.now() / 220) % 2 === 0 ? 0 : 1], t2.px - camX, t2.py - camY);
  }

  // Wild critters.
  for (const c of critters) {
    const sprite = sprites.critters[c.kind];
    if (sprite) ctx.drawImage(sprite, c.px - camX, c.py - camY);
  }

  // Caravan carts trundle along the friendship roads.
  for (const road of map.roads) {
    if (road.length < 4) continue;
    const span = road.length - 1;
    const t = Math.floor(performance.now() / 300) % (span * 2);
    const idx = t <= span ? t : span * 2 - t;
    const pt = road[idx];
    if (!pt) continue;
    const px = pt[0] * CELL - camX + 6;
    const py = pt[1] * CELL - camY + 12;
    ctx.fillStyle = "#8a5a2b";
    ctx.fillRect(px, py, 30, 18);
    ctx.fillStyle = "#e8e0c8";
    ctx.fillRect(px + 3, py - 8, 24, 10);
    ctx.fillStyle = "#3a2a16";
    ctx.fillRect(px + 3, py + 18, 8, 6);
    ctx.fillRect(px + 19, py + 18, 8, 6);
    ctx.fillStyle = "#6a4a2a";
    ctx.fillRect(px + 30, py + 2, 12, 12);
  }

  drawTrains(camX, camY, 0);

  // Transmission lines hum between plants and substations, pylons in step.
  for (const [a, b] of map.powerLines) {
    const ax = a[0] * CELL - camX + CELL / 2;
    const ay = a[1] * CELL - camY + 8;
    const bx = b[0] * CELL - camX + CELL / 2;
    const by = b[1] * CELL - camY + 8;
    ctx.strokeStyle = "rgba(30, 30, 40, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    const midSag = 6;
    ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + midSag, bx, by);
    ctx.stroke();
    const dist = Math.hypot(bx - ax, by - ay);
    const pylons = Math.max(1, Math.floor(dist / (CELL * 5)));
    for (let i = 1; i < pylons; i++) {
      const f = i / pylons;
      const px = ax + (bx - ax) * f;
      const py = ay + (by - ay) * f;
      ctx.fillStyle = "#4a4a55";
      ctx.fillRect(px - 2, py, 4, 26);
      ctx.fillRect(px - 8, py + 2, 16, 3);
    }
  }

  // Trucks thunder along the highways.
  for (const hw of map.highways) {
    if (hw.length < 4) continue;
    const span = hw.length - 1;
    const t = Math.floor(performance.now() / 90) % (span * 2);
    const idx = t <= span ? t : span * 2 - t;
    const pt = hw[idx];
    if (pt) {
      const px = pt[0] * CELL - camX + 8;
      const py = pt[1] * CELL - camY + 14;
      ctx.fillStyle = "#3a6fd0";
      ctx.fillRect(px, py, 26, 16);
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(px + 18, py + 2, 8, 12);
      ctx.fillStyle = "#222";
      ctx.fillRect(px + 3, py + 16, 6, 5);
      ctx.fillRect(px + 17, py + 16, 6, 5);
    }
  }

  // Airplanes cruise between airports, shadows sweeping the land below.
  const airports = map.villages.filter((v) => v.airport);
  for (let i = 0; i + 1 < airports.length + (airports.length > 1 ? 1 : 0); i++) {
    const a = airports[i % airports.length]?.airport;
    const b = airports[(i + 1) % airports.length]?.airport;
    if (!a || !b) continue;
    const period = 14000;
    const t = (performance.now() % (period * 2)) / period;
    const f = t <= 1 ? t : 2 - t;
    const px = (a[0] + (b[0] - a[0]) * f) * CELL - camX;
    const py = (a[1] + (b[1] - a[1]) * f) * CELL - camY - 40;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(px + 8, py + 52, 28, 8);
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(px, py + 8, 40, 10);
    ctx.fillRect(px + 12, py, 8, 26);
    ctx.fillStyle = "#c23a2e";
    ctx.fillRect(px + 34, py + 8, 6, 10);
  }

  const heroPair = sprites.heroFor(titleTier(title));
  ctx.drawImage(heroPair[player.frame === 0 ? 0 : 1], player.px - camX, player.py - camY);

  wildlife.render(ctx, camX, camY);
  particles.render(ctx, camX, camY);
  weather.render(ctx, biomeAt(player.x, player.y));
  sky.render(ctx, w, dayPhase().night, biomeAt(player.x, player.y) === Biome.Snow);

  // Day-night mood, with lamps and windows glowing after dark.
  const phase = dayPhase();
  if (phase.tint) {
    ctx.fillStyle = phase.tint;
    ctx.fillRect(0, 0, w, h);
  }
  if (phase.night) {
    ctx.globalCompositeOperation = "lighter";
    for (const [lx, ly] of lights) {
      const t2 = tileAt(map, lx, ly);
      if (t2 !== Tile.Lamp) {
        const owner2 = map.villages.find((v) => villageContains(v, lx, ly));
        if (owner2 && !owner2.powered) continue; // no electricity, no window light
      }
      const gx2 = lx * CELL - camX + CELL / 2;
      const gy2 = ly * CELL - camY + CELL / 2;
      const grad = ctx.createRadialGradient(gx2, gy2, 4, gx2, gy2, 70);
      grad.addColorStop(0, "rgba(255, 214, 110, 0.30)");
      grad.addColorStop(1, "rgba(255, 214, 110, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(gx2 - 70, gy2 - 70, 140, 140);
    }
    if (performance.now() < torchUntil) {
      const hx = player.px - camX + CELL / 2;
      const hy = player.py - camY + CELL / 2;
      const tg = ctx.createRadialGradient(hx, hy, 8, hx, hy, 170);
      tg.addColorStop(0, "rgba(255, 200, 110, 0.42)");
      tg.addColorStop(1, "rgba(255, 200, 110, 0)");
      ctx.fillStyle = tg;
      ctx.fillRect(hx - 170, hy - 170, 340, 340);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  if (wedding) {
    if (performance.now() >= wedding.until) {
      wedding = null;
    } else {
      const [hx, hy] = wedding.village.hall;
      const now2 = performance.now();
      ctx.font = '18px "DotGothic16", monospace';
      for (let k = 0; k < 6; k++) {
        const ph = (now2 / 900 + k * 0.31) % 1;
        const px2 = hx * CELL - camX + CELL / 2 + Math.sin((ph + k) * 6.3) * 30 + (k - 3) * 16;
        const py2 = (hy + 1) * CELL - camY - ph * 70;
        ctx.fillStyle = `rgba(232, 122, 160, ${(1 - ph).toFixed(2)})`;
        ctx.fillText("♥", px2, py2);
      }
      const label2 = `〜 けっこんしき 〜`;
      ctx.font = '17px "DotGothic16", monospace';
      const lw = ctx.measureText(label2).width;
      ctx.fillStyle = "#000";
      ctx.fillText(label2, hx * CELL - camX + CELL / 2 - lw / 2 + 2, (hy - 3) * CELL - camY + 2);
      ctx.fillStyle = "#ffd75e";
      ctx.fillText(label2, hx * CELL - camX + CELL / 2 - lw / 2, (hy - 3) * CELL - camY);
      if (Math.random() < 0.02) particles.firework(hx + Math.floor(Math.random() * 5) - 2, hy - 1);
    }
  }

  if (layerZ !== 0) renderLayer(camX, camY, w, h);

  // HUD
  const hero = heroAgent();
  drawWindow(ctx, 12, 40, 264, hero ? 164 : 66);
  drawText(ctx, snapshot.me.heroName ?? "ななしの たびびと", 32, 56, "#ffd75e");
  if (hero) {
    ctx.font = '15px "DotGothic16", monospace';
    ctx.fillStyle = "#8fd0ff";
    ctx.textBaseline = "top";
    ctx.fillText(title, 32, 78);
    drawText(ctx, `G: ${hero.balances.currency}`, 32, 108);
    drawText(ctx, `しんらい: ${hero.trust}`, 32, 134);
    drawText(ctx, `ひょうばん: ${hero.reputation}`, 32, 160);
  }

  // かわらばん — the scrolling headline bar.
  if (tickerText.length > 0) {
    ctx.fillStyle = "rgba(0, 6, 20, 0.82)";
    ctx.fillRect(0, 0, w, 30);
    ctx.font = '16px "DotGothic16", monospace';
    ctx.textBaseline = "top";
    const label = "かわらばん ▶ ";
    ctx.fillStyle = "#ffd75e";
    ctx.fillText(label, 10, 7);
    const labelW = ctx.measureText(label).width + 16;
    const textW = ctx.measureText(tickerText).width + 120;
    if (tickerX < -textW) tickerX = w - labelW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(labelW, 0, w - labelW, 30);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(tickerText, labelW + tickerX, 7);
    ctx.fillText(tickerText, labelW + tickerX + textW, 7);
    ctx.restore();
  }

  // かいひょうそくほう — a live tally board while any proposal is open.
  const polling = snapshot.regions.filter((r) => r.openProposal);
  if (polling.length > 0 && !ui.active) {
    const r = polling[Math.floor(performance.now() / 4000) % polling.length];
    if (r?.openProposal) {
      const gov = r.institutions.governance as GovernanceValue;
      const need = gov.kind === "council" ? (gov.threshold ?? 1) : 1;
      const got = r.openProposal.votes.length;
      ctx.font = '15px "DotGothic16", monospace';
      const text = `かいひょうそくほう ${r.displayName}「${lawText(r.openProposal.change)}」さんせい ${got}/${need}`;
      const bw2 = ctx.measureText(text).width + 40;
      const bx2 = (w - bw2) / 2;
      drawWindow(ctx, bx2, 36, bw2, 66);
      ctx.fillStyle = "#ffd75e";
      ctx.textBaseline = "top";
      ctx.fillText(text, bx2 + 20, 50);
      ctx.fillStyle = "#223";
      ctx.fillRect(bx2 + 20, 78, bw2 - 40, 10);
      ctx.fillStyle = "#2fa84f";
      ctx.fillRect(bx2 + 20, 78, (bw2 - 40) * Math.min(1, got / Math.max(1, need)), 10);
    }
  }

  // つぎのもくひょう — so there is always a reason to take the next step.
  if (nextGoal.length > 0 && !ui.active) {
    ctx.font = '15px "DotGothic16", monospace';
    const gw = ctx.measureText(nextGoal).width + 30;
    drawWindow(ctx, w - gw - 12, 40, gw, 44);
    ctx.fillStyle = "#a5ff8a";
    ctx.textBaseline = "top";
    ctx.fillText(nextGoal, w - gw + 3, 54);
  }

  // 号外! — a full-width ribbon slams in for front-page news.
  if (gogai) {
    const remain = gogai.until - performance.now();
    if (remain <= 0) gogai = null;
    else {
      const slide = Math.max(0, remain - 4100) * 2;
      ctx.globalAlpha = Math.min(1, remain / 500);
      ctx.fillStyle = "#a01818";
      ctx.fillRect(0, 130, w, 64);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 130, w, 4);
      ctx.fillRect(0, 190, w, 4);
      ctx.font = '26px "DotGothic16", monospace';
      ctx.textBaseline = "top";
      const tw2 = ctx.measureText(gogai.text).width;
      ctx.fillText(gogai.text, Math.max((w - tw2) / 2, 20) - slide, 148);
      ctx.globalAlpha = 1;
    }
  }

  // 速報バナー — big news floats center-screen for a few seconds.
  if (banner) {
    const remain = banner.until - performance.now();
    if (remain <= 0) banner = null;
    else {
      ctx.globalAlpha = Math.min(1, remain / 600);
      ctx.font = '22px "DotGothic16", monospace';
      const bw = ctx.measureText(banner.text).width + 56;
      drawWindow(ctx, (w - bw) / 2, 96, bw, 56);
      ctx.font = '22px "DotGothic16", monospace';
      ctx.fillStyle = "#ffd75e";
      ctx.fillText(banner.text, (w - bw) / 2 + 28, 131);
      ctx.globalAlpha = 1;
    }
  }

  log.render(ctx, w, h);
  ui.render(ctx, w, h);
}

// ---- boot -------------------------------------------------------------------

function onboard(): void {
  if (!snapshot) return;
  if (!snapshot.me.heroName) {
    ui.push(
      new TextInput("ゆうしゃよ なまえを なのれ (romaji)", { maxLen: 16 }, (name) => {
        void (async () => {
          const res = await postRegister(name);
          if (res.ok) {
            log.push(`ようこそ ${name}! この せかいに なまえが きざまれた。`);
            ui.clear();
            await refreshWorld(true);
            if (!snapshot?.me.agentId) log.push("まずは 「むらを たてる」(Enterキー) で じぶんのむらを つくろう!");
          } else {
            log.push(`なまえが きざめなかった… (${res.reason ?? "?"})`);
          }
        })();
      }, () => undefined),
    );
  } else if (!snapshot.me.agentId) {
    log.push("Enterキーで コマンド → 「むらを たてる」で ぼうけんが はじまる!");
  } else {
    log.push(`おかえり ${snapshot.me.heroName}。 やじるしキーで あるき、Enterで はなす/しらべる。`);
  }
}

async function poll(): Promise<void> {
  if (!snapshot) return;
  try {
    if (await syncEvents(true)) {
      await refreshWorld(false);
      checkQuests(true);
      celebrate();
    }
  } catch {
    // The node blinked; the next poll retries. Movement should not stutter for it.
  }
}

// Debug handle (harmless in prod; lets tooling inspect position/keys).
// The genome: LLM-grown vocabulary/wares/chatter/mutations, validated as pure
// data. Reloaded every 10 minutes so the world keeps mutating while you play.
let genomeVersionSeen = 0;

function applyGenome(g: NonNullable<Awaited<ReturnType<typeof loadGenome>>>): void {
  registerKindNames(g.vocab);
  registerChatter(g.chatter);
  registerWares(g.wares);
  genomeHeadlines = g.headlines;
  genomeProfs = new Map(g.professions.map((pr) => [pr.name, { craft: pr.craft, greeting: pr.greeting }]));

  // とつぜんへんい: unseen mutations break as extra-extra news, and their
  // rumor lines enter every villager's mouth.
  const seenRaw = localStorage.getItem("vouchquest.mutseen");
  const seen = new Set<number>(seenRaw ? (JSON.parse(seenRaw) as number[]) : []);
  const KIND_JA: Record<string, string> = { fashion: "りゅうこう", legend: "でんせつ", boom: "ブーム", omen: "ぜんちょう", festival: "まつり" };
  for (const m of g.mutations) {
    registerChatter({ generic: m.lines });
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (genomeVersionSeen > 0) extraExtra(`とつぜんへんい! 【${KIND_JA[m.kind] ?? m.kind}】${m.title}`);
  }
  localStorage.setItem("vouchquest.mutseen", JSON.stringify([...seen].slice(-50)));

  if (g.version > genomeVersionSeen && genomeVersionSeen > 0) log.push(`せかいが しんかした… (ゲノム v${g.version})`);
  else if (genomeVersionSeen === 0 && g.version > 0) log.push(`せかいの ことばが しんかしている… (ゲノム v${g.version})`);
  genomeVersionSeen = g.version;
}

void loadGenome().then((g) => g && applyGenome(g));
setInterval(() => void loadGenome().then((g) => g && applyGenome(g)), 10 * 60 * 1000);

Object.defineProperty(window, "__vq", { value: { player, held, mobs: () => mobs.map((m) => [m.agent.id, m.x, m.y, Math.round(m.timer), m.target]), tile: (x: number, y: number) => (map ? tileAt(map, x, y) : -1), solid: (x: number, y: number) => (map ? isSolid(map, x, y) : true) }, configurable: true });

function renderTitle(): void {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#000610";
  ctx.fillRect(0, 0, w, h);
  if (map) {
    ctx.globalAlpha = 0.3;
    const mini = miniMapCanvas(map);
    ctx.drawImage(mini, (w - mini.width * 1.4) / 2, (h - mini.height * 1.4) / 2, mini.width * 1.4, mini.height * 1.4);
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = "top";
  ctx.font = '72px "DotGothic16", monospace';
  const titleText = "VOUCH QUEST";
  const tw = ctx.measureText(titleText).width;
  ctx.fillStyle = "#000";
  ctx.fillText(titleText, (w - tw) / 2 + 4, 124);
  ctx.fillStyle = "#ffd75e";
  ctx.fillText(titleText, (w - tw) / 2, 120);
  ctx.font = '20px "DotGothic16", monospace';
  const sub = "〜 しんらいと むらむらの ものがたり 〜";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(sub, (w - ctx.measureText(sub).width) / 2, 210);

  if (snapshot) {
    const folk = snapshot.agents.filter((a) => a.role !== "treasury").length;
    const stats = `いま この せかいには — むら ${snapshot.regions.length} / じゅうみん ${folk}にん / できごと ${snapshot.logLength}`;
    ctx.fillStyle = "#8fd0ff";
    ctx.fillText(stats, (w - ctx.measureText(stats).width) / 2, 270);
    ctx.font = '17px "DotGothic16", monospace';
    ctx.fillStyle = "#c9d4e8";
    allEvents.slice(-3).reverse().forEach((e, i) => {
      const line = `◆ ${eventToMessage(e)}`;
      ctx.fillText(line, (w - ctx.measureText(line).width) / 2, 316 + i * 30);
    });
  } else {
    ctx.fillStyle = "#c9d4e8";
    const loading = "せかいを よみこんでいる…";
    ctx.fillText(loading, (w - ctx.measureText(loading).width) / 2, 280);
  }

  if (Math.floor(performance.now() / 500) % 2 === 0) {
    ctx.font = '26px "DotGothic16", monospace';
    const press = "PRESS ENTER";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(press, (w - ctx.measureText(press).width) / 2, 448);
  }
  ctx.font = '15px "DotGothic16", monospace';
  ctx.fillStyle = "#7a879c";
  const help = "やじるし:あるく  Shift:ダッシュ  Enter:しらべる  M:ちず  L:ログ";
  ctx.fillText(help, (w - ctx.measureText(help).width) / 2, 520);
  const note = `${dayPhase().label}の せかいが まっている — あなたの いっぽも れきしに きざまれる`;
  ctx.fillText(note, (w - ctx.measureText(note).width) / 2, 552);
}

function renderInterior(): void {
  if (!ctx || !interior) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const ox = (w - ROOM_W * CELL) / 2;
  const oy = (h - ROOM_H * CELL) / 2 - 30;
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const border = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
      const isExit = x === interior.exit[0] && y === interior.exit[1];
      const sprite = border && !isExit ? sprites.tiles.get(Tile.WallWood) : sprites.tiles.get(Tile.Path);
      if (sprite) ctx.drawImage(sprite, ox + x * CELL, oy + y * CELL);
      if (isExit) {
        ctx.fillStyle = "#3a2a16";
        ctx.fillRect(ox + x * CELL + 8, oy + y * CELL + 4, CELL - 16, CELL - 8);
      }
    }
  }
  for (const f of interior.furniture) {
    const fx = ox + f.x * CELL;
    const fy = oy + f.y * CELL;
    if (f.kind === "bed") {
      ctx.fillStyle = "#b03030";
      ctx.fillRect(fx + 4, fy + 8, CELL - 8, CELL - 12);
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(fx + 6, fy + 10, 14, 12);
    } else if (f.kind === "table") {
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(fx + 6, fy + 12, CELL - 12, CELL - 20);
      ctx.fillStyle = "#5b3a1e";
      ctx.fillRect(fx + 8, fy + CELL - 10, 5, 8);
      ctx.fillRect(fx + CELL - 13, fy + CELL - 10, 5, 8);
    } else if (f.kind === "shelf") {
      ctx.fillStyle = "#6a4a2a";
      ctx.fillRect(fx + 4, fy + 4, CELL - 8, CELL - 10);
      ctx.fillStyle = "#e8c840";
      ctx.fillRect(fx + 8, fy + 8, 8, 6);
      ctx.fillStyle = "#6ad2ff";
      ctx.fillRect(fx + 20, fy + 8, 8, 6);
    } else {
      const pot = sprites.tiles.get(Tile.Flower);
      if (pot) ctx.drawImage(pot, fx, fy);
    }
  }
  if (interior.occupant) {
    const pair = sprites.roles[interior.occupant.role] ?? sprites.roles["artisan"];
    if (pair) ctx.drawImage(pair[Math.floor(performance.now() / 400) % 2 === 0 ? 0 : 1], ox + 3 * CELL, oy + 2 * CELL);
    ctx.font = '14px "DotGothic16", monospace';
    ctx.fillStyle = "#9ab";
    ctx.fillText(interior.occupant.id, ox + 2 * CELL, oy + CELL + 6);
  }
  const heroPair2 = sprites.heroFor(titleTier(title));
  ctx.drawImage(heroPair2[0], ox + interior.px * CELL, oy + interior.py * CELL);
  ctx.font = '15px "DotGothic16", monospace';
  ctx.fillStyle = "#7a879c";
  ctx.fillText("でぐち(みなみ)か Esc で そとへ / となりで Enter: はなす", ox, oy + ROOM_H * CELL + 14);
  log.render(ctx, w, h);
  ui.render(ctx, w, h);
}

let last = performance.now();
function frame(now: number): void {
  if (scene === "interior") {
    renderInterior();
    last = now;
    requestAnimationFrame(frame);
    return;
  }
  if (scene === "title") {
    renderTitle();
    last = now;
    requestAnimationFrame(frame);
    return;
  }
  update(Math.min(now - last, 100));
  last = now;
  render();
  requestAnimationFrame(frame);
}

void (async () => {
  try {
    await refreshWorld(true);
    allEvents = await fetchAllLog();
    weddingBook = foldLife(allEvents).book;
    checkQuests(false);
    rebuildTicker();
  } catch (error) {
    log.push(error instanceof Error ? error.message : "せかいに つながらない…");
    log.push("SSHトンネルと ゲームサーバーを かくにんしてね。");
  }
  setInterval(() => void poll(), 1500);
  requestAnimationFrame(frame);
})();
