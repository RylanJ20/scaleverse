import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getViewer } from "@/lib/viewer";
import { getCachedDailyMatchup, getCachedSeries, getCachedTakes } from "@/lib/cached";
import { getMyTake } from "@/app/actions/social";
import { MatchupVote } from "@/components/matchup/matchup-vote";
import { TakesPanel } from "@/components/daily/takes-panel";
import { IMAGE_BASE } from "@/lib/image";

// The verse hub — the former site homepage, one per series (the homepage is
// now the verse select screen). Unknown slugs 404 via the series lookup.

// Mirrors the series.slug check constraint. Junk single-segment paths
// (/wp-login.php, /.env, …) all land on this route now — reject them before
// they cost a Supabase query and a day-long per-slug cache entry each.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isSeriesSlug = (s: string) => s.length <= 64 && SLUG_RE.test(s);

// ≥1 sample is required under cacheComponents; other series render on demand.
export function generateStaticParams() {
  return [{ series: "one-piece" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string }>;
}): Promise<Metadata> {
  const { series } = await params;
  const verse = isSeriesSlug(series) ? await getCachedSeries(series) : null;
  return { title: verse?.name ?? "Verse" };
}

export default async function SeriesHubPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series } = await params;
  if (!isSeriesSlug(series)) notFound();
  const verse = await getCachedSeries(series);
  if (!verse) notFound();

  // cached (shared) read — the hero + daily card prerender into the shell
  const daily = await getCachedDailyMatchup(series);

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <section className="flex flex-col items-center gap-5 py-8 text-center">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent-2">
          {verse.name} · Season 0
        </p>
        <h1 className="font-display -skew-x-6 text-5xl uppercase tracking-tight sm:text-7xl">
          Scale<span className="text-accent">verse</span>
        </h1>
        <p className="max-w-md text-balance text-muted">
          Who wins? Vote on head-to-head anime matchups and shape the community&apos;s definitive
          power rankings.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/${series}/arena`}
            className="rounded-md bg-accent px-8 py-3 text-lg font-bold uppercase tracking-wider text-white transition hover:brightness-110"
          >
            Enter the Arena
          </Link>
          <Link
            href={`/${series}/tier-list`}
            className="rounded-md border border-white/15 px-8 py-3 text-lg font-bold uppercase tracking-wider transition hover:border-white/30"
          >
            Tier list
          </Link>
        </div>
      </section>

      {daily && (
        <section className="mt-8 w-full max-w-2xl rounded-xl border border-white/10 bg-background/40 p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-accent-text">
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
  const [takes, myTake, user] = await Promise.all([
    getCachedTakes(matchupId),
    getMyTake(matchupId),
    getViewer(),
  ]);
  return <TakesPanel matchupId={matchupId} takes={takes} myTake={myTake} isAuthed={!!user} />;
}
