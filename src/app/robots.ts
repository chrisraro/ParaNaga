import type { MetadataRoute } from "next";

// robots.txt: the public site and the app may be crawled; the JSON API and the admin area may not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/"],
    },
  };
}
