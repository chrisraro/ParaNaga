import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 1.4.11: the focus ring needs 3:1 on light and dark surfaces. The bright teal (#2bb5ae) is
// about 2.5:1 on white, so every ring takes the accent token, whose light value passes.
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? cssFiles(full) : full.endsWith(".css") ? [full] : [];
  });
}

describe("focus ring", () => {
  it("never draws an outline in the bright teal", () => {
    const bad = cssFiles("src").filter((f) => /outline(-color)?:[^;]*#2bb5ae/i.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("keeps a system-colour ring in forced-colors mode", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{[^}]*outline-color: Highlight/);
  });
});

describe("motion", () => {
  it("the GPS pulse is finite and ends within 5 s", () => {
    const css = readFileSync("src/ui/map/naga-map.css", "utf8");
    const m = /\.pn-map \.pn-pulse \{[^}]*animation:\s*pn-pulse ([\d.]+)s [^;]*? (\d+)/.exec(css);
    expect(m, "pulse animation declaration").not.toBeNull();
    expect(Number(m![1]) * Number(m![2])).toBeLessThanOrEqual(5);
  });
});
