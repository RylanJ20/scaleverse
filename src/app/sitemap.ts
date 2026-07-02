import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { canonicalMatchupSlug } from "@/lib/matchup-slug";
import { SITE_URL } from "@/lib/site";

const SERIES = "one-piece";
// only index matchups with real engagement (thin-page gating, per the SEO plan)
const MATCHUP_VOTE_THRESHOLD = 3;
const MAX_MATCHUP_URLS = 10_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/${SERIES}/tier-list`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/${SERIES}/characters`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/${SERIES}/arena`, changeFrequency: "monthly", priority: 0.5 },
  ];

  // every active default-form character page
  const { data: chars } = await supabase
    .from("forms")
    .select("characters!inner(slug, series!inner(slug))")
    .eq("is_active", true)
    .eq("is_default", true)
    .eq("characters.series.slug", SERIES)
    .limit(2000);
  const charRoutes: MetadataRoute.Sitemap = (chars ?? []).map((f) => {
    const c = f.characters as unknown as { slug: string };
    return {
      url: `${SITE_URL}/${SERIES}/characters/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    };
  });

  // matchup pages that have crossed the vote threshold, keyed by character slugs
  const { data: matchups } = await supabase
    .from("matchups")
    .select("form_a_id, form_b_id, vote_count")
    .gte("vote_count", MATCHUP_VOTE_THRESHOLD)
    .order("vote_count", { ascending: false })
    .limit(MAX_MATCHUP_URLS);

  let matchupRoutes: MetadataRoute.Sitemap = [];
  if (matchups?.length) {
    const formIds = [...new Set(matchups.flatMap((m) => [m.form_a_id, m.form_b_id]))];
    const { data: forms } = await supabase
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
          url: `${SITE_URL}/${SERIES}/vs/${canonicalMatchupSlug(a, b)}`,
          changeFrequency: "daily" as const,
          priority: 0.5,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  return [...staticRoutes, ...charRoutes, ...matchupRoutes];
}
