// Villager small talk: deterministic flavor lines drawn from an agent's real
// state (wealth, trust, role, belongings) so the world's economy is legible
// through conversation. Same agent, same state → same words for every player.

import type { AgentView, ItemView } from "../shared";
import { Biome } from "./map";
import { kindName } from "./shop";

function pick<T>(seedText: string, pool: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (Math.imul(h, 31) + seedText.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length] as T;
}

const GREETINGS: Record<string, readonly string[]> = {
  artisan: ["やあ、いいしごとしてるかい?", "きょうも こつこつ つくるのさ。", "しょくにんは うでが すべてさ。"],
  merchant: ["いらっしゃい! なにか かうかい?", "しょうばいは しんようだいいち!", "やすくしとくよ、みてって!"],
  broker: ["じょうほうなら まかせな。", "とりひきの なかだちは わたしのしごと。", "かねの ながれは よどまぬものさ。"],
};

const BIOME_TALK: Readonly<Record<Biome, readonly string[]>> = {
  [Biome.Plains]: ["ここらは のどかで いいところさ。", "かぜが きもちいい ひだね。"],
  [Biome.Forest]: ["もりの めぐみに かんしゃして いきてるのさ。", "きのねっこに つまずくなよ。"],
  [Biome.Desert]: ["…みず、もってるかい? ここじゃ いのちより たかい。", "あつさで あたまが くらくらするぜ。ようけんは てみじかにな。"],
  [Biome.Snow]: ["さむかったろう。ひに あたっていきな。", "ゆきの よるは ながい。だから はなしが うまくなるのさ。"],
  [Biome.Swamp]: ["ぬまの ゆうぐれは うつくしいぞ… みたことあるか?", "カエルの こえを かぞえていたら あさになった。"],
};

export function npcLines(agent: AgentView, worldItems: readonly ItemView[], regionOwner: string | null, biome: Biome = Biome.Plains): string[] {
  const lines: string[] = [];
  const seed = agent.id;

  lines.push(pick(seed, GREETINGS[agent.role] ?? ["こんにちは、たびのかた。"]));
  lines.push(pick(`${seed}b`, BIOME_TALK[biome]));

  const gold = agent.balances.currency;
  if (gold < 10) lines.push(pick(`${seed}p`, ["さいきん ふところが さむくてね…", "だれか めぐんでは くれんかのう。", "きょうの パンにも こまるありさまさ。"]));
  else if (gold >= 150) lines.push(pick(`${seed}r`, ["しょうばいは じゅんちょう、わらいがとまらん!", "かねは あるところには あるものさ。", "ちょっとした ざいさんを きずいてね。"]));

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
