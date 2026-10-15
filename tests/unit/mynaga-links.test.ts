// MyNaga entry points (Task 11; ParaNaga_Build_Prompt.md §9E, verified 15 October 2026) and the
// sources register formatting. Pure domain, no DOM.
import { describe, expect, it } from "vitest";
import { MYNAGA_LINKS, detectPlatform, mynagaLinksFor } from "@/domain/mynaga/links";
import { QUERY_ALLOW_LIST, externalHref, sourceMetaLine, sourceTitleLine } from "@/domain/sources/present";
import SOURCES from "../e2e/fixtures/network/sources.json" with { type: "json" };

const BRIEF_URLS = [
  "https://play.google.com/store/apps/details?id=com.easybusph.myNaga",
  "https://apps.apple.com/ph/app/mynaga/id6748720972",
  "https://mynaga.app/",
  "https://www2.naga.gov.ph/available-mynaga-app/",
];

describe("MyNaga links", () => {
  it("are exactly the four verified entry points of the brief, with their labels", () => {
    expect(MYNAGA_LINKS.map((l) => l.url)).toEqual(BRIEF_URLS);
    expect(MYNAGA_LINKS.map((l) => l.label)).toEqual([
      "Get MyNaga on Google Play",
      "Get MyNaga on the App Store",
      "Open mynaga.app",
      "About MyNaga (City of Naga)",
    ]);
  });

  it("carry no query string, except the Play Store's fixed app id (no deep link, no report data)", () => {
    for (const link of MYNAGA_LINKS) {
      const url = new URL(link.url);
      expect(url.protocol).toBe("https:");
      expect(url.hash).toBe("");
      if (link.id === "play") expect(url.search).toBe("?id=com.easybusph.myNaga");
      else expect(link.url).not.toContain("?");
    }
  });

  it("lists the store matching the platform first", () => {
    expect(mynagaLinksFor("ios").map((l) => l.id)).toEqual(["appstore", "play", "website", "about"]);
    expect(mynagaLinksFor("android").map((l) => l.id)).toEqual(["play", "appstore", "website", "about"]);
    expect(mynagaLinksFor("other").map((l) => l.id)).toEqual(["play", "appstore", "website", "about"]);
  });

  it("detects the platform from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36", 5)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("ios");
    // iPadOS reports a Mac user agent; touch points tell it apart.
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe("other");
  });
});

describe("sources register lines", () => {
  const source = {
    code: "S01",
    title: "Naga approved LPTRP, Ordinance 2025-070",
    url: "https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2025-070/",
    evidenceType: "official",
    publishedOrEnacted: "2025-09-23",
    checkedOn: "2026-10-15",
  };

  it("titles a source '{code} · {title}'", () => {
    expect(sourceTitleLine(source)).toBe("S01 · Naga approved LPTRP, Ordinance 2025-070");
  });

  it("formats evidence type, published date or text, and checked date", () => {
    expect(sourceMetaLine(source)).toBe("Official · published 23 Sep 2025 · checked 15 Oct 2026");
    expect(sourceMetaLine({ ...source, evidenceType: "official_historical", publishedOrEnacted: "1993" })).toBe(
      "Official historical · published 1993 · checked 15 Oct 2026",
    );
    expect(
      sourceMetaLine({ ...source, evidenceType: "LGU_branded_graphic_via_project_participant;visually_inspected", publishedOrEnacted: null, checkedOn: null }),
    ).toBe("LGU branded graphic via project participant, visually inspected · publication date not recorded · check date not recorded");
    expect(sourceMetaLine({ ...source, evidenceType: null, publishedOrEnacted: "2025-09-10; updated 2025-09-23" })).toBe(
      "Evidence type not recorded · published 2025-09-10; updated 2025-09-23 · checked 15 Oct 2026",
    );
  });

  it("links a query string only for the allow-listed pages (My Maps viewer, Play listing)", () => {
    expect(externalHref("https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4")).not.toBeNull();
    // S40: the KML export downloads a file, so it is never offered as a link.
    expect(externalHref("https://www.google.com/maps/d/kml?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4&forcekml=1")).toBeNull();
    expect(externalHref("https://www.google.com/maps/d/viewer?mid=x&ll=1,2")).toBeNull();
    expect(externalHref("https://example.org/page?ref=paranaga")).toBeNull();
    expect(externalHref("https://example.org/page")).toBe("https://example.org/page");
    for (const link of MYNAGA_LINKS) expect(externalHref(link.url)).toBe(link.url);
  });

  it("every register address in the fixture links only with an empty query or an allow-listed one", () => {
    for (const s of SOURCES.sources) {
      const href = externalHref(s.url);
      if (href === null) continue;
      const url = new URL(href);
      const allowed = QUERY_ALLOW_LIST.some((a) => url.hostname === a.host && url.pathname === a.path);
      expect(url.search === "" || allowed, s.code).toBe(true);
    }
  });

  it("links only http(s) addresses", () => {
    expect(externalHref(source.url)).toBe(source.url);
    expect(externalHref(null)).toBeNull();
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("not a url")).toBeNull();
  });
});
