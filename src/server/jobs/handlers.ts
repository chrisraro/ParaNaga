import "server-only";
import { sql } from "drizzle-orm";
import { withRequestContext } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";
import { getStorage } from "@/server/storage/adapter";
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

  // Sweep unconfirmed quarantine slots older than 1 hour (spec §3.9, §3.10; 05 §5.8 "orphan
  // sweep after 1 h"): delete the uploaded object first, then reject the row. Storage I/O runs
  // outside any transaction; a delete that fails leaves the row as a slot for the next run.
  registerJobHandler("sweep_orphan_media", async () => {
    const requestId = safeRequestId();
    const storage = getStorage();
    const orphans = await withRequestContext({ userId: null, requestId }, async (db) => {
      const res = await db.execute<{ id: string; bucket: string; object_key: string }>(sql`
        select id, bucket, object_key from core.find_orphan_media_slots(interval '1 hour')
      `);
      return res.rows;
    });
    for (const row of orphans) {
      if (!(await storage.deleteObject(row.bucket, row.object_key))) continue;
      await withRequestContext({ userId: null, requestId }, async (db) => {
        await db.execute(sql`select core.reject_media(${row.id}::uuid)`);
      });
    }
    return { success: true };
  });
}
