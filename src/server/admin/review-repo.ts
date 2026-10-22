import "server-only";
import { sql } from "drizzle-orm";
import {
  correctionQueueSchema,
  reviewResultSchema,
  type CorrectionQueue,
  type CorrectionScope,
  type ReviewPayload,
  type ReviewResult,
} from "@/domain/admin/corrections";
import {
  decisionResultSchema,
  moderationQueueSchema,
  photoCopySchema,
  type DecisionResult,
  type ModeratePayload,
  type ModerationQueue,
  type ResolveAppealPayload,
} from "@/domain/admin/moderation";
import type { Db } from "@/server/db/context";
import type { StoragePort } from "@/server/storage/types";
import { toIso } from "./repo";
import { runStopAction } from "./stops-repo";

// The database calls of corrections review (C9) and community moderation (C10), N6. Each goes
// through a SECURITY DEFINER function of migration 0025, which checks the caller's role itself,
// refuses your own content and the stale page, and audits.

type Obj = Record<string, unknown>;

async function scalar(db: Db, query: ReturnType<typeof sql>): Promise<unknown> {
  const r = (await db.execute(query)).rows[0] as Obj | undefined;
  return r ? Object.values(r)[0] : undefined;
}

const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** jsonb timestamps arrive as Postgres text: ISO UTC for the named keys of each object. */
function iso<T extends Obj>(o: T, keys: readonly string[]): T {
  const out: Obj = { ...o };
  for (const k of keys) if (k in out) out[k] = toIso(out[k]);
  return out as T;
}

// ---------------------------------------------------------------- corrections (C9)

export async function readCorrections(db: Db, scope: CorrectionScope): Promise<CorrectionQueue> {
  const d = ((await scalar(db, sql`select community.admin_corrections(${scope}, 100) as d`)) ?? {}) as Obj;
  return correctionQueueSchema.parse({
    draft: d.draft ?? null,
    corrections: list(d.corrections).map((c) => ({
      ...iso(c, ["submittedAt", "updatedAt", "reviewedAt"]),
      events: list(c.events).map((e) => iso(e, ["at"])),
      similar: list(c.similar).map((s) => iso(s, ["submittedAt"])),
    })),
  });
}

/**
 * One reviewer action. An accept with a stop action makes that edit first (0024's function: a new
 * stop version in the open draft), in the same transaction, then records it on the report; if the
 * report refuses it (another stop, a stale status), the edit rolls back with it.
 */
export async function reviewCorrection(db: Db, id: string, p: ReviewPayload): Promise<ReviewResult> {
  let draftVersionId: string | null = null;
  let fareRuleVersionId: string | null = null;
  if (p.action === "accept") {
    fareRuleVersionId = p.fareRuleVersionId ?? null;
    if (p.change.kind === "stop_action") draftVersionId = await runStopAction(db, p.change.stopPointId, p.change.stopAction);
    else if (p.change.kind === "draft_version") draftVersionId = p.change.versionId;
  }
  const reason = p.action === "request_info" || p.action === "reject" ? p.reason : null;
  const duplicateOf = p.action === "duplicate" ? p.duplicateOf : null;
  const r = (await scalar(
    db,
    sql`select community.admin_review_correction(${id}::uuid, ${p.expectedStatus}, ${p.action}, ${reason}, ${p.note ?? null},
      ${duplicateOf}::uuid, ${draftVersionId}::uuid, ${fareRuleVersionId}::uuid) as r`,
  )) as Obj | undefined;
  return reviewResultSchema.parse(r);
}

// ---------------------------------------------------------------- moderation (C10)

export async function readModerationQueue(db: Db): Promise<ModerationQueue> {
  const d = ((await scalar(db, sql`select community.admin_moderation_queue(100) as d`)) ?? {}) as Obj;
  return moderationQueueSchema.parse({
    items: list(d.items).map((i) => ({ ...iso(i, ["submittedAt"]), mediaId: i.mediaId ?? undefined })),
    appeals: list(d.appeals).map((a) => iso(a, ["decidedAt", "createdAt"])),
    history: list(d.history).map((h) => iso(h, ["at"])),
  });
}

/**
 * Applies a decision; for an approved photo, copies the stripped private object to the public
 * bucket before the transaction commits (a failed copy throws, so nothing is recorded). This
 * copy is the only way a photo reaches STORAGE_BUCKET_PUBLIC.
 */
async function withPhotoCopy(raw: unknown, storage: StoragePort, copied: { bucket: string; key: string }[]): Promise<DecisionResult> {
  const r = (raw ?? {}) as Obj;
  const copy = photoCopySchema.parse(r.copy ?? null);
  if (copy) {
    if (!(await storage.copyObject(copy.sourceBucket, copy.key, copy.publicBucket, copy.key))) {
      throw new Error("photo copy to the public bucket failed");
    }
    copied.push({ bucket: copy.publicBucket, key: copy.key });
  }
  return decisionResultSchema.parse({ decisionId: r.decisionId, isOverride: r.isOverride });
}

export async function moderate(db: Db, p: ModeratePayload, publicBucket: string, storage: StoragePort, copied: { bucket: string; key: string }[]): Promise<DecisionResult> {
  const raw = await scalar(
    db,
    sql`select community.admin_moderate(${p.targetType}, ${p.targetId}::uuid, ${p.outcome}, ${p.reason}, ${p.note ?? null},
      ${p.targetType === "photo" && p.outcome === "published" ? publicBucket : null}) as r`,
  );
  return withPhotoCopy(raw, storage, copied);
}

export async function resolveAppeal(
  db: Db,
  appealId: string,
  p: ResolveAppealPayload,
  publicBucket: string,
  storage: StoragePort,
  copied: { bucket: string; key: string }[],
): Promise<DecisionResult> {
  const raw = await scalar(
    db,
    sql`select community.admin_resolve_appeal(${appealId}::uuid, ${p.outcome}, ${p.note}, ${p.outcome === "overturned" ? publicBucket : null}) as r`,
  );
  return withPhotoCopy(raw, storage, copied);
}

/** A private photo a reviewer may see now (audited by the database), or null. */
export async function reviewMedia(db: Db, mediaId: string): Promise<{ bucket: string; key: string; mime: string | null } | null> {
  const r = (await db.execute(sql`select bucket, object_key, mime from core.admin_review_media(${mediaId}::uuid)`)).rows[0] as Obj | undefined;
  return r ? { bucket: String(r.bucket), key: String(r.object_key), mime: (r.mime as string | null) ?? null } : null;
}
