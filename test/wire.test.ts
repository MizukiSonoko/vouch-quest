import { describe, expect, test } from "bun:test";
import { commandBytes, decodeBase64, encodeBase64, registerBytes } from "../src/client/wire";

// Parity vectors generated from the REAL vouch-node implementation
// (vouch-node/src/accounts.ts registerBytes/commandBytes). If these fail, the
// browser is signing different bytes than the node verifies — nothing will work.
const dec = new TextDecoder();

describe("wire byte parity with vouch-node", () => {
  test("registerBytes matches the node's canonical form", () => {
    expect(dec.decode(registerBytes("mizuki", 0, "PUBKEYB64"))).toBe(
      '{"nonce":0,"principal":"mizuki","publicKey":"PUBKEYB64","purpose":"vouch-register/v1"}',
    );
  });

  test("commandBytes matches the node's canonical form (keys sorted, nested command)", () => {
    const cmd = { kind: "transfer", from: "mizuki@asahi", to: "ann@asahi", amount: 10 };
    expect(dec.decode(commandBytes("mizuki@asahi", 7, cmd))).toBe(
      '{"command":{"amount":10,"from":"mizuki@asahi","kind":"transfer","to":"ann@asahi"},"nonce":7,"principal":"mizuki@asahi","purpose":"vouch-command/v1"}',
    );
  });
});

describe("base64", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
