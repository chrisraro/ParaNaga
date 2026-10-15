// The app reads the transit network only through the published views (security_invoker,
// draft and synthetic rows hidden). Base transit.* / ingest.* tables must never be named in
// src/server/repos, and every view named there must exist in the migrations.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPOS = path.resolve("src/server/repos");
const MIGRATIONS = path.resolve("db/migrations");
const NAME = /\b(transit|ingest)\s*\.\s*"?([A-Za-z_][A-Za-z0-9_]*)/g;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [],
  );
}

const references = files(REPOS).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(NAME)].map((m) => ({
    file: path.relative(process.cwd(), file),
    schema: m[1]!,
    name: m[2]!,
  })),
);

describe("src/server/repos reads only transit.v_published_* views", () => {
  it("has repository files that reference views", () => {
    expect(references.length).toBeGreaterThan(0);
  });

  it("names no base transit or ingest relation", () => {
    const offending = references.filter((r) => r.schema !== "transit" || !r.name.startsWith("v_published_"));
    expect(offending).toEqual([]);
  });

  it("does not import the Drizzle base-table mirrors", () => {
    const importsSchema = files(REPOS).filter((file) =>
      /from\s+["'](?:@\/server\/db\/schema|(?:\.\.?\/)+(?:db\/)?schema)["']/.test(readFileSync(file, "utf8")),
    );
    expect(importsSchema.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("every view it names is created by a migration", () => {
    const sql = readdirSync(MIGRATIONS).map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8")).join("\n");
    const created = new Set([...sql.matchAll(/create view transit\.(v_published_[a-z_]+)/g)].map((m) => m[1]));
    const missing = [...new Set(references.map((r) => r.name))].filter((n) => !created.has(n));
    expect(missing).toEqual([]);
  });
});
