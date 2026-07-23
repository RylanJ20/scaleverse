import type { NextConfig } from "next";

const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://akgkkbynyghnwpnetykj.supabase.co").hostname;

const nextConfig: NextConfig = {
  // Cache Components (PPR + "use cache"). Every cached read in src/lib/cached.ts
  // exists to keep Supabase egress off the request path (free-tier egress is the
  // site's scarcest resource — it has gone down once already).
  cacheComponents: true,
  cacheLife: {
    // ratings-derived surfaces: refreshed by the fit webhook; TTL is the backstop
    ratings: { stale: 300, revalidate: 600, expire: 86400 },
    // vote tallies / daily matchup / takes / profiles: no webhook, short SWR
    short: { stale: 300, revalidate: 300, expire: 3600 },
    // crawler surfaces (sitemap, OG data)
    hourly: { stale: 300, revalidate: 3600, expire: 86400 },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
