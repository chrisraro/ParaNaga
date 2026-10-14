// Enforces the layer rules from docs/spec/03-architecture.md §3.3:
//  - src/domain is pure (no server/client/app, no framework or I/O packages)
//  - src/client and src/ui never import src/server
//  - only src/server/db imports pg
//  - every src/server module (except listed test-shared files) imports "server-only"
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("src");
const SERVER_ONLY_EXEMPT = new Set(["server/db/run-in-context.ts", "server/db/schema.ts"]);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return files.flat().filter((f) => /\.(ts|tsx)$/.test(f));
}

const importRe = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(importRe)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").filter(Boolean);
}

const problems: string[] = [];

for (const file of await walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const source = await readFile(file, "utf8");
  const imports = importsOf(source);

  if (rel.startsWith("domain/")) {
    for (const spec of imports) {
      if (/^@\/(server|client|app)\//.test(spec) || /^(next|react|pg|drizzle-orm)(\/|$)/.test(spec)) {
        problems.push(`${rel}: domain must stay pure (imports ${spec})`);
      }
    }
  }
  if (rel.startsWith("client/") || rel.startsWith("ui/")) {
    for (const spec of imports) {
      if (spec.startsWith("@/server/")) problems.push(`${rel}: client code imports ${spec}`);
    }
  }
  if (!rel.startsWith("server/db/") && imports.includes("pg")) {
    problems.push(`${rel}: only src/server/db may import pg`);
  }
  if (rel.startsWith("server/") && !SERVER_ONLY_EXEMPT.has(rel) && !imports.includes("server-only")) {
    problems.push(`${rel}: server module must import "server-only"`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("layer boundaries OK");
