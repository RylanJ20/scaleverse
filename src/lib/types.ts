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
