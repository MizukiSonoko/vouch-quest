// vouch quest — a DQ1-style pixel client over a live vouch world.
// The loop: render the overworld derived from the node's state, walk your hero,
// talk to agents (transfer / vouch / hand items), read village signboards
// (institutions / migrate / govern), and found new villages on empty land.
// Every action becomes a signed command; every world event scrolls the newspaper.

import type { AgentView, ItemView, Snapshot } from "../shared";
import { eventToMessage } from "./feed";
import { buildMap, heroSpawn, isSolid, MAP_H, MAP_W, placeNpcs, Tile, tileAt, type Village, type WorldMap } from "./map";
import { fetchLog, fetchWorld, postAct, postRegister } from "./net";
import { buildSprites, CELL } from "./sprites";
import { drawText, drawWindow, Info, Menu, MessageLog, TextInput, UiStack } from "./ui";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("canvas 2d context unavailable");
ctx.imageSmoothingEnabled = false;

const sprites = buildSprites();
const ui = new UiStack();
const log = new MessageLog();

interface Mob {
  readonly agent: AgentView;
  x: number;
  y: number;
  px: number;
  py: number;
  timer: number;
  frame: number;
  home: Village | undefined;
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
let lastSeq = 0;
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
  }));
  lastSeq = snap.logLength;
  if (repositionHero || isSolid(map, player.x, player.y)) {
    const [sx, sy] = heroSpawn(snap, map);
    player.x = sx;
    player.y = sy;
    player.px = sx * CELL;
    player.py = sy * CELL;
    player.moving = false;
  }
}

// ---- actions -------------------------------------------------------------

async function runAct(action: Record<string, unknown>, doing: string): Promise<void> {
  ui.clear();
  log.push(`${doing}…`);
  try {
    const result = await postAct(action);
    if (result.ok) {
      await refreshWorld(false);
    } else {
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
          ui.push(
            new Info(a.id, [
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
              items.map((i) => ({ label: `${i.kind} (${i.id})`, value: i.id })),
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

function signMenu(village: Village): void {
  const region = snapshot?.regions.find((r) => r.id === village.regionId);
  if (!region || !snapshot) return;
  const hero = heroAgent();
  const isOwner = region.owner === snapshot.me.heroName;
  const livesHere = hero?.region === region.id;
  const mintingOpen = region.institutions.itemPolicy.minting === "anyone";
  const entries = [
    { label: "むらの じょうほう", value: "info" },
    { label: "この むらに ひっこす", value: "migrate", disabled: !hero || livesHere },
    { label: "とうひょうする", value: "vote", disabled: !region.openProposal || !livesHere },
    { label: "どうぐを つくる", value: "mint", disabled: !(isOwner || (mintingOpen && livesHere)) },
    { label: "いじゅうしゃを まねく", value: "admit", disabled: !isOwner },
    { label: "おきてを かえる (どうぐ)", value: "amend", disabled: !isOwner || region.institutions.governance.kind !== "dictatorship" },
    { label: "やめる", value: "cancel" },
  ];
  ui.push(
    new Menu(`${region.displayName} のたてふだ`, entries, (value) => {
      if (value === "info") {
        const residents = snapshot?.agents.filter((a) => a.region === region.id && a.role !== "treasury") ?? [];
        const treasury = snapshot?.agents.find((a) => a.id === `treasury@${region.id}`);
        ui.push(
          new Info(`むら「${region.displayName}」(${region.id})`, [
            `あるじ: ${region.owner ?? "なし"}  じょうたい: ${region.lifecycle}`,
            `せいじ: ${region.institutions.governance.kind === "dictatorship" ? "どくさいせい" : "ひょうぎかい"}`,
            `どうぐづくり: ${mintingOpen ? "だれでも" : "あるじのみ"}`,
            `ぜいりつ: ${region.institutions.economyPolicy.baseCostRate} (さいてい ${region.institutions.economyPolicy.minCostRate})`,
            `きんこ: ${treasury?.balances.currency ?? 0}G  じゅうみん: ${residents.length}にん`,
            ...residents.map((r) => `  ${r.id} (${roleJa(r.role)}) ${r.balances.currency}G`),
            region.openProposal ? `ひょうけつちゅう! とうひょう ${region.openProposal.votes.length}` : "ひょうけつは ない",
          ], () => ui.pop()),
        );
      } else if (value === "migrate") {
        void runAct({ kind: "migrate", toRegion: region.id }, `${region.id}へ ひっこす`);
      } else if (value === "vote") {
        void runAct({ kind: "vote", regionId: region.id }, "とうひょうする");
      } else if (value === "mint") {
        ui.push(
          new TextInput("なにを つくる? (romaji: sword, tsubo…)", { lowercase: true, maxLen: 16 }, (kind) => {
            const owner = snapshot?.me.agentId;
            if (owner) void runAct({ kind: "mintItem", itemKind: kind, owner }, `「${kind}」を つくる`);
          }, () => ui.pop()),
        );
      } else if (value === "admit") {
        ui.push(
          new TextInput("だれを まねく? (なまえ: romaji)", { maxLen: 16 }, (agentName) => {
            ui.push(
              new Menu(
                "しょくぎょうは?",
                [
                  { label: "しょくにん (artisan)", value: "artisan" },
                  { label: "しょうにん (merchant)", value: "merchant" },
                  { label: "なかがいにん (broker)", value: "broker" },
                ],
                (role) => void runAct({ kind: "admit", agentName, region: region.id, role, currency: 50 }, `${agentName}を まねく`),
                () => ui.pop(),
              ),
            );
          }, () => ui.pop()),
        );
      } else if (value === "amend") {
        const next = mintingOpen ? "owner" : "anyone";
        void runAct({ kind: "amendMinting", regionId: region.id, minting: next }, `どうぐづくりの おきてを かえる`);
      } else ui.clear();
    }, () => ui.clear()),
  );
}

function fieldMenu(): void {
  const hero = heroAgent();
  ui.push(
    new Menu(
      "コマンド?",
      [
        { label: "つよさ", value: "status" },
        { label: "どうぐ", value: "items" },
        { label: "むらを たてる", value: "found" },
        { label: "せかいの きろく", value: "world" },
        { label: "やめる", value: "cancel" },
      ],
      (value) => {
        if (value === "status") {
          ui.push(
            new Info(snapshot?.me.heroName ?? "たびびと", hero
              ? [
                  `エージェント: ${hero.id}`,
                  `しょじきん: ${hero.balances.currency}G  くれじっと: ${hero.balances.credit}`,
                  `ひょうばん: ${hero.reputation}  しんらい: ${hero.trust}`,
                  `すんでいるむら: ${hero.region}`,
                ]
              : ["まだ どこにも すんでいない。", "「むらを たてる」で じぶんのむらを つくろう!"], () => ui.pop()),
          );
        } else if (value === "items") {
          const items = myItems();
          ui.push(new Info("どうぐぶくろ", items.length ? items.map((i) => `${i.kind} (${i.id})`) : ["なにも もっていない。"], () => ui.pop()));
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
          const m = snapshot;
          ui.push(
            new Info("せかいの きろく", m
              ? [
                  `むらのかず: ${m.regions.length}`,
                  `じゅうみん: ${m.agents.filter((a) => a.role !== "treasury").length}にん`,
                  `どうぐ: ${m.items.length}こ`,
                  `できごとのかず: ${m.logLength}`,
                ]
              : ["…"], () => ui.pop()),
          );
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
  const tile = tileAt(map, fx, fy);
  if (tile === Tile.Sign) {
    const village = map.villages.find((v) => v.sign[0] === fx && v.sign[1] === fy);
    if (village) return signMenu(village);
  }
  if (tile === Tile.Chest) {
    const village = map.villages.find((v) => v.chest[0] === fx && v.chest[1] === fy);
    const treasury = snapshot.agents.find((a) => a.id === `treasury@${village?.regionId}`);
    if (village) return ui.push(new Info(`${village.displayName}の きんこ`, [`むらの きんこには ${treasury?.balances.currency ?? 0}G はいっている。`, "てをふれては いけない きがする…"], () => ui.pop()));
  }
  fieldMenu();
}

function roleJa(role: string): string {
  return { artisan: "しょくにん", merchant: "しょうにん", broker: "なかがいにん", treasury: "きんこばん" }[role] ?? role;
}

// ---- input ----------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  if (ui.active) {
    ui.handleKey(e.key);
    return;
  }
  if (e.key === "Enter" || e.key === " " || e.key === "z") interact();
  else held.add(e.key);
});
window.addEventListener("keyup", (e) => held.delete(e.key));

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
  // Player: tween toward the target tile; accept a new step when settled.
  const tx = player.x * CELL;
  const ty = player.y * CELL;
  if (player.px !== tx || player.py !== ty) {
    const step = SPEED * (dt / 16.7);
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

  // NPCs: wander within their village fence.
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
    mob.timer -= dt;
    if (mob.timer > 0) continue;
    mob.timer = 800 + Math.random() * 2200;
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const;
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)] ?? [0, 0];
    const nx = mob.x + dx;
    const ny = mob.y + dy;
    const home = mob.home;
    const inside = !home || (nx > home.x && nx < home.x + 17 && ny > home.y && ny < home.y + 12);
    if (inside && walkable(nx, ny) && !(nx === player.x && ny === player.y)) {
      mob.x = nx;
      mob.y = ny;
    }
  }
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

  const camX = Math.max(0, Math.min(player.px - w / 2 + CELL / 2, MAP_W * CELL - w));
  const camY = Math.max(0, Math.min(player.py - h / 2 + CELL / 2, MAP_H * CELL - h));
  const x0 = Math.floor(camX / CELL);
  const y0 = Math.floor(camY / CELL);

  for (let y = y0; y <= y0 + Math.ceil(h / CELL); y++) {
    for (let x = x0; x <= x0 + Math.ceil(w / CELL); x++) {
      const sprite = sprites.tiles.get(tileAt(map, x, y));
      if (sprite) ctx.drawImage(sprite, x * CELL - camX, y * CELL - camY);
    }
  }

  for (const village of map.villages) {
    drawText(ctx, village.displayName, village.x * CELL - camX + 8, (village.y - 1) * CELL - camY + 20, "#ffd75e");
  }

  for (const mob of mobs) {
    const pair = sprites.roles[mob.agent.role] ?? sprites.roles["artisan"];
    if (pair) ctx.drawImage(pair[mob.frame === 0 ? 0 : 1], mob.px - camX, mob.py - camY);
  }
  ctx.drawImage(sprites.hero[player.frame === 0 ? 0 : 1], player.px - camX, player.py - camY);

  // HUD
  const hero = heroAgent();
  drawWindow(ctx, 12, 12, 250, hero ? 140 : 66);
  drawText(ctx, snapshot.me.heroName ?? "ななしの たびびと", 32, 28, "#ffd75e");
  if (hero) {
    drawText(ctx, `G: ${hero.balances.currency}`, 32, 56);
    drawText(ctx, `しんらい: ${hero.trust}`, 32, 82);
    drawText(ctx, `ひょうばん: ${hero.reputation}`, 32, 108);
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
    const events = (await fetchLog(lastSeq)).filter((e) => e.seq >= lastSeq);
    if (events.length > 0) {
      for (const event of events) log.push(`▶ ${eventToMessage(event)}`);
      await refreshWorld(false);
    }
  } catch {
    // The node blinked; the next poll retries. Movement should not stutter for it.
  }
}

let last = performance.now();
function frame(now: number): void {
  update(Math.min(now - last, 100));
  last = now;
  render();
  requestAnimationFrame(frame);
}

void (async () => {
  try {
    await refreshWorld(true);
    onboard();
  } catch (error) {
    log.push(error instanceof Error ? error.message : "せかいに つながらない…");
    log.push("SSHトンネルと ゲームサーバーを かくにんしてね。");
  }
  setInterval(() => void poll(), 2500);
  requestAnimationFrame(frame);
})();
