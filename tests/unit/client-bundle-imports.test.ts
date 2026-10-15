// Static checks on what the browser bundle pulls in.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("client bundle imports", () => {
  it("zod jitless is set once, first, from the top-most client entry (instrumentation-client)", () => {
    const entry = read("instrumentation-client.ts");
    // A Windows checkout (core.autocrlf) has CRLF line ends.
    const firstImport = entry.split(/\r?\n/).find((l) => l.startsWith("import "));
    expect(firstImport).toBe('import "./client/zod-jitless";');
    const others = [...walk(path.join(SRC, "client")), ...walk(path.join(SRC, "ui")), ...walk(path.join(SRC, "app"))]
      .filter((f) => !f.endsWith("zod-jitless.ts"))
      .filter((f) => /zod-jitless/.test(readFileSync(f, "utf8")));
    expect(others.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("UI and client code import planner copy from labels.ts, never the planner at runtime", () => {
    const offenders = [...walk(path.join(SRC, "client")), ...walk(path.join(SRC, "ui"))].filter((f) =>
      /^import\s+(?!type\b)[^;]*from\s+["']@\/domain\/planner\/(plan|graph|fares)["']/m.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("no module reachable from src/client or src/ui imports node:crypto (directly or through @/ and relative imports)", () => {
    // Value imports and re-exports only; `import type` is erased at build time.
    const IMPORT = /^\s*(?:import|export)\s+(?!type)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
      if (!base) return null;
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch {
          // not this candidate
        }
      }
      return null;
    };
    const seen = new Map<string, string | null>(); // file → the file that first imported it
    const queue = [...walk(path.join(SRC, "client")), ...walk(path.join(SRC, "ui"))];
    for (const f of queue) seen.set(f, null);
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const spec = match[1]!;
        if (spec === "node:crypto" || spec === "crypto") offenders.push(path.relative(SRC, file));
        const next = resolve(file, spec);
        if (next && !seen.has(next)) {
          seen.set(next, file);
          queue.push(next);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The walk really follows imports into the domain (guards against a regex that matches nothing).
    expect([...seen.keys()].some((f) => f.endsWith(path.join("domain", "trip", "endpoints.ts")))).toBe(true);
  });
});
