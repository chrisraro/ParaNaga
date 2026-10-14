// Applies db/migrations/NNNN_*.sql in order, each in its own transaction.
// Uses the owner role on the direct (unpooled) endpoint: DATABASE_URL_UNPOOLED.
// Applied files are checksummed; editing an applied migration is an error.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is required (owner role, direct endpoint).");
  process.exit(1);
}

const dir = path.resolve("db/migrations");
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("select pg_advisory_lock(hashtext('paranaga_migrations'))");
  await client.query(`
    create table if not exists public.schema_migrations (
      name       text primary key,
      sha256     text not null,
      applied_at timestamptz not null default now()
    )`);

  const files = (await readdir(dir)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const { rows } = await client.query<{ name: string; sha256: string }>(
    "select name, sha256 from public.schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.name, r.sha256]));

  for (const file of files) {
    const body = await readFile(path.join(dir, file), "utf8");
    const sha = createHash("sha256").update(body).digest("hex");
    const previous = applied.get(file);
    if (previous) {
      if (previous !== sha) throw new Error(`${file} was edited after it was applied. Add a new migration instead.`);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(body);
      await client.query("insert into public.schema_migrations (name, sha256) values ($1, $2)", [file, sha]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`${file} failed: ${(error as Error).message}`);
    }
  }
  console.log("migrations up to date");
} finally {
  await client.query("select pg_advisory_unlock(hashtext('paranaga_migrations'))").catch(() => undefined);
  await client.end();
}
