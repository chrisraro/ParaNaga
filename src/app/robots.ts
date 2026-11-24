import type { MetadataRoute } from "next";
import { SITE_URL } from "@/ui/landing/site-url";

// robots.txt: the public site and the app may be crawled; the JSON API may not (the admin area is never named: it answers 404).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
