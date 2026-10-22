import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/context";
import type { StoragePort } from "@/server/storage/types";

// Driver-evidence retention purge (N7; spec 04 §4.8, 05 §5.8). Closed and withdrawn reports past
// their retention date (closure + 365 days) and evidence uploads no report uses (30 days) are
// removed, objects and rows together: per report, one transaction deletes the rows
// (priv.retention_purge_complaint: access log, handoff, events, evidence rows, the report and its
// media objects; it re-checks under a row lock), then the storage objects (originals, redacted
// copies) with a HEAD check that each is really gone, then commits. A report under legal hold is
// never touched. If an object cannot be deleted, the rows roll back and the next run retries:
// running it again is always safe (deleting a missing object succeeds, a purged report is no
// longer listed). Every purge and every run is audited as
// 'system'. Dry run lists and counts, deletes nothing, and records the run as a dry run.

const objectSchema = z.object({ bucket: z.string().min(1), key: z.string().min(1) });
const dueSchema = z.object({
  complaints: z.array(z.object({ id: z.uuid(), objects: z.array(objectSchema) })),
  uploads: z.array(z.object({ id: z.uuid(), bucket: z.string().min(1), key: z.string().min(1) })),
});
export type RetentionDue = z.infer<typeof dueSchema>;

export type RetentionSummary = {
  dryRun: boolean;
  complaints: number;
  uploads: number;
  objects: number;
  failed: number;
};

/** Runs `fn` as the system (no user in the request context), in its own transaction. */
export type SystemDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export async function readDue(db: Db, limit: number): Promise<RetentionDue> {
  const r = (await db.execute(sql`select priv.retention_due(${limit}) as d`)).rows[0] as { d?: unknown } | undefined;
  return dueSchema.parse(r?.d ?? { complaints: [], uploads: [] });
}

/** Deletes each object and checks it is gone; false when any one is still there. */
async function removeObjects(storage: StoragePort, objects: readonly { bucket: string; key: string }[]): Promise<boolean> {
  for (const o of objects) {
    if (!(await storage.deleteObject(o.bucket, o.key))) return false;
    if ((await storage.headObject(o.bucket, o.key)) !== null) return false;
  }
  return true;
}

class ObjectsRemain extends Error {}

/**
 * One purge in one transaction: the rows go first (row lock held, so a legal hold set meanwhile
 * waits, and one set before makes the function answer false and nothing is touched), then the
 * objects, then the commit. Objects that will not go roll the rows back. A commit that fails after
 * the objects went leaves rows without objects; the next run finds and finishes them.
 */
async function purgeOne(asSystem: SystemDb, purge: ReturnType<typeof sql>, remove: () => Promise<boolean>): Promise<"purged" | "skipped" | "failed"> {
  try {
    return await asSystem(async (db) => {
      const r = (await db.execute(purge)).rows[0] as { ok?: boolean } | undefined;
      if (r?.ok !== true) return "skipped" as const;
      if (!(await remove())) throw new ObjectsRemain();
      return "purged" as const;
    });
  } catch (error) {
    if (error instanceof ObjectsRemain) return "failed";
    throw error;
  }
}

export async function runEvidenceRetention(opts: { dryRun: boolean; storage: StoragePort; asSystem: SystemDb; limit?: number }): Promise<RetentionSummary> {
  const { dryRun, storage, asSystem } = opts;
  const due = await asSystem((db) => readDue(db, opts.limit ?? 50));
  const summary: RetentionSummary = { dryRun, complaints: 0, uploads: 0, objects: 0, failed: 0 };

  if (dryRun) {
    summary.complaints = due.complaints.length;
    summary.uploads = due.uploads.length;
    summary.objects = due.complaints.reduce((n, c) => n + c.objects.length, 0) + due.uploads.length;
  } else {
    for (const c of due.complaints) {
      const out = await purgeOne(asSystem, sql`select priv.retention_purge_complaint(${c.id}::uuid) as ok`, () => removeObjects(storage, c.objects));
      if (out === "purged") {
        summary.complaints++;
        summary.objects += c.objects.length;
      } else if (out === "failed") summary.failed++;
    }
    for (const u of due.uploads) {
      const out = await purgeOne(asSystem, sql`select priv.retention_purge_upload(${u.id}::uuid) as ok`, () => removeObjects(storage, [u]));
      if (out === "purged") {
        summary.uploads++;
        summary.objects++;
      } else if (out === "failed") summary.failed++;
    }
  }

  await asSystem((db) =>
    db.execute(sql`select priv.retention_record_run(${dryRun}, ${summary.complaints}, ${summary.uploads}, ${summary.objects}, ${summary.failed})`),
  );
  return summary;
}
