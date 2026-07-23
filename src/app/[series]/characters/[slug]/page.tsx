import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getCachedCharacter, getCachedFormHistory, type FormHistoryPoint } from "@/lib/cached";
import { getViewerMaxArcPosition, type CharacterFull } from "@/lib/queries";
import { characterImageUrl } from "@/lib/image";
import { formatBounty, hakiList } from "@/lib/format";
import { SpoilerGate } from "@/components/character/spoiler-gate";

const SERIES_NAME: Record<string, string> = { "one-piece": "One Piece" };

export function generateStaticParams() {
  return [{ series: "one-piece", slug: "monkey-d-luffy" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}): Promise<Metadata> {
  const { series, slug } = await params;
  const char = await getCachedCharacter(series, slug);
  if (!char) return { title: "Character" };
  const title = char.epithet ? `${char.name} "${char.epithet}"` : char.name;
  const description = `${char.name}'s power ranking, stats, and matchup record in the ${
    SERIES_NAME[series] ?? series
  } community power scale on Scaleverse.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

function StatRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2">
      <dt className="font-mono text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}

// Single-series micro-chart: 2px recessive line + endpoint dot, no axes/legend
// (the rating row it sits in names it); trend is described in the aria-label so
// the information never rides on the mark alone. Hidden until a form has ≥3
// snapshots — history is sparse until voting picks up.
function Sparkline({ points }: { points: FormHistoryPoint[] }) {
  if (points.length < 3) return null;
  const w = 96;
  const h = 24;
  const pad = 3;
  const vals = points.map((p) => p.display_rating);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // damp tiny wobbles (±1 must not fill the box) and center the used range;
  // a perfectly flat series draws at mid-height, not pinned to an edge
  const range = max - min;
  const span = Math.max(4, range);
  const step = (w - pad * 2) / (vals.length - 1);
  const y = (v: number) =>
    range === 0
      ? h / 2
      : pad + (h - pad * 2) * (1 - (v - min + (span - range) / 2) / span);
  const d = vals
    .map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const delta = vals[vals.length - 1] - vals[0];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Rating trend: ${delta === 0 ? "flat" : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`} across ${vals.length} refits`}
      className="shrink-0"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-accent-2)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={pad + (vals.length - 1) * step} cy={y(vals[vals.length - 1])} r="2.5" fill="var(--color-accent-2)" />
    </svg>
  );
}

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}) {
  const { series, slug } = await params;
  const char = await getCachedCharacter(series, slug);
  if (!char) notFound();

  const def = char.forms.find((f) => f.is_default) ?? char.forms[0];
  const history = def ? await getCachedFormHistory(def.id) : [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav className="mb-4 font-mono text-xs text-muted">
        <Link href={`/${series}/tier-list`} className="hover:text-foreground">
          {SERIES_NAME[series] ?? series} tier list
        </Link>{" "}
        / {char.name}
      </nav>

      <h1 className="font-display -skew-x-6 text-3xl uppercase sm:text-4xl">{char.name}</h1>
      {char.epithet && <p className="mb-6 text-muted">&ldquo;{char.epithet}&rdquo;</p>}

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" aria-hidden />}>
        <GatedBody series={series} char={char} history={history} />
      </Suspense>

      <p className="mt-8 text-center text-sm text-muted">
        Think {char.name} is ranked wrong?{" "}
        <Link href={`/${series}/arena`} className="text-accent-2 underline-offset-4 hover:underline">
          Vote in the Arena
        </Link>
      </p>
    </main>
  );
}

// Dynamic hole: only the viewer's gate (cookies/auth) is per-request — the
// character payload comes from the shared cache. Spoiler interstitial per
// ratified #33.
async function GatedBody({
  series,
  char,
  history,
}: {
  series: string;
  char: CharacterFull;
  history: FormHistoryPoint[];
}) {
  const maxPos = await getViewerMaxArcPosition(series);
  const isSpoiler = maxPos != null && char.debut_position != null && char.debut_position > maxPos;

  const def = char.forms.find((f) => f.is_default) ?? char.forms[0];
  const s = char.stats;
  const df = s.devil_fruit;

  const body = (
    <div className="grid gap-6 sm:grid-cols-[280px_1fr]">
      <div>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-white/10 bg-black/40">
          {characterImageUrl(def?.image_path ?? null) && (
            <Image
              src={characterImageUrl(def.image_path)!}
              alt={char.name}
              fill
              sizes="280px"
              className="object-cover object-top"
              priority
            />
          )}
        </div>
        {def?.tier && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
            <span className="font-mono text-xs uppercase text-muted">Community tier</span>
            <span
              className="font-display flex h-8 w-8 items-center justify-center rounded text-xl text-black"
              style={{ backgroundColor: `var(--color-tier-${def.tier.toLowerCase()})` }}
            >
              {def.tier}
            </span>
          </div>
        )}
        {def?.display_rating != null && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-white/10 px-3 py-2">
            <span className="font-mono text-xs uppercase text-muted">Rating</span>
            <Sparkline points={history} />
            <span className="font-mono text-lg text-accent-2">{def.display_rating}</span>
          </div>
        )}
      </div>

      <div>
        <dl className="rounded-lg border border-white/5 bg-surface px-4">
          <StatRow label="Epithet" value={char.epithet} />
          <StatRow label="Status" value={s.status} />
          <StatRow label="Bounty" value={formatBounty(s.bounty)} />
          <StatRow label="Haki" value={hakiList(s.haki)} />
          <StatRow label="Devil Fruit" value={df?.name_en ?? (df?.type ? `${df.type} type` : null)} />
          {df?.name_en && df?.type && <StatRow label="Fruit type" value={df.type} />}
          <StatRow label="Affiliation" value={s.affiliation} />
          <StatRow label="Origin" value={s.demographics?.origin} />
          <StatRow label="Race" value={s.demographics?.race} />
          <StatRow label="Debut" value={s.debut?.chapter ? `Chapter ${s.debut.chapter}` : null} />
        </dl>
        {s.wiki_url && (
          <a
            href={s.wiki_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm text-accent-2 underline-offset-4 hover:underline"
          >
            Read more on the wiki →
          </a>
        )}
      </div>
    </div>
  );

  return isSpoiler ? <SpoilerGate characterName={char.name}>{body}</SpoilerGate> : body;
}
