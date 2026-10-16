// Fails if anything secret-looking reaches the browser bundle (spec §5.7, §5.13).
// Run after `next build`.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const STATIC_DIR = path.resolve(".next/static");

const PATTERNS: Array<[string, RegExp]> = [
  ["OpenRouter key", /sk-or-[A-Za-z0-9_-]{16,}/],
  ["Postgres URL", /postgres(?:ql)?:\/\/[^\s"'`]+@/],
  ["secret env name", /\b(OPENROUTER_API_KEY|DATABASE_URL(?:_UNPOOLED)?|NEON_AUTH_COOKIE_SECRET|STORAGE_SECRET_ACCESS_KEY|STORAGE_ACCESS_KEY_ID|CRON_SECRET|GOOGLE_PLACES_API_KEY)\b/],
];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return files.flat();
}

try {
  await stat(STATIC_DIR);
} catch {
  console.error(".next/static not found. Run `pnpm build` first.");
  process.exit(1);
}

const hits: string[] = [];
const files = (await walk(STATIC_DIR)).filter((f) => /\.(js|mjs|json|html|txt|map)$/.test(f));
for (const file of files) {
  const body = await readFile(file, "utf8");
  for (const [label, re] of PATTERNS) {
    if (re.test(body)) hits.push(`${path.relative(process.cwd(), file)}: ${label}`);
  }
}

if (hits.length > 0) {
  console.error(hits.map((h) => `✗ ${h}`).join("\n"));
  process.exit(1);
}
console.log(`scanned ${files.length} client files: no secrets found`);
