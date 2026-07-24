import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getCachedTierListRoster, getCachedMovementBaseline, getCachedArcs, type RosterRow } from "@/lib/cached";
import { getBrowseGate } from "@/lib/queries";
import { characterImageUrl } from "@/lib/image";
import { FirstTouchGate } from "@/components/browse/first-touch-gate";

// movement is only shown when it clears per-fit jitter
const CARET_MIN_DELTA = 3;
const MOVERS_SHOWN = 3;

function Delta({ delta }: { delta: number }) {
  // direction rides on the glyph, not the color (never color-alone)
  return (
    <span className={delta > 0 ? "text-accent-2" : "text-accent"}>
      {delta > 0 ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

export const metadata: Metadata = {
  title: "Tier List",
};

export function generateStaticParams() {
  return [{ series: "one-piece" }];
}

const TIER_ORDER = ["S", "A", "B", "C", "D", "F"] as const;
// percentile cutoffs when a form has no cron-assigned tier yet (5/10/20/30/25/10)
const CUTOFFS: Array<[string, number]> = [
  ["S", 0.05],
  ["A", 0.15],
  ["B", 0.35],
  ["C", 0.65],
  ["D", 0.9],
  ["F", 1.0],
];

export default async function TierListPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series } = await params;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="font-display -skew-x-6 text-3xl uppercase sm:text-4xl">
        Community <span className="text-accent">tier list</span>
      </h1>
      <p className="mt-2 text-sm text-muted">
        Ranked by the community&apos;s votes — updated every 10 minutes.{" "}
        <Link href={`/${series}/arena`} className="text-accent-2 underline-offset-4 hover:underline">
          Disagree? Vote.
        </Link>
      </p>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-lg bg-surface" aria-hidden />}>
        <TierListBody series={series} />
      </Suspense>
    </main>
  );
}

// Dynamic hole: reads the viewer's spoiler ceiling (cookies/auth — ≤1 tiny row)
// and filters the shared cached roster per request (ratified #9/#27).
async function TierListBody({ series }: { series: string }) {
  const [{ maxPos, needsFirstTouch }, all, day, week, arcs] = await Promise.all([
    getBrowseGate(series),
    getCachedTierListRoster(series),
    getCachedMovementBaseline(series, 24),
    getCachedMovementBaseline(series, 24 * 7),
    getCachedArcs(series),
  ]);

  // spoiler gate (ratified #9/#27): hidden characters are simply absent
  const visible = all.filter(
    (r) =>
      maxPos === null ||
      ((r.debut_pos === null || r.debut_pos <= maxPos) &&
        (r.reveal_pos === null || r.reveal_pos <= maxPos)),
  );
  const hidden = all.length - visible.length;

  const ranked = [...visible].sort((a, b) => b.rating - a.rating);
  const byTier = new Map<string, RosterRow[]>(TIER_ORDER.map((t) => [t, []]));
  ranked.forEach((row, i) => {
    const tier =
      row.tier ?? CUTOFFS.find(([, cut]) => (i + 1) / ranked.length <= cut)![0];
    byTier.get(tier)?.push(row);
  });

  // movement vs the nearest ≥24h-old snapshot; carets only past the jitter bar
  const dayDelta = (r: RosterRow): number | null => {
    const base = day.ratings[r.form_id];
    return base == null ? null : r.rating - base;
  };
  // movers computed from the GATED set only — movement must not leak spoilers
  const movers = week.fitAt
    ? visible
        .map((r) => ({ row: r, delta: week.ratings[r.form_id] != null ? r.rating - week.ratings[r.form_id] : null }))
        .filter((m): m is { row: RosterRow; delta: number } => m.delta != null && Math.abs(m.delta) >= CARET_MIN_DELTA)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, MOVERS_SHOWN)
    : [];

  return (
    <>
      {needsFirstTouch && <FirstTouchGate arcs={arcs} seriesSlug={series} />}
      {/* while the gate is up, the ungated roster underneath is inert +
          aria-hidden so it's unreachable by keyboard, find-in-page, and AT
          (server-decided, so no flash) — crawler HTML is unaffected */}
      <div inert={needsFirstTouch || undefined} aria-hidden={needsFirstTouch || undefined}>
      {hidden > 0 && (
        <p className="mt-1 font-mono text-xs text-muted">
          {hidden} character{hidden === 1 ? "" : "s"} hidden by your spoiler settings
        </p>
      )}

      {movers.length > 0 && (
        <section className="mt-6 rounded-lg border border-white/5 bg-surface p-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-2">
            Biggest movers this week
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {movers.map(({ row, delta }) => {
              const url = characterImageUrl(row.image_path);
              return (
                <li key={row.form_id}>
                  <Link
                    href={`/${series}/characters/${row.character_slug}`}
                    className="flex items-center gap-2 transition hover:opacity-80"
                  >
                    <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded bg-black/40">
                      {url && (
                        <Image src={url} alt="" fill sizes="32px" className="object-cover object-top" />
                      )}
                    </span>
                    <span className="text-sm">{row.name}</span>
                    <span className="font-mono text-xs">
                      <Delta delta={delta} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-6 space-y-3">
        {TIER_ORDER.map((tier) => {
          const rows = byTier.get(tier) ?? [];
          if (!rows.length) return null;
          return (
            <section key={tier} className="flex overflow-hidden rounded-lg border border-white/5 bg-surface">
              <div
                className="font-display flex w-14 shrink-0 items-center justify-center text-3xl text-black sm:w-20 sm:text-4xl"
                style={{ backgroundColor: `var(--color-tier-${tier.toLowerCase()})` }}
              >
                {tier}
              </div>
              <ul className="flex flex-wrap gap-2 p-2 sm:gap-3 sm:p-3">
                {rows.map((row) => {
                  const url = characterImageUrl(row.image_path);
                  return (
                    <li key={row.form_id}>
                      <Link
                        href={`/${series}/characters/${row.character_slug}`}
                        className="block w-16 text-center transition hover:opacity-80 sm:w-20"
                        title={`${row.name} · ${row.rating}`}
                      >
                        <div className="relative aspect-square overflow-hidden rounded bg-black/40">
                          {url && (
                            <Image
                              src={url}
                              alt={row.name}
                              fill
                              sizes="80px"
                              className="object-cover object-top"
                            />
                          )}
                        </div>
                        <p className="mt-1 truncate text-[10px] leading-tight text-muted">{row.name}</p>
                        <p className="font-mono text-[10px] text-foreground/80">
                          {row.rating}
                          {(() => {
                            const d = dayDelta(row);
                            return d != null && Math.abs(d) >= CARET_MIN_DELTA ? (
                              <>
                                {" "}
                                <Delta delta={d} />
                              </>
                            ) : null;
                          })()}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      </div>
    </>
  );
}
