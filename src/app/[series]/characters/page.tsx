import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCachedCharacterIndex, getCachedArcs } from "@/lib/cached";
import { getBrowseGate } from "@/lib/queries";
import { RosterGrid, type RosterEntry } from "@/components/browse/roster-grid";
import { FirstTouchGate } from "@/components/browse/first-touch-gate";

const SERIES_NAME: Record<string, string> = { "one-piece": "One Piece" };

export function generateStaticParams() {
  return [{ series: "one-piece" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string }>;
}): Promise<Metadata> {
  const { series } = await params;
  const name = SERIES_NAME[series] ?? series;
  return {
    title: `${name} Characters`,
    description: `Browse and search every ${name} character in the Scaleverse community power scale.`,
  };
}

export default async function CharactersIndexPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series } = await params;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav className="mb-4 font-mono text-xs text-muted">
        <Link href={`/${series}/tier-list`} className="hover:text-foreground">
          {SERIES_NAME[series] ?? series} tier list
        </Link>{" "}
        / characters
      </nav>
      <h1 className="font-display -skew-x-6 text-3xl uppercase sm:text-4xl">
        All <span className="text-accent">characters</span>
      </h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-lg bg-surface" aria-hidden />}>
        <RosterBody series={series} />
      </Suspense>
    </main>
  );
}

// Dynamic hole: viewer gate (cookies/auth) filters the shared cached index.
async function RosterBody({ series }: { series: string }) {
  const [{ maxPos, needsFirstTouch }, all, arcs] = await Promise.all([
    getBrowseGate(series),
    getCachedCharacterIndex(series),
    getCachedArcs(series),
  ]);

  const visible: RosterEntry[] = all
    .filter(
      (e) =>
        maxPos === null ||
        ((e.debut_pos === null || e.debut_pos <= maxPos) &&
          (e.reveal_pos === null || e.reveal_pos <= maxPos)),
    )
    .map(({ debut_pos: _d, reveal_pos: _r, ...e }) => e);
  const hidden = all.length - visible.length;

  return (
    <>
      {needsFirstTouch && <FirstTouchGate arcs={arcs} seriesSlug={series} />}
      {/* ungated roster is inert + aria-hidden behind the gate (no flash;
          crawler HTML unaffected) */}
      <div inert={needsFirstTouch || undefined} aria-hidden={needsFirstTouch || undefined}>
        {hidden > 0 && (
          <p className="mt-1 font-mono text-xs text-muted">
            {hidden} hidden by your spoiler settings
          </p>
        )}
        <div className="mt-6">
          <RosterGrid series={series} entries={visible} />
        </div>
      </div>
    </>
  );
}
