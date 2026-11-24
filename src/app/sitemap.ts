import type { MetadataRoute } from "next";
import { ARTICLES, articleHref } from "@/ui/help/articles";
import { SITE_URL } from "@/ui/landing/site-url";

// The fixed public pages only: no record ids, and nothing personal (saved, reports, sign-in).
const PATHS = ["/", "/app", "/app/explore", "/app/leaving", "/app/help", ...ARTICLES.map((a) => articleHref(a.slug)), "/app/help/sources"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: new URL(path, SITE_URL).href }));
}
