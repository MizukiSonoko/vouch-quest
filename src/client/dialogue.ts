// Villager small talk: deterministic flavor lines drawn from an agent's real
// state (wealth, trust, role, belongings) so the world's economy is legible
// through conversation. Same agent, same state → same words for every player.

import type { AgentView, ItemView } from "../shared";
import { Biome } from "./map";
import { kindName } from "./shop";

function hashOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}

function pick<T>(seedText: string, pool: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (Math.imul(h, 31) + seedText.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length] as T;
}

const GREETINGS: Record<string, readonly string[]> = {
  artisan: [
    "やあ、いいしごとしてるかい?",
    "きょうも こつこつ つくるのさ。",
    "しょくにんは うでが すべてさ。",
    "けずって みがいて はや ん十ねん。",
    "どうぐは うらぎらない。ひとと ちがってな。",
    "この まちの かなものは ぜんぶ わしの しごとさ。",
  ],
  merchant: [
    "いらっしゃい! なにか かうかい?",
    "しょうばいは しんようだいいち!",
    "やすくしとくよ、みてって!",
    "となりまちの そうばは しってるかい?",
    "きょうは でんしゃで しいれてきたんだ。",
    "ぜいりつが さがれば もっと やすくできるんだがねえ。",
  ],
  broker: [
    "じょうほうなら まかせな。",
    "とりひきの なかだちは わたしのしごと。",
    "かねの ながれは よどまぬものさ。",
    "ぎんこうの りしは 1わり。おぼえておきな。",
    "しんらいが あれば てすうりょうは やすくなる。これ ほんとう。",
    "うわさじゃ どこかの むらが がっぺいされるらしい…",
  ],
};

const CHILD_TALK = ["あそぼー!", "おとな って いそがしそう!", "おおきくなったら しょうにんに なるんだ!", "ねえねえ、スライム みたことある?"];
const ELDER_TALK = ["わしが わかいころは むらに さくも なかったよ…", "ながいきの ひけつは まいにちの さんぽじゃ。", "この むらの れきしは ぜんぶ みてきた。", "そろそろ おむかえが くるかのう…"];

const BIOME_TALK: Readonly<Record<Biome, readonly string[]>> = {
  [Biome.Plains]: ["ここらは のどかで いいところさ。", "かぜが きもちいい ひだね。"],
  [Biome.Forest]: ["もりの めぐみに かんしゃして いきてるのさ。", "きのねっこに つまずくなよ。"],
  [Biome.Desert]: ["…みず、もってるかい? ここじゃ いのちより たかい。", "あつさで あたまが くらくらするぜ。ようけんは てみじかにな。"],
  [Biome.Snow]: ["さむかったろう。ひに あたっていきな。", "ゆきの よるは ながい。だから はなしが うまくなるのさ。"],
  [Biome.Swamp]: ["ぬまの ゆうぐれは うつくしいぞ… みたことあるか?", "カエルの こえを かぞえていたら あさになった。"],
};

/** Merge genome chatter pools into the live vocabulary (data only, capped). */
export function registerChatter(pools: Readonly<Record<string, readonly string[]>>): void {
  for (const [key, lines] of Object.entries(pools)) {
    const seen = new Set([...CHILD_TALK, ...ELDER_TALK, ...CITY_TALK, ...HAMLET_TALK, ...FESTIVAL_TALK, ...MARRIED_TALK, ...POWER_TALK, ...DARK_TALK, ...Object.values(GREETINGS).flat()]);
    const clean = lines.filter((l) => typeof l === "string" && l.length > 0 && l.length <= 64 && !seen.has(l)).slice(0, 100);
    if (clean.length === 0) continue;
    if (key === "child") CHILD_TALK.push(...clean);
    else if (key === "elder") ELDER_TALK.push(...clean);
    else if (key === "city") CITY_TALK.push(...clean);
    else if (key === "hamlet") HAMLET_TALK.push(...clean);
    else if (key === "festival") FESTIVAL_TALK.push(...clean);
    else if (key === "married") MARRIED_TALK.push(...clean);
    else if (key === "power") POWER_TALK.push(...clean);
    else if (key === "dark") DARK_TALK.push(...clean);
    else if (key === "artisan" || key === "merchant" || key === "broker") GREETINGS[key] = [...(GREETINGS[key] ?? []), ...clean];
    else for (const role of Object.keys(GREETINGS)) GREETINGS[role] = [...(GREETINGS[role] ?? []), ...clean];
  }
}

export interface TalkContext {
  readonly powered?: boolean;
  readonly tier?: number;
  readonly married?: boolean;
  readonly festival?: boolean;
}

const POWER_TALK = ["よるも まどが あかるくて べんりに なったよ。", "でんき だいって なんだろうね?", "へんでんしょの おとが ぶーんと いってる。"];
const DARK_TALK = ["よるは ランタンだけが たよりさ。", "はやく でんきが きてほしいねえ。", "くらく なるまえに かえりな。"];
const CITY_TALK = ["ビルの まどそうじは たいへんらしい。", "えきまえは いつも にぎやかだ。", "とかいの くらしにも なれたよ。"];
const HAMLET_TALK = ["なにも ないが、それが いいのさ。", "みんな かおみしりの ちいさな むらさ。"];
const MARRIED_TALK = ["うちの ひとが まってるんでね。", "けっこん してから まいにちが たのしいよ。"];
const FESTIVAL_TALK = ["まつりだ まつりだ!", "やたいの セール、みたかい?"];

export function npcLines(
  agent: AgentView,
  worldItems: readonly ItemView[],
  regionOwner: string | null,
  biome: Biome = Biome.Plains,
  age = 500,
  isChild = false,
  ctx: TalkContext = {},
): string[] {
  const lines: string[] = [];
  const seed = agent.id;

  if (isChild) lines.push(pick(seed, CHILD_TALK));
  else if (age > 800) lines.push(pick(seed, ELDER_TALK));
  else lines.push(pick(seed, GREETINGS[agent.role] ?? ["こんにちは、たびのかた。"]));
  lines.push(pick(`${seed}b`, BIOME_TALK[biome]));
  if (ctx.festival) lines.push(pick(`${seed}f`, FESTIVAL_TALK));
  else if (ctx.married && !isChild) lines.push(pick(`${seed}m`, MARRIED_TALK));
  else if ((ctx.tier ?? 0) >= 2) lines.push(pick(`${seed}c`, CITY_TALK));
  else if ((ctx.tier ?? 0) === 0 && !isChild) lines.push(pick(`${seed}h`, HAMLET_TALK));
  if (ctx.powered !== undefined && Math.abs(hashOf(seed)) % 3 === 0) lines.push(pick(`${seed}p2`, ctx.powered ? POWER_TALK : DARK_TALK));

  const gold = agent.balances.currency;
  if (gold < 10) lines.push(pick(`${seed}p`, ["さいきん ふところが さむくてね…", "だれか めぐんでは くれんかのう。", "きょうの パンにも こまるありさまさ。"]));
  else if (gold >= 150) lines.push(pick(`${seed}r`, ["しょうばいは じゅんちょう、わらいがとまらん!", "かねは あるところには あるものさ。", "ちょっとした ざいさんを きずいてね。", "とんだ かねもちに なっちまった。こまってる ひとには ほどこすのさ。"]));

  if (agent.trust >= 5) lines.push("みんなが わたしを しんじてくれる。ありがたいことだ。");
  else if (agent.trust === 0 && agent.reputation === 0) lines.push("この むらでは まだ かおが うれていなくてね。");

  if (agent.reputation >= 5) lines.push("とりひきの つみかさねが ひょうばんを つくるのさ。");

  const belongings = worldItems.filter((i) => i.owner === agent.id);
  const first = belongings[0];
  if (first) lines.push(`この「${kindName(first.kind)}」は たからものさ。`);

  const heroName = agent.id.split("@")[0];
  if (regionOwner && heroName === regionOwner) lines.push("なにを かくそう、この むらの あるじは わたしだ。");

  return lines;
}
