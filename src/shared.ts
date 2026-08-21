// Types shared between the game server and the browser client. These mirror the
// vouch-node observation surface (read shapes) plus the game's own /api envelope.

export type Stance = "absorb" | "map" | "reexamine" | "reject";

export interface RegionView {
  readonly id: string;
  readonly displayName: string;
  readonly owner: string | null;
  readonly status: "unrecognized" | "recognized";
  readonly lifecycle: "active" | "dormant";
  readonly foundedAtSeq: number;
  readonly salePrice: number | null;
  readonly institutions: {
    readonly governance: {
      readonly kind: string;
      readonly members?: readonly string[];
      readonly threshold?: number;
      readonly electorate?: "members" | "citizens";
      readonly quorum?: number;
      readonly weighting?: "equal" | "reputation" | "stake";
    };
    readonly itemPolicy: { readonly minting: string };
    readonly economyPolicy: { readonly baseCostRate: number; readonly minCostRate: number };
    readonly diplomacyPolicy: {
      readonly defaultStance: Stance;
      readonly overrides: Readonly<Record<string, Stance>>;
    };
  };
  readonly openProposal: { readonly proposedBy: string; readonly votes: readonly string[]; readonly roll?: readonly { readonly voter: string }[]; readonly change?: Record<string, unknown> } | null;
}

export interface AgentView {
  readonly id: string;
  readonly region: string;
  readonly admittedAtSeq?: number;
  readonly role: "artisan" | "merchant" | "broker" | "treasury";
  readonly balances: { readonly credit: number; readonly currency: number };
  readonly reputation: number;
  readonly trust: number;
}

export interface ItemView {
  readonly id: string;
  readonly kind: string;
  readonly owner: string;
}

export interface MeView {
  /** Hero name, or null until the player names their hero (onboarding). */
  readonly heroName: string | null;
  readonly registered: boolean;
  /** The agent this hero controls (`hero@region`), or null if not admitted anywhere. */
  readonly agentId: string | null;
}

export interface Snapshot {
  readonly regions: readonly RegionView[];
  readonly agents: readonly AgentView[];
  readonly items: readonly ItemView[];
  readonly me: MeView;
  readonly logLength: number;
}

export interface LogEventView {
  readonly seq: number;
  readonly type: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
}

export type ActResult =
  | { readonly ok: true; readonly detail: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };
