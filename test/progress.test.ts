import { describe, expect, test } from "bun:test";
import { foldProgress, levelFromXp, xpForLevel } from "../src/client/progress";
import type { LogEventView } from "../src/shared";

const ev = (seq: number, type: string, payload: Record<string, unknown>): LogEventView =>
  ({ seq, tick: 0, type, actor: "world", payload }) as unknown as LogEventView;

describe("the fun spine — XP folded from real deeds", () => {
  test("levels are monotonic and start at 1", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(5))).toBe(5);
    expect(xpForLevel(6)).toBeGreaterThan(xpForLevel(5));
  });

  test("deeds become XP; strangers' deeds do not", () => {
    const me = "Rei@asahi";
    const events = [
      ev(0, "economy.settled", { entries: [{ agentId: me, currencyDelta: -5 }, { agentId: "Bob@asahi", currencyDelta: 5 }] }),
      ev(1, "agent.vouched", { from: me, to: "Bob@asahi" }),
      ev(2, "item.minted", { owner: me, kind: "bldtree10x10" }),
      ev(3, "item.minted", { owner: me, kind: "wagashi" }),
      ev(4, "agent.vouched", { from: "X@y", to: "X2@y" }),
      ev(5, "economy.settled", { entries: [{ agentId: "A@b", currencyDelta: -3 }, { agentId: "C@b", currencyDelta: 3 }] }),
    ];
    const p = foldProgress(events, me, "Rei");
    expect(p.trades).toBe(1);
    expect(p.vouchesGiven).toBe(1);
    expect(p.builds).toBe(1);
    expect(p.crafts).toBe(1);
    expect(p.xp).toBeGreaterThanOrEqual(3 + 2 + 10 + 4);
    const stranger = foldProgress(events, "Nobody@nowhere", "Nobody");
    expect(stranger.xp).toBe(0);
  });

  test("era goals are deterministic and progress within the era", () => {
    const events: LogEventView[] = [];
    for (let i = 0; i < 20; i++) events.push(ev(i, "system.tick", {}));
    const a = foldProgress(events, "Rei@asahi", "Rei");
    const b = foldProgress(events, "Rei@asahi", "Rei");
    expect(a.goals.map((g) => g.label)).toEqual(b.goals.map((g) => g.label));
    expect(a.goals.length).toBeGreaterThan(0);
    expect(a.goals.length).toBeLessThanOrEqual(3);
  });
});
