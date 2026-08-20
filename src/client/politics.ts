// Political regimes — presets over the engine's raw governance primitive.
// The engine knows only "dictatorship" and "council {members, threshold,
// electorate, quorum, weighting}"; every famous constitution is a point in that
// space. Building one and reading one back are both pure functions.

export type Regime = "dictatorship" | "oligarchy" | "republic" | "democracy" | "meritocracy" | "plutocracy" | "consensus";

export interface GovernanceValue {
  readonly kind: "dictatorship" | "council";
  readonly members?: readonly string[];
  readonly threshold?: number;
  readonly electorate?: "members" | "citizens";
  readonly quorum?: number;
  readonly weighting?: "equal" | "reputation" | "stake";
}

export const REGIME_JA: Readonly<Record<Regime, { label: string; desc: string }>> = {
  dictatorship: { label: "どくさいせい", desc: "あるじが すべてを きめる" },
  oligarchy: { label: "かとうせい", desc: "えらばれし すうめいの ひょうぎ" },
  republic: { label: "きょうわせい", desc: "だいひょうしゃたちの ひょうぎ" },
  democracy: { label: "みんしゅせい", desc: "しみん ぜんいんに いっぴょう" },
  meritocracy: { label: "のうりょくせい", desc: "ひょうばんが たかいほど おもい いっぴょう" },
  plutocracy: { label: "きんけんせい", desc: "ざいさんが おおいほど おもい いっぴょう" },
  consensus: { label: "ぜんかいいっちせい", desc: "しみん ぜんいんの さんせいが いる" },
};

export const REGIMES: readonly Regime[] = ["dictatorship", "oligarchy", "republic", "democracy", "meritocracy", "plutocracy", "consensus"];

/**
 * Build the governance value for a regime. `residents` are the region's citizen
 * agent ids, most senior/reputable first (the caller decides the ordering that
 * "elite" and "representative" mean).
 */
export function buildGovernance(regime: Regime, residents: readonly string[]): GovernanceValue {
  const n = Math.max(residents.length, 1);
  switch (regime) {
    case "dictatorship":
      return { kind: "dictatorship" };
    case "oligarchy": {
      const elite = residents.slice(0, Math.min(2, n));
      return { kind: "council", members: elite, threshold: Math.max(1, Math.ceil(elite.length / 2)) };
    }
    case "republic": {
      const reps = residents.slice(0, Math.max(1, Math.ceil(n / 2)));
      return { kind: "council", members: reps, threshold: Math.max(1, Math.ceil(reps.length / 2)) };
    }
    case "democracy":
      return { kind: "council", members: [...residents], threshold: Math.max(1, Math.ceil(n / 2)), electorate: "citizens", quorum: Math.max(1, Math.ceil(n / 2)), weighting: "equal" };
    case "meritocracy":
      return { kind: "council", members: [...residents], threshold: Math.max(1, Math.ceil(n / 2)), electorate: "citizens", weighting: "reputation" };
    case "plutocracy":
      return { kind: "council", members: [...residents], threshold: Math.max(1, Math.ceil(n / 2)), electorate: "citizens", weighting: "stake" };
    case "consensus":
      return { kind: "council", members: [...residents], threshold: n, electorate: "citizens", quorum: n, weighting: "equal" };
  }
}

/** Read a governance value back into the regime it most resembles. */
export function classifyRegime(gov: GovernanceValue): Regime {
  if (gov.kind === "dictatorship") return "dictatorship";
  const members = gov.members ?? [];
  if (gov.electorate === "citizens") {
    if (gov.weighting === "reputation") return "meritocracy";
    if (gov.weighting === "stake") return "plutocracy";
    if ((gov.threshold ?? 0) >= members.length && members.length > 1) return "consensus";
    return "democracy";
  }
  if (members.length <= 2) return "oligarchy";
  return "republic";
}

/** Flag colors: every constitution flies its own banner over the town hall. */
export const REGIME_COLOR: Readonly<Record<Regime, string>> = {
  dictatorship: "#c23a2e",
  oligarchy: "#7a3fa8",
  republic: "#2a5fd0",
  democracy: "#2fa84f",
  meritocracy: "#e8c840",
  plutocracy: "#e07820",
  consensus: "#e8e8e8",
};
