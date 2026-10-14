import "server-only";
import type { Pool } from "pg";
import { getPool } from "./client";
import { runInRequestContext, type Db, type RequestContext } from "./run-in-context";

export type { Db, RequestContext };

/**
 * The only way application code talks to Postgres (spec §3.5).
 * Opens an explicit transaction and sets transaction-local context first, so the
 * settings never leak to the next user of a pooled connection.
 */
export function withRequestContext<T>(ctx: RequestContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return runInRequestContext(getPool() as Pool, ctx, fn);
}
