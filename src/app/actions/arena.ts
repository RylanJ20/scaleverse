"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/viewer";
import { getProgressRow, progressArcPosition } from "@/lib/queries";
import type { Batch, MatchupItem, ProgressGate, VoteFailCode, VoteOutcome, VoteResult } from "@/lib/types";

const ARC_COOKIE = "sv-arc-pos"; // "all" (caught up) or an arc position integer

export async function getArcGate(): Promise<number | null> {
  const cookieStore = await cookies();
  const v = cookieStore.get(ARC_COOKIE)?.value;
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Where this visitor's spoiler gate sits: chosen=false means onboarding is
// still needed; maxArcPosition=null means caught up (no gate).
export async function getProgress(seriesSlug: string): Promise<ProgressGate> {
  const user = await getViewer();
  if (user) {
    const data = await getProgressRow(seriesSlug, user.id);
    if (data) {
      if (data.caught_up || !data.last_arc_id) return { chosen: true, maxArcPosition: null };
      const pos = progressArcPosition(data);
      if (pos !== null) return { chosen: true, maxArcPosition: pos };
      // arc join came back empty — fall back to the cookie rather than claiming "caught up"
      return { chosen: true, maxArcPosition: await cookieArcPosition() };
    }
    // Signed in but no progress row: deal_matchups gates ONLY on the DB row, so
    // an anon-era cookie can't be honored — re-onboard to create the row rather
    // than showing a gate label the dealer doesn't enforce.
    return { chosen: false, maxArcPosition: null };
  }
  const cookieStore = await cookies();
  const v = cookieStore.get(ARC_COOKIE)?.value;
  if (v === undefined) return { chosen: false, maxArcPosition: null };
  if (v === "all") return { chosen: true, maxArcPosition: null };
  const n = Number(v);
  return { chosen: true, maxArcPosition: Number.isFinite(n) ? n : null };
}

async function cookieArcPosition(): Promise<number | null> {
  const cookieStore = await cookies();
  const v = cookieStore.get(ARC_COOKIE)?.value;
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function saveProgress(
  seriesSlug: string,
  choice: { caughtUp: true } | { arcSlug: string },
): Promise<void> {
  const supabase = await createClient();
  const cookieStore = await cookies();

  let arcPosition: number | null = null;
  let arcId: string | null = null;
  if ("arcSlug" in choice) {
    const { data: arc } = await supabase
      .from("arcs")
      .select("id, position, series!inner(id, slug)")
      .eq("series.slug", seriesSlug)
      .eq("slug", choice.arcSlug)
      .single();
    if (!arc) throw new Error(`unknown arc ${choice.arcSlug}`);
    arcPosition = arc.position;
    arcId = arc.id;
  }

  cookieStore.set(ARC_COOKIE, arcPosition === null ? "all" : String(arcPosition), {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  const user = await getViewer();
  if (user) {
    const { data: series } = await supabase.from("series").select("id").eq("slug", seriesSlug).single();
    if (!series) throw new Error(`unknown series ${seriesSlug}`);
    // the DB row is what deal_matchups gates on — a silent failure here would
    // break spoiler gating for signed-in users
    const { error } = await supabase.from("user_series_progress").upsert(
      {
        user_id: user.id,
        series_id: series.id,
        last_arc_id: arcId,
        caught_up: arcPosition === null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,series_id" },
    );
    if (error) throw new Error(`saveProgress: ${error.message}`);
  }
}

export async function fetchBatch(seriesSlug: string): Promise<Batch> {
  const user = await getViewer();

  if (user) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("deal_matchups", {
      p_series_slug: seriesSlug,
      p_count: 10,
    });
    if (error) throw new Error(`deal_matchups: ${error.message}`);
    return { mode: "deal", items: (data ?? []) as MatchupItem[] };
  }

  // demo dealing is service-role-only (anon direct calls were a DoS/write vector)
  const maxPos = await getArcGate();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("demo_matchups", {
    p_series_slug: seriesSlug,
    p_max_arc_position: maxPos,
    p_count: 10,
  });
  if (error) throw new Error(`demo_matchups: ${error.message}`);
  return { mode: "demo", items: (data ?? []) as MatchupItem[] };
}

const VOTE_FAIL_CODES: Record<string, VoteFailCode> = {
  P0002: "not_found",
  P0003: "resolved",
  P0004: "expired",
  P0005: "too_fast",
  P0006: "rate_limit",
  P0008: "revote_limit",
  P0012: "skipped",
};

// Returns a typed outcome instead of throwing: production builds redact thrown
// server-action messages, so the client must classify by code, not message.
export async function castVote(dealId: string, winnerFormId: string): Promise<VoteOutcome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cast_vote", {
    p_deal_id: dealId,
    p_winner_form_id: winnerFormId,
  });
  if (error) return { ok: false, code: VOTE_FAIL_CODES[error.code ?? ""] ?? "unknown" };
  return { ok: true, result: data as VoteResult };
}

export async function skipDeal(dealId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("skip_deal", { p_deal_id: dealId });
  // surface failure so the client can release the fight for re-serving
  if (error) throw new Error("skip failed");
}

export async function recordDemoVote(
  matchupId: string,
  winnerFormId: string,
  sessionId: string,
): Promise<{ ok: boolean; tally: { vote_count: number; a_wins: number } | null }> {
  const admin = createAdminClient();
  // demo votes are isolated by design (ratified #23) — never touch rankings
  const { error } = await admin.from("demo_votes").insert({
    session_id: sessionId,
    matchup_id: matchupId,
    winner_form_id: winnerFormId,
  });
  if (error) return { ok: false, tally: null };
  const { data } = await admin
    .from("matchups")
    .select("vote_count, a_wins")
    .eq("id", matchupId)
    .single();
  // tally:null (select failed) means "recorded, nothing to reconcile" — never
  // feed a zeroed fallback into a live reveal
  return { ok: true, tally: data ?? null };
}

export async function voteOnMatchup(
  formAId: string,
  formBId: string,
  winnerFormId: string,
): Promise<VoteOutcome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vote_on_matchup", {
    p_form_a_id: formAId,
    p_form_b_id: formBId,
    p_winner_form_id: winnerFormId,
  });
  if (error) return { ok: false, code: VOTE_FAIL_CODES[error.code ?? ""] ?? "unknown" };
  return { ok: true, result: data as VoteResult };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
