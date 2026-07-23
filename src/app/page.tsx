import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCachedDailyMatchup, getCachedTakes } from "@/lib/cached";
import { getMyTake } from "@/app/actions/social";
import { MatchupVote } from "@/components/matchup/matchup-vote";
import { TakesPanel } from "@/components/daily/takes-panel";
import { IMAGE_BASE } from "@/lib/image";

const SERIES = "one-piece";

export default async function Home() {
  // cached (shared) read — the hero + daily card prerender into the shell
  const daily = await getCachedDailyMatchup(SERIES);

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <section className="flex flex-col items-center gap-5 py-8 text-center">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent-2">Season 0</p>
        <h1 className="font-display -skew-x-6 text-5xl uppercase tracking-tight sm:text-7xl">
          Scale<span className="text-accent">verse</span>
        </h1>
        <p className="max-w-md text-balance text-muted">
          Who wins? Vote on head-to-head anime matchups and shape the community&apos;s definitive
          power rankings.
        </p>
        <div className="flex gap-3">
          <Link
            href="/one-piece/arena"
            className="rounded-md bg-accent px-8 py-3 text-lg font-bold uppercase tracking-wider text-white transition hover:brightness-110"
          >
            Enter the Arena
          </Link>
          <Link
            href="/one-piece/tier-list"
            className="rounded-md border border-white/15 px-8 py-3 text-lg font-bold uppercase tracking-wider transition hover:border-white/30"
          >
            Tier list
          </Link>
        </div>
      </section>

      {daily && (
        <section className="mt-8 w-full max-w-2xl rounded-xl border border-white/10 bg-background/40 p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Matchup of the day
            </span>
          </div>
          <MatchupVote
            a={daily.a}
            b={daily.b}
            imageBase={IMAGE_BASE}
            initialVoteCount={daily.vote_count}
            initialAWins={daily.a_wins}
            matchupId={daily.matchup_id}
          />
          <div className="mt-6 border-t border-white/10 pt-5">
            <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" aria-hidden />}>
              <TakesSection matchupId={daily.matchup_id} />
            </Suspense>
          </div>
        </section>
      )}
    </main>
  );
}

// Dynamic hole: the takes list is cached/shared, but "my take" and auth state
// are per-request (only signed-in users can post — ratified #24 gating is in
// the post_take RPC).
async function TakesSection({ matchupId }: { matchupId: string }) {
  const supabase = await createClient();
  const [takes, myTake, { data: { user } }] = await Promise.all([
    getCachedTakes(matchupId),
    getMyTake(matchupId),
    supabase.auth.getUser(),
  ]);
  return <TakesPanel matchupId={matchupId} takes={takes} myTake={myTake} isAuthed={!!user} />;
}
