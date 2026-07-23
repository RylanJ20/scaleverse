import { connection } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";

// Freshness check for the rating fit (Fix: cron observability). Stale means
// unfitted votes exist AND the last fit is older than 30 minutes — this
// tolerates the fit's legitimate skip-when-idle behavior. Returns 503 when
// stale so a free uptime pinger can alert on it. Two head/single-row reads
// per hit: negligible egress.
const STALE_AFTER_MINUTES = 30;

export async function GET() {
  await connection(); // always request-time — this is a live health probe

  const db = createPublicClient();
  const { data: last, error } = await db
    .from("rating_history")
    .select("fit_at")
    .order("fit_at", { ascending: false })
    .limit(1);
  if (error) {
    return Response.json({ error: "db unreachable", stale: true }, { status: 503 });
  }
  const lastFitAt: string | null = last?.[0]?.fit_at ?? null;

  let pendingQuery = db
    .from("vote_events")
    .select("*", { count: "exact", head: true });
  if (lastFitAt) pendingQuery = pendingQuery.gt("created_at", lastFitAt);
  const { count } = await pendingQuery;
  const pendingVotes = count ?? 0;

  const minutesAgo =
    lastFitAt === null ? null : Math.round((Date.now() - new Date(lastFitAt).getTime()) / 60_000);
  const stale =
    pendingVotes > 0 && (minutesAgo === null || minutesAgo > STALE_AFTER_MINUTES);

  return Response.json(
    { last_fit_at: lastFitAt, minutes_ago: minutesAgo, pending_votes: pendingVotes, stale },
    { status: stale ? 503 : 200 },
  );
}
