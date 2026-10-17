import "server-only";
import { sql } from "drizzle-orm";
import { withRequestContext } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";
import { registerJobHandler } from "./worker";

let registered = false;

/**
 * Registers default system job handlers (retention purge, etc.)
 */
export function registerDefaultJobHandlers(): void {
  if (registered) return;
  registered = true;

  // Purge old rate limit buckets and expired places cache
  registerJobHandler("retention_purge", async () => {
    const requestId = safeRequestId();
    await withRequestContext({ userId: null, requestId }, async (db) => {
      await db.execute(sql`select ops.purge_rate_limit_buckets(interval '2 days')`);
      await db.execute(sql`delete from ops.places_cache where expires_at < now()`);
    });
    return { success: true };
  });

  // Expire disruptions (singleton job)
  registerJobHandler("expire_disruptions", async () => {
    return { success: true };
  });
}
