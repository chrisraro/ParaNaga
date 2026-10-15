import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The theme pattern (Task 2): every dark rule is written twice, once for the explicit choice
// (`[data-theme="dark"]`) and once inside `@media (prefers-color-scheme: dark)` for System
// (`:not([data-theme="light"])`). This guards the two copies against drifting apart.
const FILES = [
  "src/app/globals.css",
  "src/ui/detail/detail.css",
  "src/ui/home/home-screen.css",
  "src/ui/kit/kit.css",
  "src/ui/map/naga-map.css",
  "src/ui/trip/trip.css",
];

type Rule = { selector: string; body: string };

const DARK_ATTR = '[data-theme="dark"]';
const NOT_LIGHT = ':not([data-theme="light"])';
const DARK_QUERY = /\(prefers-color-scheme:\s*dark\)/;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Rules with their declarations, top level and one @media level deep, comments stripped. */
function parse(css: string): { plain: Rule[]; system: Rule[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const plain: Rule[] = [];
  const system: Rule[] = [];
  const blockEnd = (open: number): number => {
    let depth = 0;
    for (let j = open; j < src.length; j += 1) {
      if (src[j] === "{") depth += 1;
      else if (src[j] === "}" && --depth === 0) return j;
    }
    throw new Error("unbalanced CSS");
  };
  const flat = (block: string): Rule[] =>
    [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: normalize(m[1]!), body: normalize(m[2]!) }));

  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    const prelude = normalize(src.slice(i, open));
    const close = blockEnd(open);
    const inner = src.slice(open + 1, close);
    if (prelude.startsWith("@media")) {
      // Other media features of a dark query (reduced transparency) stay part of the selector key.
      const other = normalize(prelude.replace(/^@media/, "").replace(DARK_QUERY, "").replace(/^\s*and\s*|\s*and\s*$/g, ""));
      const target = DARK_QUERY.test(prelude) ? system : plain;
      for (const r of flat(inner)) target.push({ selector: other ? `${other} ${r.selector}` : r.selector, body: r.body });
    } else if (!prelude.startsWith("@")) {
      plain.push({ selector: prelude, body: normalize(inner) });
    }
    i = close + 1;
  }
  return { plain, system };
}

describe("dark theme blocks", () => {
  for (const file of FILES) {
    it(`${file}: every [data-theme="dark"] rule has an identical prefers-color-scheme twin`, () => {
      const { plain, system } = parse(readFileSync(path.resolve(file), "utf8"));
      for (const r of system) {
        expect(r.selector.split(",").every((s) => s.includes(NOT_LIGHT)), `${r.selector} is scoped to System`).toBe(true);
      }
      const explicit = plain
        .filter((r) => r.selector.includes(DARK_ATTR))
        .map((r) => ({ selector: r.selector.replaceAll(DARK_ATTR, NOT_LIGHT), body: r.body }));
      expect(system).toEqual(explicit);
    });
  }

  it("finds the blocks it guards", () => {
    const { system } = parse(readFileSync(path.resolve("src/ui/home/home-screen.css"), "utf8"));
    expect(system.length).toBeGreaterThanOrEqual(2);
  });
});
