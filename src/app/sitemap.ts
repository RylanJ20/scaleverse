import type { MetadataRoute } from "next";
import { getCachedSitemapEntries } from "@/lib/cached";
import { SITE_URL } from "@/lib/site";

const SERIES = "one-piece";

// All DB reads live behind the hourly "use cache" helper — crawler fetches of
// the sitemap no longer touch Supabase (this was up to ~10k rows per crawl).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/${SERIES}`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/${SERIES}/tier-list`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/${SERIES}/characters`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/${SERIES}/arena`, changeFrequency: "monthly", priority: 0.5 },
  ];
  const entries = await getCachedSitemapEntries(SERIES);
  return [...staticRoutes, ...entries];
}
