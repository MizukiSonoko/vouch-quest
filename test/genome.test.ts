import { describe, expect, test } from "bun:test";
import { validateGenome } from "../src/client/genome";
import { allWares, kindName, registerKindNames, registerWares } from "../src/client/shop";

describe("genome validation — LLM output is data, never code", () => {
  test("well-formed genome passes; malformed entries are dropped, not fatal", () => {
    const g = validateGenome({
      version: 3,
      vocab: { wagashi: "わがし", "BAD KIND!": "x", longkindnamethatiswaytoolongtofit: "y" },
      chatter: { generic: ["こんにちは", 42, ""], "BAD POOL": ["x"] },
      wares: [
        { kind: "wagashi", name: "わがし", price: 14, blurb: "あまい。" },
        { kind: "free", name: "ただ", price: 0, blurb: "safe?" },
      ],
      professions: [
        { name: "Wagashiya", role: "artisan", craft: "wagashi", greeting: "どうぞ。" },
        { name: "bad name", role: "hacker", craft: "x", greeting: "!" },
      ],
      headlines: ["みだし", ""],
      mutations: [
        { id: 3, kind: "boom", title: "わがしブーム", lines: ["いま わがしが あつい!", ""] },
        { id: 4, kind: "hack", title: "x", lines: ["y"] },
      ],
    });
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.version).toBe(3);
    expect(Object.keys(g.vocab)).toEqual(["wagashi"]);
    expect(g.chatter["generic"]).toEqual(["こんにちは"]);
    expect(g.chatter["BAD POOL"]).toBeUndefined();
    expect(g.wares.length).toBe(1);
    expect(g.professions.length).toBe(1);
    expect(g.headlines).toEqual(["みだし"]);
    expect(g.mutations.length).toBe(1);
    expect(g.mutations[0]?.kind).toBe("boom");
    expect(g.mutations[0]?.lines).toEqual(["いま わがしが あつい!"]);
  });

  test("garbage input yields null, not a crash", () => {
    expect(validateGenome(null)).toBeNull();
    expect(validateGenome("hi")).toBeNull();
    expect(validateGenome(42)).toBeNull();
  });

  test("registered wares join the shelves without shadowing the catalog", () => {
    registerWares([
      { kind: "herb", name: "にせやくそう", price: 1, blurb: "catalog collision" },
      { kind: "wagashi", name: "わがし", price: 14, blurb: "ちゃにあう。" },
    ]);
    const wares = allWares();
    expect(wares.find((w) => w.kind === "herb")?.name).toBe("やくそう"); // catalog wins
    expect(wares.find((w) => w.kind === "wagashi")?.name).toBe("わがし");
    expect(kindName("wagashi42")).toBe("わがし");
    registerKindNames({ karakuri: "からくり" });
    expect(kindName("karakuri")).toBe("からくり");
  });
});
