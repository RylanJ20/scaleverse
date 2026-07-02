import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCharacter, getViewerMaxArcPosition } from "@/lib/queries";
import { characterImageUrl } from "@/lib/image";
import { formatBounty, hakiList } from "@/lib/format";
import { SpoilerGate } from "@/components/character/spoiler-gate";

const SERIES_NAME: Record<string, string> = { "one-piece": "One Piece" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}): Promise<Metadata> {
  const { series, slug } = await params;
  const char = await getCharacter(series, slug);
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

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}) {
  const { series, slug } = await params;
  const char = await getCharacter(series, slug);
  if (!char) notFound();

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
          <div className="mt-2 flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
            <span className="font-mono text-xs uppercase text-muted">Rating</span>
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

      {isSpoiler ? <SpoilerGate characterName={char.name}>{body}</SpoilerGate> : body}

      <p className="mt-8 text-center text-sm text-muted">
        Think {char.name} is ranked wrong?{" "}
        <Link href={`/${series}/arena`} className="text-accent-2 underline-offset-4 hover:underline">
          Vote in the Arena
        </Link>
      </p>
    </main>
  );
}
