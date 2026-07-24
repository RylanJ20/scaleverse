import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { getCachedProfile } from "@/lib/cached";
import { characterImageUrl } from "@/lib/image";
import type { FormCard } from "@/lib/types";
import { canonicalMatchupSlug } from "@/lib/matchup-slug";
import { SpoilerSettings, type SeriesSpoilerSetting } from "@/components/profile/spoiler-settings";
import { isSyntheticEmail } from "@/lib/username";

type HottestTake = {
  matchup_id: string;
  pick: FormCard;
  other: FormCard;
  your_side_pct: number;
  vote_count: number;
};

type Profile = {
  username: string;
  member_since: string;
  total_votes: number;
  scored_votes: number;
  agreement_pct: number | null;
  hottest_takes: HottestTake[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `${username}'s power-scaling take record on Scaleverse.`,
  };
}

export default function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" aria-hidden />}>
        <ProfileBody params={params} />
      </Suspense>
    </main>
  );
}

async function ProfileBody({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const data = await getCachedProfile(username);
  if (!data) notFound();
  const p = data as Profile;

  // spoiler settings are owner-only: shown when viewing your own profile
  const supabase = await createClient();
  let spoilerSeries: SeriesSpoilerSetting[] | null = null;
  let noRecoveryEmail = false;
  const user = await getViewer();
  if (user) {
    noRecoveryEmail = isSyntheticEmail(user.email);
    const { data: me } = await supabase.from("profiles").select("username").eq("id", user.id).single();
    if (me?.username === p.username) {
      const [{ data: seriesRows }, { data: arcRows }, { data: progRows }] = await Promise.all([
        supabase.from("series").select("id, slug, name").order("name"),
        supabase.from("arcs").select("id, slug, name, position, series_id").order("position"),
        supabase.from("user_series_progress").select("series_id, caught_up, last_arc_id").eq("user_id", user.id),
      ]);
      spoilerSeries = (seriesRows ?? []).map((s) => {
        const arcs = (arcRows ?? []).filter((a) => a.series_id === s.id);
        const prog = (progRows ?? []).find((r) => r.series_id === s.id);
        const current = !prog
          ? null
          : prog.caught_up
            ? "all"
            : arcs.find((a) => a.id === prog.last_arc_id)?.slug ?? "all";
        return {
          slug: s.slug,
          name: s.name,
          arcs: arcs.map(({ slug, name, position }) => ({ slug, name, position })),
          current,
        };
      });
    }
  }

  const since = new Date(p.member_since).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <h1 className="font-display -skew-x-6 text-3xl uppercase sm:text-4xl">@{p.username}</h1>
      <p className="mt-1 text-sm text-muted">Scaling since {since}</p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Votes cast" value={p.total_votes.toLocaleString()} />
        <Stat
          label="With the crowd"
          value={p.agreement_pct != null ? `${p.agreement_pct}%` : "—"}
          hint={p.agreement_pct != null ? `over ${p.scored_votes} scored` : "not enough votes"}
        />
        <Stat
          label="Contrarian"
          value={p.agreement_pct != null ? `${100 - p.agreement_pct}%` : "—"}
        />
      </div>

      {spoilerSeries && noRecoveryEmail && (
        <p className="mt-6 rounded-lg border border-accent/30 bg-surface p-3 text-sm text-muted">
          <span className="font-bold text-accent-text">No recovery email on this account.</span> If you
          lose your password, your take record is gone — there is no way back without one.
        </p>
      )}

      {spoilerSeries && <SpoilerSettings series={spoilerSeries} />}

      <section className="mt-8">
        <h2 className="font-display -skew-x-6 mb-3 text-xl uppercase">
          Hottest <span className="text-accent">takes</span>
        </h2>
        {p.hottest_takes.length === 0 ? (
          <p className="text-sm text-muted">
            No spicy takes yet — vote on some matchups where you go against the grain.
          </p>
        ) : (
          <ul className="space-y-2">
            {p.hottest_takes.map((t) => {
              const slug = canonicalMatchupSlug(t.pick.character_slug, t.other.character_slug);
              return (
                <li key={t.matchup_id}>
                  <Link
                    href={`/one-piece/vs/${slug}`}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-surface p-2 transition hover:border-white/15"
                  >
                    <Avatar card={t.pick} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        Picked <span className="font-bold">{t.pick.character_name}</span> over{" "}
                        {t.other.character_name}
                      </p>
                      <p className="font-mono text-xs text-accent-2">
                        only {t.your_side_pct}% agree · {t.vote_count.toLocaleString()} votes
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/one-piece/arena" className="text-accent-2 underline-offset-4 hover:underline">
          Build your own record in the Arena
        </Link>
      </p>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-surface p-3 text-center">
      <p className="font-display text-2xl">{value}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

function Avatar({ card }: { card: FormCard }) {
  const url = characterImageUrl(card.image_path);
  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-black/40">
      {url && <Image src={url} alt={card.character_name} fill sizes="44px" className="object-cover object-top" />}
    </div>
  );
}
