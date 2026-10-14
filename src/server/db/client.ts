import "server-only";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { requireEnv } from "@/server/env";

// One pool per Fluid-compute instance, pointed at Neon's pooled (PgBouncer,
// transaction-mode) endpoint as role paranaga_app (PARANAGA_DATABASE_URL). attachDatabasePool lets Vercel
// close idle clients before an instance suspends.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireEnv("PARANAGA_DATABASE_URL"),
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
    });
    attachDatabasePool(pool);
  }
  return pool;
}
