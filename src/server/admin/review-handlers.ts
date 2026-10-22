import "server-only";
import { CORRECTION_SCOPES, correctionQueueSchema, reviewPayloadSchema, reviewResultSchema, type CorrectionScope } from "@/domain/admin/corrections";
import { decisionResultSchema, moderatePayloadSchema, moderationQueueSchema, resolveAppealPayloadSchema } from "@/domain/admin/moderation";
import { parseUuidParam } from "@/domain/api/schemas";
import { can } from "@/domain/auth/permissions";
import { badRequest, notFound, readJsonBody, tooManyRequests, unavailable } from "@/server/api/http";
import { serverEnv } from "@/server/env";
import { getStorage } from "@/server/storage/adapter";
import { adminRoute, firstIssue, json, limited } from "./handlers";
import { moderate, readCorrections, readModerationQueue, resolveAppeal, reviewCorrection, reviewMedia } from "./review-repo";

// /api/v1/admin/corrections/** (C9), /api/v1/admin/moderation/** (C10) and /api/v1/admin/media/:id
// (N6). Same three walls as the rest of /api/v1/admin (handlers.ts): the session's roles, the
// action's permission, and the definer functions of migration 0025, which check the role again,
// refuse your own content and stale pages, and audit. Every answer is private, no-store.

const ACTION_MAX_BYTES = 8192;

async function idParam(params: Promise<{ id: string }>, missing: string): Promise<string> {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) throw notFound(missing);
  return id.value;
}

// ---------------------------------------------------------------- C9 corrections

/** GET /api/v1/admin/corrections?scope=open|closed: the queue with evidence (never the reviewer's own reports). */
export function getCorrections(request: Request): Promise<Response> {
  return adminRoute(request, "admin/corrections", "correction.review", async ({ requestId, db }) => {
    const raw = new URL(request.url).searchParams.get("scope") ?? "open";
    if (!(CORRECTION_SCOPES as readonly string[]).includes(raw)) throw badRequest("scope is open or closed.");
    return json(correctionQueueSchema, await db((d) => readCorrections(d, raw as CorrectionScope), true), requestId);
  });
}

/**
 * POST /api/v1/admin/corrections/:id {action, expectedStatus, …}: start review, ask for
 * information, reject, duplicate or accept. Accept writes into the open draft only (a stop action
 * in the same transaction, a version already in the draft, or a recorded proposal); nothing
 * public changes until that draft is validated and published (AC-13).
 */
export function postCorrectionReview(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/corrections/review", "correction.review", async ({ user, requestId, db }) => {
    const id = await idParam(params, "No such report.");
    const parsed = reviewPayloadSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    // A stop action inside an accept is a draft edit too.
    if (parsed.data.action === "accept" && parsed.data.change.kind === "stop_action" && !can(user.roles, "transit.revision.edit")) {
      throw notFound("Not found.");
    }
    const result = await db(async (d) => ((await limited(d, request, user.id)) ? null : reviewCorrection(d, id, parsed.data)));
    if (!result) throw tooManyRequests();
    return json(reviewResultSchema, result, requestId);
  });
}

// ---------------------------------------------------------------- C10 moderation

/** GET /api/v1/admin/moderation: pending posts, comments and photos (with Jev's evidence), open appeals routed away from their decider, recent decisions. */
export function getModeration(request: Request): Promise<Response> {
  return adminRoute(request, "admin/moderation", "community.moderate", async ({ requestId, db }) =>
    json(moderationQueueSchema, await db(readModerationQueue, true), requestId),
  );
}

type Copied = { bucket: string; key: string }[];

/** Runs a decision; a public photo copy made before a failed commit is removed again (never left public). */
async function decide<T>(run: (copied: Copied) => Promise<T>): Promise<T> {
  const copied: Copied = [];
  try {
    return await run(copied);
  } catch (error) {
    const storage = getStorage();
    await Promise.all(copied.map((c) => storage.deleteObject(c.bucket, c.key).catch(() => false)));
    if (error instanceof Error && error.message === "photo copy to the public bucket failed") {
      throw unavailable("The photo could not be copied for publishing; nothing was changed. Try again.");
    }
    throw error;
  }
}

/** POST /api/v1/admin/moderation/decisions {targetType, targetId, outcome, reason, note?}. */
export function postModerationDecision(request: Request): Promise<Response> {
  return adminRoute(request, "admin/moderation/decide", "community.moderate", async ({ user, requestId, db }) => {
    const parsed = moderatePayloadSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const bucket = serverEnv().STORAGE_BUCKET_PUBLIC;
    const result = await decide((copied) =>
      db(async (d) => ((await limited(d, request, user.id)) ? null : moderate(d, parsed.data, bucket, getStorage(), copied))),
    );
    if (!result) throw tooManyRequests();
    return json(decisionResultSchema, result, requestId);
  });
}

/** POST /api/v1/admin/moderation/appeals/:id {outcome: upheld|overturned, note}: never by the original decider. */
export function postAppealResolution(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/moderation/appeal", "community.appeal.resolve", async ({ user, requestId, db }) => {
    const id = await idParam(params, "No such appeal.");
    const parsed = resolveAppealPayloadSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const bucket = serverEnv().STORAGE_BUCKET_PUBLIC;
    const result = await decide((copied) =>
      db(async (d) => ((await limited(d, request, user.id)) ? null : resolveAppeal(d, id, parsed.data, bucket, getStorage(), copied))),
    );
    if (!result) throw tooManyRequests();
    return json(decisionResultSchema, result, requestId);
  });
}

// ---------------------------------------------------------------- private photos for reviewers

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * GET /api/v1/admin/media/:id: the bytes of a private photo the caller is reviewing (correction
 * evidence, a pending community photo, a stop photo). The database decides and audits each read
 * (core.admin_review_media); the object never leaves the private bucket and no URL to it is issued.
 */
export function getReviewMedia(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/media", null, async ({ requestId, db }) => {
    const id = await idParam(params, "Not found.");
    const media = await db((d) => reviewMedia(d, id));
    if (!media || !media.mime || !IMAGE_TYPES.has(media.mime)) throw notFound("Not found.");
    const bytes = await getStorage().getObject(media.bucket, media.key);
    if (!bytes) throw notFound("Not found.");
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": media.mime,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Request-Id": requestId,
      },
    });
  });
}
