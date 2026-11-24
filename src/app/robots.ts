import type { MetadataRoute } from "next";
import { SITE_URL } from "@/ui/landing/site-url";

// robots.txt: the public site and the app may be crawled; the JSON API and the admin area may not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
