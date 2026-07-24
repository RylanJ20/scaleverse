"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

// Reads that are shared/public (daily matchup, takes list) live in
// src/lib/cached.ts behind "use cache" — this file keeps only the mutation and
// the per-user read, so nothing privileged is exposed as an invocable action.

export type Take = {
  id: string;
  body: string;
  created_at: string;
  username: string | null;
};

export async function getMyTake(matchupId: string): Promise<string | null> {
  const user = await getViewer();
  if (!user) return null;
  const supabase = await createClient();
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
  // read-your-own-writes: your take shows up immediately
  updateTag(`takes:${matchupId}`);
  return { ok: true };
}
