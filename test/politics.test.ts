import { describe, expect, test } from "bun:test";
import { buildGovernance, classifyRegime, REGIMES } from "../src/client/politics";

const RESIDENTS = ["a@x", "b@x", "c@x", "d@x", "e@x", "f@x"];

describe("regimes", () => {
  test("every regime round-trips through build -> classify", () => {
    for (const regime of REGIMES) {
      expect(classifyRegime(buildGovernance(regime, RESIDENTS))).toBe(regime);
    }
  });

  test("shapes follow the constitution", () => {
    const oligarchy = buildGovernance("oligarchy", RESIDENTS);
    expect(oligarchy.members?.length).toBe(2);
    const republic = buildGovernance("republic", RESIDENTS);
    expect(republic.members?.length).toBe(3); // half of six
    expect(republic.electorate).toBeUndefined();
    const democracy = buildGovernance("democracy", RESIDENTS);
    expect(democracy.electorate).toBe("citizens");
    expect(democracy.threshold).toBe(3);
    const consensus = buildGovernance("consensus", RESIDENTS);
    expect(consensus.threshold).toBe(6);
    expect(consensus.quorum).toBe(6);
    expect(buildGovernance("plutocracy", RESIDENTS).weighting).toBe("stake");
    expect(buildGovernance("meritocracy", RESIDENTS).weighting).toBe("reputation");
  });

  test("a one-resident village can still adopt any constitution", () => {
    for (const regime of REGIMES) {
      const gov = buildGovernance(regime, ["solo@x"]);
      if (gov.kind === "council") expect(gov.threshold).toBeGreaterThanOrEqual(1);
    }
  });
});
