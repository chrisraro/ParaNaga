import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { en } from "@/i18n/en";
import { fil } from "@/i18n/fil";
import { deepLink } from "@/ui/app-gate/deep-link";
import { SITE_URL } from "@/ui/landing/site-url";

describe("sitemap and robots", () => {
  it("lists fixed public pages on the canonical domain only", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/app/help/using-lunad-offline`);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith(`${SITE_URL}/`), url).toBe(true);
      expect(url).not.toMatch(/admin|\/api|report|saved|sign-in|more|\/(stops|routes|places|terminals|community)/);
    }
  });

  it("keeps crawlers out of the admin area and the API, and names the sitemap", () => {
    expect(robots()).toMatchObject({ rules: { disallow: ["/api/", "/admin"] }, sitemap: `${SITE_URL}/sitemap.xml` });
  });
});

describe("the gate's link", () => {
  const origin = "https://lunad-app.vercel.app";
  const link = (pathname: string, search = "") => deepLink({ origin, pathname, search });

  it("keeps the path and the query", () => {
    expect(link("/app/routes/R4")).toBe(`${origin}/app/routes/R4`);
    expect(link("/app/explore", "?c=schools%20x")).toBe(`${origin}/app/explore?c=schools%20x`);
  });

  it("drops sign-in values and the hash", () => {
    expect(link("/app/report", "?neon_auth_session_verifier=s3cret&stop=4")).toBe(`${origin}/app/report?stop=4`);
    expect(link("/app", "?token=s3cret")).toBe(`${origin}/app`);
    expect(deepLink(new URL(`${origin}/app/saved#s3cret`))).toBe(`${origin}/app/saved`);
  });

  it("stays on this site and short enough to scan", () => {
    expect(new URL(link("//evil.example/app")).origin).toBe(origin);
    expect(link("/app/search", `?q=${"a".repeat(700)}`)).toBe(`${origin}/app/search`);
    expect(link(`/app/${"a".repeat(700)}`)).toBe(`${origin}/app`);
  });
});

it("the directions copy promises no street map the capture does not show", () => {
  for (const t of [en, fil]) expect(`${t.landing.showcase.directions.title} ${t.landing.showcase.directions.body}`).not.toMatch(/street map|mapa ng kalye/i);
});
