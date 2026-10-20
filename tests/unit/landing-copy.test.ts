// Copy honesty for the landing page (docs/spec/06-screens.md §6.5): marketing copy follows the same
// rules as the app. Scans the landing's source with comments removed, so the words a visitor can
// read (copy, alt text, labels) are what is checked.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ, HERO, MODES, ROUTES, SCREEN_ALT, SHOWCASE } from "@/ui/landing/landing-content";

const DIR = path.resolve("src/ui/landing");
const FILES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && f !== "hero-lines.ts");

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const SOURCE = FILES.map((f) => stripComments(readFileSync(path.join(DIR, f), "utf8"))).join("\n");

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
    expect(SOURCE).toContain(HERO.lede);
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
    expect(HERO.note).toMatch(/provisional/);
    expect(HERO.note).toMatch(/estimates/);
    expect(FAQ.some(([q]) => /where the jeepney is/.test(q))).toBe(true);
  });

  it("names jeepney routes by sign letter only where the app has one", () => {
    expect(ROUTES).toHaveLength(11);
    expect(ROUTES.filter((r) => r.letter).map((r) => r.letter)).toEqual(["E", "I", "J", "A", "B", "C", "D"]);
    expect(MODES.jeepney.body).toContain("E Centro-Del Rosario via Magsaysay Ave");
  });

  it("describes every capture it shows", () => {
    for (const s of SHOWCASE) expect(SCREEN_ALT[s.screen].length).toBeGreaterThan(40);
  });
});
