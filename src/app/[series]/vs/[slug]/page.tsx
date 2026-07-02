import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getCharacter, getMatchupTally, formToCard } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { parseMatchupSlug, canonicalMatchupSlug } from "@/lib/matchup-slug";
import { MatchupVote } from "@/components/matchup/matchup-vote";

const SERIES_NAME: Record<string, string> = { "one-piece": "One Piece" };

async function load(seriesSlug: string, slug: string) {
  const parsed = parseMatchupSlug(slug);
  if (!parsed) return null;
  const [charA, charB] = await Promise.all([
    getCharacter(seriesSlug, parsed.a),
    getCharacter(seriesSlug, parsed.b),
  ]);
  if (!charA || !charB || charA.id === charB.id) return null;
  const defA = charA.forms.find((f) => f.is_default) ?? charA.forms[0];
  const defB = charB.forms.find((f) => f.is_default) ?? charB.forms[0];
  if (!defA || !defB) return null;
  return { parsed, charA, charB, defA, defB };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}): Promise<Metadata> {
  const { series, slug } = await params;
  const data = await load(series, slug);
  if (!data) return { title: "Matchup" };
  const { charA, charB } = data;
  const title = `${charA.name} vs ${charB.name}: Who Wins?`;
  const description = `Who would win in a fight — ${charA.name} or ${charB.name}? Vote and see how the ${SERIES_NAME[series] ?? series} community ranks this matchup.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MatchupPage({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}) {
  const { series, slug } = await params;
  const data = await load(series, slug);
  if (!data) notFound();
  const { parsed, charA, charB, defA, defB } = data;

  // canonicalize the URL (ratified #22: one page per pair)
  const canonical = canonicalMatchupSlug(charA.slug, charB.slug);
  if (!parsed.wasCanonical || slug !== canonical) {
    permanentRedirect(`/${series}/vs/${canonical}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const cardA = formToCard(defA, charA);
  const cardB = formToCard(defB, charB);
  const tally = await getMatchupTally(defA, defB, cardA, cardB, user?.id ?? null);

  const imageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/character-images`;
  const aPct = tally.vote_count > 0 ? Math.round((tally.a_wins / tally.vote_count) * 100) : null;

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Who would win, ${charA.name} or ${charB.name}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text:
            aPct != null
              ? `The ${SERIES_NAME[series] ?? series} community currently favors ${
                  aPct >= 50 ? charA.name : charB.name
                } with ${aPct >= 50 ? aPct : 100 - aPct}% of ${tally.vote_count.toLocaleString()} votes.`
              : `No community votes yet — be the first to settle ${charA.name} vs ${charB.name}.`,
        },
      },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />

      <nav className="mb-4 font-mono text-xs text-muted">
        <Link href={`/${series}/tier-list`} className="hover:text-foreground">
          {SERIES_NAME[series] ?? series} tier list
        </Link>{" "}
        / matchup
      </nav>

      <h1 className="font-display -skew-x-6 mb-1 text-2xl uppercase sm:text-3xl">
        {charA.name} <span className="text-muted">vs</span> {charB.name}
      </h1>
      <p className="mb-6 text-sm text-muted">Who wins? Cast your vote and see where the community lands.</p>

      <MatchupVote
        a={cardA}
        b={cardB}
        imageBase={imageBase}
        initialVoteCount={tally.vote_count}
        initialAWins={tally.a_wins}
        initialPick={tally.your_pick}
        isAuthed={!!user}
      />

      <div className="mt-8 grid grid-cols-2 gap-3 text-center text-sm">
        <Link
          href={`/${series}/characters/${charA.slug}`}
          className="rounded-md border border-white/10 py-2 transition hover:border-white/25"
        >
          {charA.name}&apos;s profile
        </Link>
        <Link
          href={`/${series}/characters/${charB.slug}`}
          className="rounded-md border border-white/10 py-2 transition hover:border-white/25"
        >
          {charB.name}&apos;s profile
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Want more fights?{" "}
        <Link href={`/${series}/arena`} className="text-accent-2 underline-offset-4 hover:underline">
          Enter the Arena
        </Link>
      </p>
    </main>
  );
}
