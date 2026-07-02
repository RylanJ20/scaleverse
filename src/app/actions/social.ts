"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchupItem } from "@/lib/types";

// Selecting/creating today's featured matchup is a privileged write, so it runs
// with the service role (never anon-invokable).
export async function getDailyMatchup(seriesSlug: string): Promise<MatchupItem | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_daily_matchup", { p_series_slug: seriesSlug });
  if (error || !data) return null;
  return data as MatchupItem;
}

export type Take = {
  id: string;
  body: string;
  created_at: string;
  username: string | null;
};

export async function getTakes(matchupId: string): Promise<Take[]> {
  const supabase = await createClient();
  const { data: takes } = await supabase
    .from("takes")
    .select("id, body, created_at, user_id")
    .eq("matchup_id", matchupId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!takes?.length) return [];

  const ids = [...new Set(takes.map((t) => t.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  return takes.map((t) => ({
    id: t.id,
    body: t.body,
    created_at: t.created_at,
    username: nameById.get(t.user_id) ?? null,
  }));
}

export async function getMyTake(matchupId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("takes")
    .select("body")
    .eq("matchup_id", matchupId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.body ?? null;
}

export async function postTake(
  matchupId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // All validation (auth, length, daily-matchup gate, one-per-user) is enforced
  // in the post_take RPC — the only write path to takes (direct writes revoked).
  const { error } = await supabase.rpc("post_take", { p_matchup_id: matchupId, p_body: body });
  if (error) {
    const m = error.message;
    if (/1-140|characters/i.test(m)) return { ok: false, error: "Takes are 1–140 characters." };
    if (/closed/i.test(m)) return { ok: false, error: "Takes are closed for this matchup." };
    if (/authentication/i.test(m)) return { ok: false, error: "Sign in to post a take." };
    return { ok: false, error: "Could not post your take." };
  }
  revalidatePath("/");
  return { ok: true };
}
