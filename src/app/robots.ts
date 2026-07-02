import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // no crawl value in gating the voting loop or auth flows
      disallow: ["/login", "/choose-username", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
