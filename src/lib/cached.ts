import "server-only";
import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCharacter, type CharacterFull, type MatchupTally } from "@/lib/queries";
import { canonicalMatchupSlug } from "@/lib/matchup-slug";
import { characterImageUrl } from "@/lib/image";
import { SITE_URL } from "@/lib/site";
import type { ArcOption, FormCard, MatchupItem } from "@/lib/types";
import type { Take } from "@/app/actions/social";

// Shared "use cache" read layer (Cache Components). Everything here is
// world-readable data (ratified #27: DB content is public; gating is app-layer),
// fetched once per revalidate window instead of per request — Supabase free-tier
// egress is the scarcest resource this app has. Spoiler gating is applied by
// CALLERS per request: entries are cached UNGATED per series and filtered
// against the viewer's arc ceiling after the cache read, so no viewer ever
// renders past their gate and every viewer shares the same entry.
//
// Tags: "ratings" is revalidated by the fit-ratings job via
// /api/revalidate-ratings after each refit. The rest expire by TTL only
// (never revalidated per vote, by design).

// One roster row per active form — the tier list's raw material, ungated.
export type RosterRow = {
  form_id: string;
  name: string;
  image_path: string | null;
  character_slug: string;
  rating: number;
  tier: string | null;
  debut_pos: number | null;
  reveal_pos: number | null;
};

export async function getCachedTierListRoster(seriesSlug: string): Promise<RosterRow[]> {
  "use cache";
  cacheLife("ratings");
  cacheTag("ratings", `roster:${seriesSlug}`);

  const db = createPublicClient();
  const { data } = await db
    .from("forms")
    .select(
      `id, name, image_path, is_active,
       characters!inner(slug, series!inner(slug), debut:arcs!characters_debut_arc_id_series_id_fkey(position)),
       reveal:arcs!forms_reveal_arc_id_fkey(position),
       ratings(display_rating, tier)`,
    )
    .eq("is_active", true)
    .eq("characters.series.slug", seriesSlug)
    .limit(1000);

  return (data ?? []).map((f) => {
    const character = f.characters as unknown as { slug: string; debut: { position: number } | null };
    const rating = f.ratings as unknown as { display_rating: number; tier: string | null } | null;
    return {
      form_id: f.id,
      name: f.name,
      image_path: f.image_path,
      character_slug: character.slug,
      rating: rating?.display_rating ?? 1000,
      tier: rating?.tier ?? null,
      debut_pos: character.debut?.position ?? null,
      reveal_pos: (f.reveal as unknown as { position: number } | null)?.position ?? null,
    };
  });
}

// One entry per character (default form) — the browse index, ungated.
export type IndexEntry = {
  slug: string;
  name: string;
  epithet: string | null;
  image_url: string | null;
  rating: number;
  tier: string | null;
  debut_pos: number | null;
  reveal_pos: number | null;
};

export async function getCachedCharacterIndex(seriesSlug: string): Promise<IndexEntry[]> {
  "use cache";
  cacheLife("ratings");
  cacheTag("ratings", `roster:${seriesSlug}`);

  const db = createPublicClient();
  const { data } = await db
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
    .eq("characters.series.slug", seriesSlug)
    .limit(1000);

  return (data ?? []).map((f) => {
    const c = f.characters as unknown as {
      slug: string;
      name: string;
      epithet: string | null;
      debut: { position: number } | null;
    };
    const rating = f.ratings as unknown as { display_rating: number; tier: string | null } | null;
    return {
      slug: c.slug,
      name: c.name,
      epithet: c.epithet,
      image_url: characterImageUrl(f.image_path),
      rating: rating?.display_rating ?? 1000,
      tier: rating?.tier ?? null,
      debut_pos: c.debut?.position ?? null,
      reveal_pos: (f.reveal as unknown as { position: number } | null)?.position ?? null,
    };
  });
}

export async function getCachedCharacter(
  seriesSlug: string,
  charSlug: string,
): Promise<CharacterFull | null> {
  "use cache";
  cacheLife("ratings");
  cacheTag("ratings", `character:${seriesSlug}:${charSlug}`);
  return getCharacter(seriesSlug, charSlug, createPublicClient());
}

// Inner cached read keyed only by the pair ids (cards stay out of the key).
async function getCachedTallyRow(
  loId: string,
  hiId: string,
): Promise<{ matchup_id: string | null; vote_count: number; lo_wins: number }> {
  "use cache";
  cacheLife("short");
  cacheTag(`tally:${loId}:${hiId}`);

  const db = createPublicClient();
  const { data: m } = await db
    .from("matchups")
    .select("id, vote_count, a_wins")
    .eq("form_a_id", loId)
    .eq("form_b_id", hiId)
    .maybeSingle();
  return { matchup_id: m?.id ?? null, vote_count: m?.vote_count ?? 0, lo_wins: m?.a_wins ?? 0 };
}

// Same shape as queries.getMatchupTally, backed by the cached pair read.
export async function getCachedMatchupTally(
  formA: { id: string },
  formB: { id: string },
  cardA: FormCard,
  cardB: FormCard,
): Promise<MatchupTally> {
  const [lo, hi] = [formA.id, formB.id].sort();
  const m = await getCachedTallyRow(lo, hi);
  const aIsLo = cardA.form_id === lo;
  return {
    matchup_id: m.matchup_id,
    vote_count: m.vote_count,
    a_wins: aIsLo ? m.lo_wins : m.vote_count - m.lo_wins,
    a: cardA,
    b: cardB,
  };
}

// Today's featured matchup. The RPC may CREATE the row (service role), which is
// why it must never be client-invokable — it lives here, not in a "use server"
// file. First hit of a cache window does the create; everyone else reads.
export async function getCachedDailyMatchup(seriesSlug: string): Promise<MatchupItem | null> {
  "use cache";
  // The daily rolls at UTC midnight (the RPC keys on current_date), so the
  // entry must EXPIRE at midnight — otherwise a fresh post-midnight load can
  // serve yesterday's matchup, whose takes the post_take RPC rejects as closed.
  const secsToUtcMidnight = Math.ceil((Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1,
  ) - Date.now()) / 1000);
  // floor of 360s: an expire under 5 minutes is EXCLUDED from prerenders
  // (becomes a dynamic hole), which fails the home build when it runs within
  // ~5 min of UTC midnight. Worst case the old daily lives ~6 min into the new
  // day — bounded, and post_take's "takes closed" path already covers it.
  const expire = Math.max(360, secsToUtcMidnight);
  const revalidate = Math.min(300, Math.max(60, expire - 60));
  cacheLife({ stale: Math.min(300, revalidate), revalidate, expire });
  cacheTag(`daily:${seriesSlug}`);

  // A build environment without the service key (or an unreachable DB) must
  // degrade to "no daily section" — never fail the build. SWR retries shortly.
  if (!process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_daily_matchup", { p_series_slug: seriesSlug });
    if (error || !data) return null;
    return data as MatchupItem;
  } catch {
    return null;
  }
}

// Takes on a matchup — public content; posting your own take updateTag()s this.
export async function getCachedTakes(matchupId: string): Promise<Take[]> {
  "use cache";
  cacheLife("short");
  cacheTag(`takes:${matchupId}`);

  const db = createPublicClient();
  const { data: takes } = await db
    .from("takes")
    .select("id, body, created_at, user_id")
    .eq("matchup_id", matchupId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!takes?.length) return [];

  const ids = [...new Set(takes.map((t) => t.user_id))];
  const { data: profiles } = await db.from("profiles").select("id, username").in("id", ids);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  return takes.map((t) => ({
    id: t.id,
    body: t.body,
    created_at: t.created_at,
    username: nameById.get(t.user_id) ?? null,
  }));
}

// Public profile record (get_profile is granted to anon).
export async function getCachedProfile(username: string): Promise<unknown> {
  "use cache";
  cacheLife("short");
  cacheTag(`profile:${username}`);

  const db = createPublicClient();
  const { data } = await db.rpc("get_profile", { p_username: username });
  return data ?? null;
}

// Arc list for a series (static content — powers the first-touch spoiler gate
// on browse surfaces without a per-request read).
export async function getCachedArcs(seriesSlug: string): Promise<ArcOption[]> {
  "use cache";
  cacheLife("hourly");
  cacheTag(`arcs:${seriesSlug}`);

  const db = createPublicClient();
  const { data } = await db
    .from("arcs")
    .select("slug, name, position, series!inner(slug)")
    .eq("series.slug", seriesSlug)
    .order("position");
  return (data ?? []).map(({ slug, name, position }) => ({ slug, name, position }));
}

// Live verses for the homepage select screen; created_at order = launch order.
// Verse #2 appears here (and gets a hub page) by inserting a series row — no
// code change (series-scoped invariant).
export type SeriesInfo = { slug: string; name: string };

export async function getCachedSeriesList(): Promise<SeriesInfo[]> {
  "use cache";
  cacheLife("hourly");
  cacheTag("series");

  const db = createPublicClient();
  const { data, error } = await db.from("series").select("slug, name").order("created_at");
  // Throw on failure so it is never cached: SWR keeps serving the last good
  // list, whereas a cached [] would blank the front door for a full hour.
  if (error) throw new Error(`series list read failed: ${error.message}`);
  return data ?? [];
}

// Slug lookup for the verse hub — null means notFound(), the only place the
// [series] segment itself is validated.
export async function getCachedSeries(seriesSlug: string): Promise<SeriesInfo | null> {
  "use cache";
  cacheLife("hourly");
  cacheTag("series");

  const db = createPublicClient();
  const { data, error } = await db
    .from("series")
    .select("slug, name")
    .eq("slug", seriesSlug)
    .maybeSingle();
  // null strictly means "unknown slug" (callers 404 on it) — a DB failure must
  // throw so it is never cached as an hour-long 404 of the hub.
  if (error) throw new Error(`series read failed: ${error.message}`);
  return data ?? null;
}

// Movement baseline: the nearest FULL rating snapshot at least `hoursBack` old.
// Every fit writes all forms atomically, so one fit_at is a consistent
// baseline. null fitAt = no baseline yet (history is sparse until votes flow) —
// callers show no movement rather than zeros. rating_history is global; the
// series arg exists for cache keying/tags as more verses arrive.
export type MovementBaseline = { fitAt: string | null; ratings: Record<string, number> };

export async function getCachedMovementBaseline(
  seriesSlug: string,
  hoursBack: number,
): Promise<MovementBaseline> {
  "use cache";
  cacheLife("ratings");
  cacheTag("ratings", `movement:${seriesSlug}:${hoursBack}`);

  const db = createPublicClient();
  // bounded window: a baseline older than 2× the window would present stale
  // movement as current (the fit skips idle periods, so gaps are normal) —
  // better no carets than dishonest ones
  const cutoff = new Date(Date.now() - hoursBack * 3600_000).toISOString();
  const floor = new Date(Date.now() - 2 * hoursBack * 3600_000).toISOString();
  const { data: fit } = await db
    .from("rating_history")
    .select("fit_at")
    .lte("fit_at", cutoff)
    .gte("fit_at", floor)
    .order("fit_at", { ascending: false })
    .limit(1);
  const fitAt: string | null = fit?.[0]?.fit_at ?? null;
  if (!fitAt) return { fitAt: null, ratings: {} };

  const { data } = await db
    .from("rating_history")
    .select("form_id, display_rating")
    .eq("fit_at", fitAt)
    .limit(1000);
  return {
    fitAt,
    ratings: Object.fromEntries((data ?? []).map((r) => [r.form_id as string, r.display_rating as number])),
  };
}

// Per-form rating trajectory for sparklines (most recent points, oldest-first).
export type FormHistoryPoint = { fit_at: string; display_rating: number };

export async function getCachedFormHistory(formId: string): Promise<FormHistoryPoint[]> {
  "use cache";
  cacheLife("ratings");
  cacheTag("ratings");

  const db = createPublicClient();
  const { data } = await db
    .from("rating_history")
    .select("fit_at, display_rating")
    .eq("form_id", formId)
    .order("fit_at", { ascending: false })
    .limit(120);
  return (data ?? [])
    .map((r) => ({ fit_at: r.fit_at as string, display_rating: r.display_rating as number }))
    .reverse();
}

// Sitemap payload — the single biggest crawler egress line (up to 10k matchup
// rows) — refreshed hourly instead of per crawl.
const MATCHUP_VOTE_THRESHOLD = 3;
const MAX_MATCHUP_URLS = 10_000;

export async function getCachedSitemapEntries(seriesSlug: string): Promise<MetadataRoute.Sitemap> {
  "use cache";
  cacheLife("hourly");
  // NOT tagged "ratings": the sitemap doesn't depend on ratings, and the
  // 10-minute fit webhook would defeat the hourly TTL (crawler egress).
  cacheTag(`sitemap:${seriesSlug}`);

  const db = createPublicClient();

  const { data: chars } = await db
    .from("forms")
    .select("characters!inner(slug, series!inner(slug))")
    .eq("is_active", true)
    .eq("is_default", true)
    .eq("characters.series.slug", seriesSlug)
    .limit(2000);
  const charRoutes: MetadataRoute.Sitemap = (chars ?? []).map((f) => {
    const c = f.characters as unknown as { slug: string };
    return {
      url: `${SITE_URL}/${seriesSlug}/characters/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    };
  });

  const { data: matchups } = await db
    .from("matchups")
    .select("form_a_id, form_b_id, vote_count")
    .gte("vote_count", MATCHUP_VOTE_THRESHOLD)
    .order("vote_count", { ascending: false })
    .limit(MAX_MATCHUP_URLS);

  let matchupRoutes: MetadataRoute.Sitemap = [];
  if (matchups?.length) {
    const formIds = [...new Set(matchups.flatMap((m) => [m.form_a_id, m.form_b_id]))];
    const { data: forms } = await db
      .from("forms")
      .select("id, characters(slug)")
      .in("id", formIds);
    const slugByForm = new Map(
      (forms ?? []).map((f) => [f.id, (f.characters as unknown as { slug: string })?.slug]),
    );
    matchupRoutes = matchups
      .map((m) => {
        const a = slugByForm.get(m.form_a_id);
        const b = slugByForm.get(m.form_b_id);
        if (!a || !b) return null;
        return {
          url: `${SITE_URL}/${seriesSlug}/vs/${canonicalMatchupSlug(a, b)}`,
          changeFrequency: "daily" as const,
          priority: 0.5,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  return [...charRoutes, ...matchupRoutes];
}
