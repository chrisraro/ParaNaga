// Copy honesty for the landing page (docs/spec/06-screens.md §6.5): marketing copy follows the same
// rules as the app. Scans the landing's source with comments removed, so the words a visitor can
// read (copy, alt text, labels) are what is checked.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { ROUTES, SHOWCASE_SCREENS } from "@/ui/landing/landing-content";

const L = en.landing;
const DIR = path.resolve("src/ui/landing");
const FILES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && f !== "hero-lines.ts");

/** Every string in the English landing dictionary (message functions called with a placeholder). */
const words = (tree: unknown): string[] =>
  typeof tree === "string" ? [tree] : typeof tree === "function" ? [(tree as (x: number) => string)(50)] : Object.values(tree as object).flatMap(words);

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
// The copy now lives in the dictionary (T14), so the scan covers the code and the English landing copy.
const SOURCE = [...FILES.map((f) => stripComments(readFileSync(path.join(DIR, f), "utf8"))), ...words(L)].join("\n");

const FORBIDDEN: [string, RegExp][] = [
  ["ETA", /\bETA\b/],
  ["live", /\blive\b/i],
  ["arriving", /\barriv(ing|al|es)\b/i],
  ["real-time", /\breal[\s-]?time\b/i],
  ["e-jeepney", /\be-?jeep/i],
  ["guaranteed", /\bguarantee/i],
  ["official claims", /\bofficial app\b/i],
  ["testimonials or ratings", /\b(testimonial|\d(\.\d)? stars?|rated \d)/i],
  ["store badges", /\b(app store|google play)\b/i],
];

describe("landing copy", () => {
  it("scans the landing source (so the scan is not silently empty)", () => {
    expect(FILES).toEqual(expect.arrayContaining(["landing-page.tsx", "landing-content.ts", "site-header.tsx"]));
    expect(SOURCE).toContain(L.hero.lede);
  });

  for (const [name, re] of FORBIDDEN) {
    it(`never says ${name}`, () => {
      expect(SOURCE.match(re)?.[0] ?? null).toBeNull();
    });
  }

  it("calls nothing verified except to say it is not", () => {
    for (const m of SOURCE.matchAll(/\bverified\b/gi)) {
      const before = SOURCE.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      expect(before, SOURCE.slice(m.index - 40, m.index + 20)).toMatch(/\bnot (yet )?$|\bnot verified|un$/);
    }
  });

  it("never times a tricycle or a padyak", () => {
    const sentences = SOURCE.split(/[.!?:,]\s|\n|["`]/);
    for (const s of sentences.filter((x) => /tricycle|padyak/i.test(x))) expect(s, s).not.toMatch(/\b\d+\s*(min|minutes?)\b/i);
  });

  it("gives times only as ranges", () => {
    for (const m of SOURCE.matchAll(/(\d+)\s*(?:min|minutes?)\b/gi)) {
      expect(SOURCE.slice(Math.max(0, m.index - 12), m.index + m[0].length), m[0]).toMatch(/\d+\s*(to|–|-)\s*\d+\s*(min|minutes?)/i);
    }
  });

  it("says routes are provisional and fares are estimates, up front", () => {
    expect(L.hero.note).toMatch(/provisional/);
    expect(L.hero.note).toMatch(/estimates/);
    expect(L.faq.tracking.q).toMatch(/where the jeepney is/);
  });

  it("names jeepney routes by sign letter only where the app has one", () => {
    expect(ROUTES).toHaveLength(11);
    expect(ROUTES.filter((r) => r.letter).map((r) => r.letter)).toEqual(["A", "B", "C", "D"]);
    expect(ROUTES[0]).toEqual({ letter: null, title: "Centro-Cararayan-San Isidro" });
    expect(L.ride.jeepney.body).toContain("Centro-Del Rosario via Magsaysay Ave");
  });

  it("describes every capture it shows", () => {
    for (const screen of SHOWCASE_SCREENS) expect(L.alt[screen].length).toBeGreaterThan(40);
  });
});
