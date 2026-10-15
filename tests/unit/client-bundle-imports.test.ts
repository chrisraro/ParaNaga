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
});
