// The village newspaper: world log events → Dragon Quest-style Japanese lines.

import type { LogEventView } from "../shared";
import { AFTERLIFE, BYOKI, isChildName } from "./life";
import { classifyRegime, type GovernanceValue, REGIME_JA } from "./politics";
import { kindName } from "./shop";

/** First string found at any of the dot-paths — event payloads nest differently per type. */
function str(payload: Record<string, unknown>, ...paths: string[]): string {
  for (const path of paths) {
    let v: unknown = payload;
    for (const key of path.split(".")) {
      v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
    }
    if (typeof v === "string") return v;
  }
  return "?";
}

interface SettleEntry {
  agentId: string;
  currencyDelta: number;
}

function settledLine(payload: Record<string, unknown>): string {
  const entries = Array.isArray(payload["entries"]) ? (payload["entries"] as SettleEntry[]) : [];
  const payer = entries.find((e) => e.currencyDelta < 0);
  const payee = [...entries].filter((e) => e.currencyDelta > 0 && !e.agentId.startsWith("treasury@")).sort((a, b) => b.currencyDelta - a.currencyDelta)[0];
  if (payer && payee) return `${payer.agentId}は ${payee.agentId}に ${payee.currencyDelta}Gを わたした!`;
  return "だれかが とりひきを した。";
}

function vary(seq: number, ...variants: string[]): string {
  return variants[seq % variants.length] ?? variants[0] ?? "";
}

export function eventToMessage(event: LogEventView): string {
  const p = event.payload;
  const n = event.seq;
  switch (event.type) {
    case "region.founded":
      return `あたらしいむら「${str(p, "region.id", "regionId")}」が たんじょうした!`;
    case "agent.admitted": {
      const id = str(p, "admission.id", "id");
      if (isChildName(id)) return `${str(p, "admission.region")}に あかちゃんが うまれた! なまえは ${id.split("@")[0]}!`;
      return vary(n, `${id}が むらの なかまに くわわった!`, `${id}が ひっこしてきた。よろしくね!`, `あたらしい かおぶれ: ${id}`);
    }
    case "agent.migrated": {
      if (str(p, "toRegion") === AFTERLIFE) return `${str(p, "agentId")}が てんに めされた… やすらかに。`;
      return vary(n, `${str(p, "agentId")}は ${str(p, "toRegion")}へ ひっこした。`, `${str(p, "agentId")}、こころきかいを もとめて ${str(p, "toRegion")}へ。`, `たびだち: ${str(p, "agentId")} → ${str(p, "toRegion")}`);
    }
    case "agent.vouched":
      return vary(n, `${str(p, "from")}は ${str(p, "to")}を ほしょうした!`, `${str(p, "from")}、${str(p, "to")}に しんらいの ひとおし。`, `きずな: ${str(p, "from")} → ${str(p, "to")}`);
    case "economy.settled":
      return settledLine(p);
    case "economy.minted":
      return `どこからともなく おかねが うまれた…`;
    case "item.minted": {
      if (str(p, "kind") === BYOKI) return `${str(p, "owner")}が びょうきに かかった… おだいじに。`;
      return `${str(p, "owner")}は 「${kindName(str(p, "kind", "itemKind"))}」を てにいれた!`;
    }
    case "item.transferred": {
      if (str(p, "to").startsWith("treasury@")) return `${str(p, "from")}は びょういんで てあてを うけた。`;
      return `${str(p, "from")}は ${str(p, "to")}に どうぐを ゆずった。`;
    }
    case "region.institution.changed": {
      const policy = str(p, "change.policy");
      const rid = str(p, "regionId");
      if (policy === "economy") return `むら「${rid}」で ぜいせいかいかく! あたらしい ほうりつだ`;
      if (policy === "items") return `むら「${rid}」で ちゅうぞうほうが かいせいされた!`;
      if (policy === "diplomacy") return `むら「${rid}」が がいこうほうしんを あらためた`;
      if (policy === "governance") {
        const value = ((p as Record<string, unknown>)["change"] as Record<string, unknown> | undefined)?.["value"];
        const regime = value && typeof value === "object" ? classifyRegime(value as GovernanceValue) : null;
        return regime ? `むら「${rid}」は ${REGIME_JA[regime].label}に いこうした!` : `むら「${rid}」の せいじたいせいが かわった!`;
      }
      return `むら「${rid}」の おきてが かわった!`;
    }
    case "gov.proposal.opened":
      return `むら「${str(p, "regionId")}」で ひょうけつが はじまった!`;
    case "gov.vote.cast":
      return `むら「${str(p, "regionId")}」で 1ぴょう とうじられた。`;
    case "region.lifecycle.changed":
      return `むら「${str(p, "regionId")}」の ようすが かわった。`;
    case "region.listed":
      return `むら「${str(p, "regionId")}」が うりに だされた!`;
    case "region.ownership.transferred":
      return `ごうがい! むら「${str(p, "regionId")}」は ${str(p, "to")}けいれつに がっぺいされた!`;
    case "region.recognized":
      return `むら「${str(p, "regionId")}」が しょうにんされた!`;
    case "definition.put":
      return `せかいに あたらしい ことわりが きざまれた。`;
    default:
      return `なにかが おきた… (${event.type})`;
  }
}
