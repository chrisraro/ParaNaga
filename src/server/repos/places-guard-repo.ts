import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/context";

// The Google Places cost guard in Postgres (migration 0012). Keys are keyed hashes made by the
// caller: no query text and no IP address is ever stored. Every statement is parameterized.

/** Counts one request for `keyHash` in the current fixed window; returns the count so far. */
export async function countRequest(db: Db, keyHash: string, windowSeconds: number): Promise<number> {
  const result = await db.execute(sql`
    insert into ops.rate_limit_bucket as b (key_hash, window_start, count)
    values (${keyHash}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
    on conflict (key_hash, window_start) do update set count = b.count + 1
    returning count`);
  return Number((result.rows[0] as { count: number }).count);
}

/** A cached answer that has not expired, or null. The caller validates it before use. */
export async function readCache(db: Db, keyHash: string): Promise<unknown> {
  const result = await db.execute(sql`select payload from ops.places_cache where key_hash = ${keyHash} and expires_at > now()`);
  return (result.rows[0] as { payload: unknown } | undefined)?.payload ?? null;
}

/** Stores an answer, and sweeps expired cache rows and day-old guard rate buckets. */
export async function writeCache(db: Db, keyHash: string, payload: unknown, ttlSeconds: number): Promise<void> {
  await db.execute(sql`
    insert into ops.places_cache (key_hash, payload, expires_at)
    values (${keyHash}, ${JSON.stringify(payload)}::jsonb, now() + make_interval(secs => ${ttlSeconds}::int))
    on conflict (key_hash) do update set payload = excluded.payload, expires_at = excluded.expires_at`);
  await db.execute(sql`delete from ops.places_cache where expires_at < now()`);
  await db.execute(sql`delete from ops.rate_limit_bucket where key_hash like 'places:%' and window_start < now() - interval '1 day'`);
}

/** Takes one Google call from today's (Asia/Manila) budget; false once 300 were taken (cap in SQL). */
export async function takeGoogleCall(db: Db): Promise<boolean> {
  const result = await db.execute(sql`select ops.places_take_call() as ok`);
  return (result.rows[0] as { ok: boolean }).ok === true;
}
