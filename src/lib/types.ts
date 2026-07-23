export type FormCard = {
  form_id: string;
  form_slug: string;
  form_name: string;
  character_slug: string;
  character_name: string;
  epithet: string | null;
  image_path: string | null;
  display_rating: number | null;
  tier: string | null;
};

export type MatchupItem = {
  deal_id?: string; // present in deal mode only
  matchup_id: string;
  vote_count: number;
  a_wins: number;
  a: FormCard;
  b: FormCard;
};

export type VoteResult = {
  matchup_id: string;
  vote_count: number;
  a_wins: number;
  your_pick: string;
  changed: boolean;
  no_op: boolean;
  cosmetic_delta: number;
};

export type ArcOption = { slug: string; name: string; position: number };

export type Batch = { mode: "deal" | "demo"; items: MatchupItem[] };

// chosen=false → onboarding needed; maxArcPosition=null → caught up (no gate)
export type ProgressGate = { chosen: boolean; maxArcPosition: number | null };

// Typed vote outcome: thrown server-action errors are REDACTED in production
// builds (Next docs: model expected errors as return values), so the client
// classifies failures by this code, never by error-message strings.
export type VoteFailCode =
  | "not_found" // P0002 — deal doesn't exist / isn't yours
  | "resolved" // P0003 — deal already VOTED (the vote IS in the ledger)
  | "expired" // P0004 — deal expired before the vote landed
  | "too_fast" // P0005 — ratified 1.5s spacing guard
  | "rate_limit" // P0006 — 20/min · 500/hr · 1500/day ceilings
  | "revote_limit" // P0008 — one change per matchup per week
  | "skipped" // P0012 — deal was skipped (e.g. in another tab); vote did NOT land
  | "unknown";

export type VoteOutcome =
  | { ok: true; result: VoteResult }
  | { ok: false; code: VoteFailCode };
