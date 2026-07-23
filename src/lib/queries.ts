import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { FormCard } from "@/lib/types";

// Pages that render for anyone (matchup pages) pass a cookie-free public client
// so they can be cached; per-user pages fall back to the cookie-based client.
type DB = SupabaseClient;

// The current viewer's spoiler ceiling (max arc position they've seen), or null
// for "caught up / no gate". Works for both authed users and cookie-only guests.
export async function getViewerMaxArcPosition(seriesSlug: string): Promise<number | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: prog } = await supabase
      .from("user_series_progress")
      .select("caught_up, arcs(position), series!inner(slug)")
      .eq("series.slug", seriesSlug)
      .eq("user_id", user.id)
      .maybeSingle();
    if (prog && !prog.caught_up) {
      const arc = prog.arcs as unknown as { position: number } | { position: number }[] | null;
      const row = Array.isArray(arc) ? arc[0] : arc;
      return row?.position ?? null;
    }
    return null;
  }
  const cookieStore = await cookies();
  const v = cookieStore.get("sv-arc-pos")?.value;
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type CharacterStats = {
  nicknames?: string[];
  status?: string | null;
  bounty?: number | null;
  haki?: { conqueror: boolean; armament: boolean; observation: boolean } | null;
  devil_fruit?: { type: string | null; name_en: string | null; name_ja: string | null } | null;
  affiliation?: string | null;
  other_affiliations?: string[];
  demographics?: {
    gender: string | null;
    race: string | null;
    origin: string | null;
    age: number | null;
    height_cm: number | null;
  } | null;
  debut?: { arc: string | null; chapter: number | null; episode: number | null } | null;
  power_level?: number | null;
  wiki_url?: string | null;
};

export type CharacterFull = {
  id: string;
  slug: string;
  name: string;
  epithet: string | null;
  stats: CharacterStats;
  debut_position: number | null;
  forms: Array<{
    id: string;
    slug: string;
    name: string;
    is_default: boolean;
    image_path: string | null;
    reveal_position: number | null;
    display_rating: number | null;
    tier: string | null;
  }>;
};

export async function getCharacter(
  seriesSlug: string,
  charSlug: string,
  db?: DB,
): Promise<CharacterFull | null> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("characters")
    .select(
      `id, slug, name, epithet, stats,
       debut:arcs!characters_debut_arc_id_series_id_fkey(position),
       series!inner(slug),
       forms(id, slug, name, is_default, image_path, is_active,
             reveal:arcs!forms_reveal_arc_id_fkey(position),
             ratings(display_rating, tier))`,
    )
    .eq("series.slug", seriesSlug)
    .eq("slug", charSlug)
    .maybeSingle();
  if (!data) return null;

  const forms = (data.forms as unknown as Array<{
    id: string;
    slug: string;
    name: string;
    is_default: boolean;
    image_path: string | null;
    is_active: boolean;
    reveal: { position: number } | { position: number }[] | null;
    ratings: { display_rating: number; tier: string | null } | { display_rating: number; tier: string | null }[] | null;
  }>)
    .filter((f) => f.is_active)
    .map((f) => {
      const reveal = Array.isArray(f.reveal) ? f.reveal[0] : f.reveal;
      const rating = Array.isArray(f.ratings) ? f.ratings[0] : f.ratings;
      return {
        id: f.id,
        slug: f.slug,
        name: f.name,
        is_default: f.is_default,
        image_path: f.image_path,
        reveal_position: reveal?.position ?? null,
        display_rating: rating?.display_rating ?? null,
        tier: rating?.tier ?? null,
      };
    })
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));

  const debut = Array.isArray(data.debut) ? data.debut[0] : data.debut;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    epithet: data.epithet,
    stats: (data.stats ?? {}) as CharacterStats,
    debut_position: (debut as { position: number } | null)?.position ?? null,
    forms,
  };
}

// The tally read itself lives in src/lib/cached.ts (getCachedMatchupTally) —
// this is just the shared shape.
export type MatchupTally = {
  matchup_id: string | null;
  vote_count: number;
  a_wins: number;
  a: FormCard;
  b: FormCard;
};

export function formToCard(
  f: CharacterFull["forms"][number],
  char: { slug: string; name: string; epithet: string | null },
): FormCard {
  return {
    form_id: f.id,
    form_slug: f.slug,
    form_name: f.name,
    character_slug: char.slug,
    character_name: char.name,
    epithet: char.epithet,
    image_path: f.image_path,
    display_rating: f.display_rating,
    tier: f.tier,
  };
}
