// The village newspaper: world log events → Dragon Quest-style Japanese lines.

import type { LogEventView } from "../shared";

function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "?";
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

export function eventToMessage(event: LogEventView): string {
  const p = event.payload;
  switch (event.type) {
    case "region.founded":
      return `あたらしいむら「${str(p, "regionId")}」が たんじょうした!`;
    case "agent.admitted":
      return `${str(p, "id")}が むらの なかまに くわわった!`;
    case "agent.migrated":
      return `${str(p, "agentId")}は ${str(p, "toRegion")}へ ひっこした。`;
    case "agent.vouched":
      return `${str(p, "from")}は ${str(p, "to")}を ほしょうした!`;
    case "economy.settled":
      return settledLine(p);
    case "economy.minted":
      return `どこからともなく おかねが うまれた…`;
    case "item.minted":
      return `${str(p, "owner")}は 「${str(p, "itemKind")}」を てにいれた!`;
    case "item.transferred":
      return `${str(p, "from")}は ${str(p, "to")}に どうぐを ゆずった。`;
    case "region.institution.changed":
      return `むら「${str(p, "regionId")}」の おきてが かわった!`;
    case "gov.proposal.opened":
      return `むら「${str(p, "regionId")}」で ひょうけつが はじまった!`;
    case "gov.vote.cast":
      return `むら「${str(p, "regionId")}」で 1ぴょう とうじられた。`;
    case "region.lifecycle.changed":
      return `むら「${str(p, "regionId")}」の ようすが かわった。`;
    case "region.listed":
      return `むら「${str(p, "regionId")}」が うりに だされた!`;
    case "region.ownership.transferred":
      return `むら「${str(p, "regionId")}」の あるじが かわった!`;
    case "region.recognized":
      return `むら「${str(p, "regionId")}」が しょうにんされた!`;
    case "definition.put":
      return `せかいに あたらしい ことわりが きざまれた。`;
    default:
      return `なにかが おきた… (${event.type})`;
  }
}
