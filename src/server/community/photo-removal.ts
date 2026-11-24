import "server-only";
import { sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { withRequestContext } from "@/server/db/context";
import { serverEnv } from "@/server/env";
import { safeRequestId } from "@/server/request-id";
import { getStorage, MemoryStorageAdapter } from "@/server/storage/adapter";
import type { StoragePort } from "@/server/storage/types";

// Photos of deleted and taken-down posts (migration 0036, which holds the rule). Each item: begin
// (committed; the database checks the rule again under its locks), storage with a check of the
// result, finish. An item that does not finish is due again after 5 minutes; every step is repeatable.

type Action = "remove" | "restore" | "purge";
const dueSchema = z.array(z.object({ id: z.uuid(), action: z.enum(["remove", "restore", "purge"]) }));
// `claim` stays the database's text: it is sent back and compared to the microsecond.
const stepSchema = z.object({ claim: z.string(), bucket: z.string().min(1), key: z.string().min(1), publicBucket: z.string().min(1).nullable() });

/** A run starts no item after this; the rest waits for the next run. */
const BUDGET_MS = 60_000;

async function gone(storage: StoragePort, bucket: string, key: string): Promise<void> {
  // A HEAD with no answer throws: unknown is not gone.
  if (!(await storage.deleteObject(bucket, key)) || (await storage.headObject(bucket, key)) !== null) throw new Error("photo object left");
}

async function moveObjects(storage: StoragePort, action: Action, t: z.infer<typeof stepSchema>): Promise<void> {
  // A photo that was taken down no longer names its copy; every copy is made in this bucket under the same key.
  const publicBucket = t.publicBucket ?? serverEnv().STORAGE_BUCKET_PUBLIC;
  if (publicBucket === t.bucket) throw new Error("public and private bucket are the same");
  if (action === "restore") {
    if (!(await storage.copyObject(t.bucket, t.key, publicBucket, t.key))) throw new Error("photo copy failed");
    return;
  }
  await gone(storage, publicBucket, t.key);
  if (action === "purge") await gone(storage, t.bucket, t.key);
}

/**
 * One pass over the purges, or over the public copies. Without a configured object store it refuses:
 * the in-memory stand-in would report every object deleted. One failing photo does not stop the rest.
 */
export async function runPhotoRemoval(opts: {
  purge: boolean;
  limit?: number;
  onItem?: () => Promise<unknown>;
  storage?: StoragePort;
}): Promise<{ done: number; failed: number }> {
  const storage = opts.storage ?? getStorage();
  if (!opts.storage && storage instanceof MemoryStorageAdapter) throw new Error("Object storage is not configured");
  const requestId = safeRequestId();
  const one = async (query: ReturnType<typeof sql>) =>
    withRequestContext({ userId: null, requestId }, async (db) => (await db.execute<{ r: unknown }>(query)).rows[0]?.r ?? null);
  const due = dueSchema.parse(
    await withRequestContext({ userId: null, requestId }, async (db) =>
      (await db.execute(sql`select id, action from community.photo_removal_due(${opts.limit ?? 50}, ${opts.purge})`)).rows,
    ),
  );
  const until = Date.now() + BUDGET_MS;
  const out = { done: 0, failed: 0 };
  for (const { id, action } of due) {
    if (Date.now() > until) break;
    await opts.onItem?.();
    try {
      const raw = await one(sql`select community.photo_removal_begin(${id}::uuid, ${action}) as r`);
      if (raw === null) continue; // not due any more, or another run has it
      const step = stepSchema.parse(raw);
      await moveObjects(storage, action, step);
      if ((await one(sql`select community.photo_removal_finish(${id}::uuid, ${action}, ${step.claim}::timestamptz) as r`)) === true) out.done++;
    } catch (error) {
      out.failed++;
      console.warn(JSON.stringify({ event: "photo_removal_failed", photoId: id, action, requestId, error: error instanceof Error ? error.name : "unknown" }));
    }
  }
  return out;
}

/** After a committed delete or decision, once the answer is sent: public copies only. The daily job does what is left. */
export function syncPublicPhotos(): void {
  try {
    after(async () => {
      try {
        // Again when something moved: a post can come back while its copies are being removed.
        if ((await runPhotoRemoval({ purge: false, limit: 10 })).done > 0) await runPhotoRemoval({ purge: false, limit: 10 });
      } catch {
        // Nothing to answer any more; the daily job repeats it.
      }
    });
  } catch {
    // Outside a request (tests, scripts) there is nothing to run after.
  }
}
