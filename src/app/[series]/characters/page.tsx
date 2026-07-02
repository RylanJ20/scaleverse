import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewerMaxArcPosition } from "@/lib/queries";
import { characterImageUrl } from "@/lib/image";
import { RosterGrid, type RosterEntry } from "@/components/browse/roster-grid";

const SERIES_NAME: Record<string, string> = { "one-piece": "One Piece" };

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
  const supabase = await createClient();
  const maxPos = await getViewerMaxArcPosition(series);

  const { data } = await supabase
    .from("forms")
    .select(
      `image_path, is_default, is_active,
       characters!inner(slug, name, epithet, series!inner(slug),
         debut:arcs!characters_debut_arc_id_series_id_fkey(position)),
       reveal:arcs!forms_reveal_arc_id_fkey(position),
       ratings(display_rating, tier)`,
    )
    .eq("is_active", true)
    .eq("is_default", true)
    .eq("characters.series.slug", series)
    .limit(1000);

  const all = (data ?? []).map((f) => {
    const c = f.characters as unknown as {
      slug: string;
      name: string;
      epithet: string | null;
      debut: { position: number } | null;
    };
    const reveal = (f.reveal as unknown as { position: number } | null)?.position ?? null;
    const rating = f.ratings as unknown as { display_rating: number; tier: string | null } | null;
    return {
      slug: c.slug,
      name: c.name,
      epithet: c.epithet,
      image_url: characterImageUrl(f.image_path),
      rating: rating?.display_rating ?? 1000,
      tier: rating?.tier ?? null,
      debut_pos: c.debut?.position ?? null,
      reveal_pos: reveal,
    };
  });

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
      {hidden > 0 && (
        <p className="mt-1 font-mono text-xs text-muted">
          {hidden} hidden by your spoiler settings
        </p>
      )}
      <div className="mt-6">
        <RosterGrid series={series} entries={visible} />
      </div>
    </main>
  );
}
