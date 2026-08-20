// vouch quest — a DQ1-style pixel client over a live vouch world.
// The loop: render the overworld derived from the node's state, walk your hero,
// talk to agents (transfer / vouch / hand items), read village signboards
// (institutions / migrate / govern), and found new villages on empty land.
// Every action becomes a signed command; every world event scrolls the newspaper.

import type { AgentView, ItemView, LogEventView, Snapshot } from "../shared";
import { dayPhase, ParticleField, SkyShow, Weather, Wildlife } from "./ambience";
import { npcLines } from "./dialogue";
import { eventToMessage } from "./feed";
import { Biome, BIOME_JA, biomeAt, buildMap, heroSpawn, isSolid, MAP_H, MAP_W, placeNpcs, Tile, tileAt, type Village, type WorldMap } from "./map";
import { fetchAllLog, fetchWorld, postAct, postRegister } from "./net";
import { classifyRegime, type GovernanceValue, REGIME_COLOR, REGIME_JA, REGIMES } from "./politics";
import { heroStats, heroTitle, type QuestContext, questProgress, titleTier } from "./quests";
import { canShopHere, CATALOG, kindName, STANCE_COLOR, STANCE_JA, stanceToward } from "./shop";
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

function extraExtra(text: string): void {
  gogai = { text, until: performance.now() + 4600 };
  shakeUntil = performance.now() + 700;
  se("fanfare");
}
let scene: "title" | "game" = "title";
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
  return mobs.some((m) => m.x === x && m.y === y);
}

function walkable(x: number, y: number): boolean {
  return !!map && !isSolid(map, x, y) && !occupied(x, y);
}

async function refreshWorld(repositionHero: boolean): Promise<void> {
  const snap = await fetchWorld();
  snapshot = snap;
  map = buildMap(snap);
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
  // Wild critters, seeded per biome out in the open country.
  critters = [];
  for (let tries = 0; critters.length < 24 && tries < 400; tries++) {
    const cx = 4 + Math.floor(Math.random() * (MAP_W - 8));
    const cy = 4 + Math.floor(Math.random() * (MAP_H - 8));
    if (isSolid(map, cx, cy) || map.villages.some((v) => cx >= v.x && cx < v.x + v.w && cy >= v.y && cy < v.y + v.h)) continue;
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
        const entries = (p["entries"] as { agentId?: string }[] | undefined) ?? [];
        const at = villageCenterPx(regionOfAgent(entries[0]?.agentId ?? null));
        if (at) particles.sparkle(at[0], at[1], "#ffd75e");
        break;
      }
      case "agent.vouched": {
        const at = villageCenterPx(regionOfAgent(pick(p, "to")));
        if (at) particles.sparkle(at[0], at[1], "#ff9de2");
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
  const folk = snapshot.agents.filter((a) => a.role !== "treasury");
  const richest = [...folk].sort((a, b) => b.balances.currency - a.balances.currency)[0];
  const trusted = [...folk].sort((a, b) => b.trust - a.trust)[0];
  const newest = snapshot.regions[snapshot.regions.length - 1];
  const items = [
    ...allEvents.slice(-4).map((e) => eventToMessage(e)),
    richest ? `ちょうじゃ: ${richest.id} (${richest.balances.currency}G)` : "",
    trusted && trusted.trust > 0 ? `しんらいNo.1: ${trusted.id} (しんらい${trusted.trust})` : "",
    newest ? `さいしんのむら: ${newest.displayName}` : "",
    `むら${snapshot.regions.length} / じゅうみん${folk.length}にん / できごと${snapshot.logLength}`,
  ].filter((t) => t.length > 0);
  tickerText = items.join("  ◆  ");
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

function npcMenu(mob: Mob): void {
  const a = mob.agent;
  const items = myItems();
  ui.push(
    new Menu(
      a.id,
      [
        { label: "はなす", value: "talk" },
        { label: "ゴールドを わたす", value: "gold" },
        { label: "ほしょうする", value: "vouch" },
        { label: "どうぐを わたす", value: "item", disabled: items.length === 0 },
        { label: "やめる", value: "cancel" },
      ],
      (value) => {
        if (value === "talk") {
          const owner = snapshot?.regions.find((r) => r.id === a.region)?.owner ?? null;
          ui.push(
            new Info(a.id, [
              ...npcLines(a, snapshot?.items ?? [], owner, map?.villages.find((v) => v.regionId === a.region)?.biome ?? Biome.Plains),
              "",
              `しょくぎょう: ${roleJa(a.role)}`,
              `しょじきん: ${a.balances.currency}G  くれじっと: ${a.balances.credit}`,
              `ひょうばん: ${a.reputation}  しんらい: ${a.trust}`,
              `すんでいるむら: ${a.region}`,
            ], () => ui.pop()),
          );
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
      `あるじ: ${region.owner ?? "なし"}  じょうたい: ${region.lifecycle}`,
      `きこう: ${BIOME_JA[map?.villages.find((v) => v.regionId === region.id)?.biome ?? Biome.Plains]}  はってん: ${["むら", "まち", "とし"][map?.villages.find((v) => v.regionId === region.id)?.tier ?? 0]}`,
      `せいじ: ${REGIME_JA[classifyRegime(region.institutions.governance as GovernanceValue)].label}`,
      `どうぐづくり: ${ctx.mintingOpen ? "だれでも" : "あるじのみ"}`,
      `ぜいりつ: ${region.institutions.economyPolicy.baseCostRate} (さいてい ${region.institutions.economyPolicy.minCostRate})`,
      `きんこ: ${treasury?.balances.currency ?? 0}G  じゅうみん: ${residents.length}にん`,
      ...residents.map((r) => `  ${r.id} (${roleJa(r.role)}) ${r.balances.currency}G`),
      region.openProposal ? `ひょうけつちゅう! とうひょう ${region.openProposal.votes.length}` : "ひょうけつは ない",
    ], () => ui.pop()),
  );
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
function hallMenu(village: Village): void {
  const ctx = villageContext(village);
  if (!ctx) return;
  const { region } = ctx;
  ui.push(
    new Menu(`${region.displayName} やくば`, [
      { label: "むらの じょうほう", value: "info" },
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
      if (value === "info") villageInfo(ctx);
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
      { label: "しんらいの だいちょう", value: "trust" },
      { label: "やめる", value: "cancel" },
    ], (value) => {
      if (value === "proposal") {
        ui.push(
          new Info("ひょうけつ", region.openProposal
            ? [
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
          ], (v) => {
            if (v === "minting") {
              void runAct({ kind: "proposeMinting", regionId: region.id, minting: ctx.mintingOpen ? "owner" : "anyone" }, "おきてを ていあんする");
            } else {
              regimePicker(region.id, "propose");
            }
          }, () => ui.pop()),
        );
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
  ui.push(
    new Menu(`${region.displayName}の どうぐや (もちがね ${gold}G)`, [
      ...CATALOG.map((w) => ({ label: `${w.name}  ${w.price}G`, value: w.kind, disabled: gold < w.price })),
      { label: "やめる", value: "cancel" },
    ], (kind) => {
      if (kind === "cancel") return ui.clear();
      const ware = CATALOG.find((w) => w.kind === kind);
      if (!ware) return ui.clear();
      ui.push(
        new Menu(`${ware.name} — ${ware.blurb} ${ware.price}Gで かう?`, [
          { label: "かう", value: "yes" },
          { label: "やめる", value: "no" },
        ], (v) => {
          if (v === "yes") void runAct({ kind: "buyItem", regionId: region.id, ware: ware.kind }, `${ware.name}を かう`);
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
      { label: "やめる", value: "cancel" },
    ], (rid) => {
      if (rid === "cancel") return ui.clear();
      const dest = map?.villages.find((v) => v.regionId === rid);
      if (dest) {
        player.x = dest.gate[0];
        player.y = dest.gate[1] + 1;
        player.px = player.x * CELL;
        player.py = player.y * CELL;
        se("coin");
        log.push(`でんしゃに のって ${dest.displayName}へ ついた!`);
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
  ui.push(new Info(`クエストちょう (${doneCount}/${rows.length})`, rows, () => ui.pop()));
}

function worldRecords(): void {
  const m = snapshot;
  if (!m) return;
  const folk = m.agents.filter((a) => a.role !== "treasury");
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
        { label: "どうぐ", value: "items" },
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
                ]
              : ["まだ どこにも すんでいない。", "「むらを たてる」で じぶんのむらを つくろう!"], () => ui.pop()),
          );
        } else if (value === "items") {
          const items = myItems();
          ui.push(new Info("どうぐぶくろ", items.length ? items.map((i) => `${kindName(i.kind)} (${i.id})`) : ["なにも もっていない。"], () => ui.pop()));
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
    ui.push(new Info("いきもの", lines[critter.kind] ?? ["なにかが いる。"], () => ui.pop()));
    return;
  }
  const tile = tileAt(map, fx, fy);
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
  if (tile === Tile.Poster) {
    const village = map.villages.find((v) => v.poster[0] === fx && v.poster[1] === fy);
    if (village) return posterMenu(village);
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
};
const MINI_SCALE = 3;
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
  if (walkable(nx, ny)) {
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
    if (map && !isSolid(map, nx, ny) && !map.villages.some((v) => nx >= v.x && nx < v.x + v.w && ny >= v.y && ny < v.y + v.h)) {
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
      const step = 1.6 * (dt / 16.7);
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
        ...home.spots,
        ...mobs.filter((o) => o !== mob && o.home === home).map((o) => [o.x, o.y] as const),
      ];
      mob.target = pois[Math.floor(Math.random() * pois.length)] ?? null;
    }

    let dx = 0;
    let dy = 0;
    if (mob.target) {
      const [gx2, gy2] = mob.target;
      if (mob.x === gx2 && mob.y === gy2) mob.target = null;
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
    const inside = !home || (nx > home.x && nx < home.x + home.w - 1 && ny > home.y && ny < home.y + home.h - 1);
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
  const pool = ["やあ!", "きいたかい?", "もうかった?", "いいてんきだ", "せいが でるね"];
  return pool[Math.floor(Math.random() * pool.length)] ?? "やあ!";
}

function replyLine(mob: Mob): string {
  if (mob.agent.balances.currency < 10) return "ごちそうしてくれ…";
  const pool = ["うんうん", "なるほどね", "はっはっは", "ぼちぼちさ", "そうかい?"];
  return pool[Math.floor(Math.random() * pool.length)] ?? "うんうん";
}

function render(): void {
  if (!ctx) return;
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

  const lights: (readonly [number, number])[] = [];
  for (let y = y0; y <= y0 + Math.ceil(h / CELL); y++) {
    for (let x = x0; x <= x0 + Math.ceil(w / CELL); x++) {
      const t = tileAt(map, x, y);
      const sprite = sprites.tiles.get(t);
      if (sprite) ctx.drawImage(sprite, x * CELL - camX, y * CELL - camY);
      if (t === Tile.Lamp || t === Tile.WallWindow || t === Tile.WallWoodWindow) lights.push([x, y] as const);
    }
  }

  for (const village of map.villages) {
    drawText(ctx, `${village.displayName} (${BIOME_JA[village.biome]})`, village.x * CELL - camX + 8, (village.y - 1) * CELL - camY + 20, "#ffd75e");
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
    const pair = sprites.roles[mob.agent.role] ?? sprites.roles["artisan"];
    if (pair) ctx.drawImage(pair[mob.frame === 0 ? 0 : 1], mob.px - camX, mob.py - camY);
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
    ctx.fillText(mob.bubble.text, bx + 7, by + 14);
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

  // Trains shuttle along the rails, back and forth.
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
      const py = pt[1] * CELL - camY + 10;
      ctx.fillStyle = car === 0 ? "#c23a2e" : "#e8e8e8";
      ctx.fillRect(px, py, 36, 24);
      ctx.fillStyle = "#2a3a55";
      ctx.fillRect(px + 5, py + 5, 10, 8);
      ctx.fillRect(px + 21, py + 5, 10, 8);
    }
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
      const gx2 = lx * CELL - camX + CELL / 2;
      const gy2 = ly * CELL - camY + CELL / 2;
      const grad = ctx.createRadialGradient(gx2, gy2, 4, gx2, gy2, 70);
      grad.addColorStop(0, "rgba(255, 214, 110, 0.30)");
      grad.addColorStop(1, "rgba(255, 214, 110, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(gx2 - 70, gy2 - 70, 140, 140);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // HUD
  const hero = heroAgent();
  drawWindow(ctx, 12, 40, 264, hero ? 164 : 66);
  drawText(ctx, snapshot.me.heroName ?? "ななしの たびびと", 32, 56, "#ffd75e");
  if (hero) {
    ctx.font = '15px "DotGothic16", monospace';
    ctx.fillStyle = "#8fd0ff";
    ctx.fillText(title, 32, 84);
    drawText(ctx, `G: ${hero.balances.currency}`, 32, 108);
    drawText(ctx, `しんらい: ${hero.trust}`, 32, 134);
    drawText(ctx, `ひょうばん: ${hero.reputation}`, 32, 160);
  }

  // かわらばん — the scrolling headline bar.
  if (tickerText.length > 0) {
    ctx.fillStyle = "rgba(0, 6, 20, 0.82)";
    ctx.fillRect(0, 0, w, 30);
    ctx.font = '16px "DotGothic16", monospace';
    const label = "かわらばん ▶ ";
    ctx.fillStyle = "#ffd75e";
    ctx.fillText(label, 10, 21);
    const labelW = ctx.measureText(label).width + 16;
    const textW = ctx.measureText(tickerText).width + 120;
    if (tickerX < -textW) tickerX = w - labelW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(labelW, 0, w - labelW, 30);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(tickerText, labelW + tickerX, 21);
    ctx.fillText(tickerText, labelW + tickerX + textW, 21);
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
      const text = `かいひょうそくほう ${r.displayName}: さんせい ${got} / ひつよう ${need}`;
      const bw2 = ctx.measureText(text).width + 40;
      const bx2 = (w - bw2) / 2;
      drawWindow(ctx, bx2, 36, bw2, 66);
      ctx.fillStyle = "#ffd75e";
      ctx.fillText(text, bx2 + 20, 58);
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
    ctx.fillText(nextGoal, w - gw + 3, 66);
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
      const tw2 = ctx.measureText(gogai.text).width;
      ctx.fillText(gogai.text, Math.max((w - tw2) / 2, 20) - slide, 172);
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

let last = performance.now();
function frame(now: number): void {
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
    checkQuests(false);
    rebuildTicker();
  } catch (error) {
    log.push(error instanceof Error ? error.message : "せかいに つながらない…");
    log.push("SSHトンネルと ゲームサーバーを かくにんしてね。");
  }
  setInterval(() => void poll(), 1500);
  requestAnimationFrame(frame);
})();
