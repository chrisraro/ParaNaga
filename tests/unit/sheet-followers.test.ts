// Map chrome that sits on the sheet's edge reads --naga-map-attribution-bottom. During a sheet drag
// the value is written to elements marked data-sheet-follower (home-screen.tsx), not to the root, so
// an unmarked consumer would sit still until the release. This scans the source and fails for it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const VAR = "--naga-map-attribution-bottom";
const SRC = path.resolve("src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC);
const css = files.filter((f) => f.endsWith(".css"));
const tsx = files.filter((f) => f.endsWith(".tsx"));

/** Class names of every rule that reads the variable (the rule's own selector list). */
function consumerClasses(): string[] {
  const found = new Set<string>();
  for (const file of css) {
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (let at = text.indexOf(`var(${VAR}`); at !== -1; at = text.indexOf(`var(${VAR}`, at + 1)) {
      const open = text.lastIndexOf("{", at);
      const selectors = text.slice(text.lastIndexOf("}", open) + 1, open);
      // The subject of each selector (its last compound), not its ancestors.
      for (const selector of selectors.split(",")) {
        const subject = selector.trim().split(/[\s>+~]+/).pop() ?? "";
        for (const m of subject.matchAll(/\.([a-z][\w-]*)/gi)) found.add(m[1] as string);
      }
    }
  }
  return [...found];
}

describe("sheet followers", () => {
  const classes = consumerClasses();

  it("finds the known consumers (so the scan itself is not silently empty)", () => {
    expect(classes).toEqual(expect.arrayContaining(["pn-attribution", "pn-map-notice", "pn-map-legend", "pn-route-overview-card"]));
  });

  it.each(classes)("every element using .%s carries data-sheet-follower", (cls) => {
    const sources = tsx.map((f) => readFileSync(f, "utf8"));
    const opening = new RegExp(`<[a-z][^<>]*?className="[^"]*\\b${cls}\\b[^"]*"[^<>]*?>`, "gs");
    const tags = sources.flatMap((text) => text.match(opening) ?? []);
    expect(tags.length, `no JSX element uses .${cls}`).toBeGreaterThan(0);
    for (const tag of tags) expect(tag, `.${cls} must carry data-sheet-follower`).toContain("data-sheet-follower");
  });
});
