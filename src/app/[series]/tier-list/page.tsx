import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getCachedTierListRoster, type RosterRow } from "@/lib/cached";
import { getViewerMaxArcPosition } from "@/lib/queries";
import { characterImageUrl } from "@/lib/image";

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
  const [maxPos, all] = await Promise.all([
    getViewerMaxArcPosition(series),
    getCachedTierListRoster(series),
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

  return (
    <>
      {hidden > 0 && (
        <p className="mt-1 font-mono text-xs text-muted">
          {hidden} character{hidden === 1 ? "" : "s"} hidden by your spoiler settings
        </p>
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
                        <p className="font-mono text-[10px] text-foreground/80">{row.rating}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
