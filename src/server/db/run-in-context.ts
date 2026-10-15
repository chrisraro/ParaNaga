// No `server-only` import here: integration tests and scripts reuse this runner.
// Application code must call withRequestContext() from ./context instead.
import type { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export type RequestContext = {
  /** Neon Auth user id, or null for guests. */
  userId: string | null;
  requestId: string;
};

export type ContextOptions = {
  /**
   * Public reads: one REPEATABLE READ, READ ONLY transaction, so every statement sees the same
   * snapshot (a publish committing mid-request cannot mix two revisions in one response).
   */
  readOnly?: boolean;
};

export const BEGIN_READ_WRITE = "begin";
export const BEGIN_READ_ONLY = "begin isolation level repeatable read read only";

export async function runInRequestContext<T>(
  pool: Pool,
  ctx: RequestContext,
  fn: (db: Db) => Promise<T>,
  options: ContextOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(options.readOnly ? BEGIN_READ_ONLY : BEGIN_READ_WRITE);
    await client.query(
      "select set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)",
      [ctx.userId ?? "", ctx.requestId],
    );
    const result = await fn(drizzle(client, { schema }));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
