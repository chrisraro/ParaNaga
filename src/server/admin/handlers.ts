import "server-only";
import type { z } from "zod";
import { canEnterAdmin } from "@/domain/admin/access";
import {
  adminDashboardSchema,
  coverageSchema,
  createDraftResultSchema,
  publishPayloadSchema,
  publishResultSchema,
  revisionListSchema,
  validationReportSchema,
} from "@/domain/admin/schemas";
import { validateRevision } from "@/domain/admin/validation";
import { parseUuidParam } from "@/domain/api/schemas";
import { can, type Action } from "@/domain/auth/permissions";
import { authedRoute, badRequest, CACHE, conflict, forbidden, notFound, readJsonBody, stepUpRequired, tooManyRequests, unauthorized, unavailable } from "@/server/api/http";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";
import { applyStepUp, currentStepUpKey, isStepUpError } from "@/server/auth/step-up";
import { withRequestContext, type Db } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { isStaffSessionFresh } from "./access";
import { getPublishedRevision } from "@/server/repos/network-repo";
import { createDraft, listRevisions, publishRevision, readCoverage, readDashboard, readValidationFacts, recordValidation } from "./repo";
import { commitPayload, planAdminImport } from "@/domain/admin/imports";
import {
  importCommitResultSchema,
  importCommitSchema,
  importDryRunSchema,
  importListSchema,
  importUploadSchema,
  reconcilePayloadSchema,
  reconcileResultSchema,
  reconciliationSchema,
  stopActionResultSchema,
  stopActionSchema,
  stopListSchema,
} from "@/domain/admin/stops";
import { commitImport, readImportBaseline, readImports, readReconciliation, readStops, reconcile, runStopAction } from "./stops-repo";

// /api/v1/admin/** (N5a). Three walls, each on its own: (1) here, per request, the session's roles
// from core.user_role (no staff role: 404, so the API does not reveal itself); (2) the action's
// permission (src/domain/auth/permissions.ts); (3) the database, whose definer functions check the
// role again and, for publish and rollback, a fresh step-up (priv.require_step_up). Every answer
// is private, no-store. Writes take a JSON body only (readJsonBody), so a cross-site form cannot post.

const NOT_FOUND = "Not found.";
const BODY_MAX_BYTES = 512;

export type Ctx = { user: CurrentUser; requestId: string; db: <T>(fn: (db: Db) => Promise<T>, readOnly?: boolean) => Promise<T> };

function pgError(error: unknown): { code: string | null; message: string } {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return { code: typeof code === "string" ? code : null, message: String(e?.cause?.message ?? e?.message ?? "") };
}

/** Database refusals → API problems; anything else stays a 500. Messages from 0023 are written for staff. */
export function adminProblem(error: unknown): unknown {
  if (isStepUpError(error)) return stepUpRequired();
  const { code, message } = pgError(error);
  if (code === "42501") return message === "forbidden" ? notFound(NOT_FOUND) : forbidden(capitalize(message));
  if (code === "22023") {
    if (message.startsWith("unknown revision")) return notFound("No such revision.");
    if (message === "unknown stop") return notFound("No such stop in the open draft.");
    if (message === "unknown correction") return notFound("No such report.");
    if (message === "unknown item" || message === "unknown appeal") return notFound("No such item; it may have been removed.");
    return badRequest(capitalize(message));
  }
  if (code === "55000" || code === "23514") return conflict(capitalize(message));
  return error;
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : s);

export function adminRoute(request: Request, route: string, action: Action | null, run: (ctx: Ctx) => Promise<Response>): Promise<Response> {
  return authedRoute(request, route, async (requestId) => {
    const user = await getCurrentUser();
    if (!user || !canEnterAdmin(user.roles) || (action && !can(user.roles, action))) throw notFound(NOT_FOUND);
    // Spec 05 §5.4: a staff sign-in counts for 12 hours; after that, sign in again (no data call).
    if (!(await isStaffSessionFresh(user.id))) throw unauthorized("Your staff sign-in is over 12 hours old. Sign in again to continue.");
    const db: Ctx["db"] = (fn, readOnly = false) => withRequestContext({ userId: user.id, requestId }, fn, { readOnly });
    try {
      return await run({ user, requestId, db });
    } catch (error) {
      throw adminProblem(error);
    }
  }).then((res) => {
    res.headers.set("Cache-Control", CACHE.private);
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Robots-Tag", "noindex");
    return res;
  });
}

export const json = <S extends z.ZodType>(schema: S, body: z.input<S>, requestId: string, status = 200) =>
  Response.json(schema.parse(body), { status, headers: { "X-Request-Id": requestId } });

export async function limited(db: Db, request: Request, userId: string): Promise<boolean> {
  for (const limit of [RATE_LIMITS.mutationPerMinute, RATE_LIMITS.mutationPerHour]) {
    if (!(await checkRateLimit(db, request, limit, userId))) return true;
  }
  return false;
}

async function revisionParam(params: Promise<{ id: string }>): Promise<string> {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) throw notFound("No such revision.");
  return id.value;
}

// ---------------------------------------------------------------- reads

export function getDashboard(request: Request): Promise<Response> {
  // Transport staff only (N6): a moderator's dashboard is the moderation link, with no data call.
  return adminRoute(request, "admin/dashboard", "transit.revision.edit", async ({ requestId, db }) =>
    json(adminDashboardSchema, await db(readDashboard, true), requestId),
  );
}

export function getRevisions(request: Request): Promise<Response> {
  return adminRoute(request, "admin/revisions", "transit.revision.publish", async ({ requestId, db }) =>
    json(revisionListSchema, await db(listRevisions, true), requestId),
  );
}

export function getCoverage(request: Request): Promise<Response> {
  return adminRoute(request, "admin/coverage", "transit.revision.edit", async ({ requestId, db }) => {
    const raw = new URL(request.url).searchParams.get("revision");
    let revisionId: string | null = null;
    if (raw !== null) {
      const id = parseUuidParam(raw, "revision");
      if (!id.ok) throw badRequest(id.message);
      revisionId = id.value;
    }
    return json(coverageSchema, await db((d) => readCoverage(d, revisionId), true), requestId);
  });
}

// ---------------------------------------------------------------- writes

/** POST /api/v1/admin/revisions: a new draft that copies the published membership. */
export function postDraft(request: Request): Promise<Response> {
  return adminRoute(request, "admin/revisions/create", "transit.revision.edit", async ({ user, requestId, db }) => {
    await readJsonBody(request, BODY_MAX_BYTES);
    const id = await db(async (d) => ((await limited(d, request, user.id)) ? null : createDraft(d)));
    if (!id) throw tooManyRequests();
    return json(createDraftResultSchema, { revisionId: id }, requestId, 201);
  });
}

/**
 * POST /api/v1/admin/revisions/:id/validate: reads the facts (with the rolled-back publish dry run),
 * runs every rule (N4's publicationBlockers first) and stores the report, bound to the membership it
 * was computed on, in one transaction.
 */
export function postValidate(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/revisions/validate", "transit.revision.publish", async ({ user, requestId, db }) => {
    const revisionId = await revisionParam(params);
    await readJsonBody(request, BODY_MAX_BYTES);
    const result = await db(async (d) => {
      if (await limited(d, request, user.id)) return null;
      const facts = await readValidationFacts(d, revisionId);
      const report = validateRevision(facts);
      const validatedAt = await recordValidation(d, revisionId, facts.membershipHash, report);
      return { ...report, validatedAt };
    });
    if (!result) throw tooManyRequests();
    return json(validationReportSchema, result, requestId);
  });
}

function postPublication(request: Request, params: Promise<{ id: string }>, mode: "publish" | "rollback"): Promise<Response> {
  return adminRoute(request, `admin/revisions/${mode}`, "transit.revision.publish", async ({ user, requestId, db }) => {
    const revisionId = await revisionParam(params);
    const payload = publishPayloadSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!payload.success) throw badRequest("Send the published revision this page was showing (expectedPublishedId).");
    const key = await currentStepUpKey(user.id);
    const result = await db(async (d) => {
      if (await limited(d, request, user.id)) return "rate_limited" as const;
      // First statement of the protected transaction (N3): sets app.step_up_at from this session's record.
      if (!(await applyStepUp(d, key))) return "step_up" as const;
      const { previousRevisionId } = await publishRevision(d, revisionId, payload.data.expectedPublishedId, mode);
      const head = await getPublishedRevision(d);
      return { previousRevisionId, head };
    });
    if (result === "rate_limited") throw tooManyRequests();
    if (result === "step_up") throw stepUpRequired();
    // A synthetic revision is never in the published views: the head would be empty. publish_revision refuses those, so this is a bug.
    if (!result.head || result.head.revisionId !== revisionId) throw unavailable("The revision was published but the public head could not be read. Reload.");
    return json(publishResultSchema, { mode, revisionId, previousRevisionId: result.previousRevisionId, head: result.head }, requestId);
  });
}

/** POST /api/v1/admin/revisions/:id/publish {expectedPublishedId}: step-up required. */
export const postPublish = (request: Request, params: Promise<{ id: string }>) => postPublication(request, params, "publish");

/** POST /api/v1/admin/revisions/:id/rollback {expectedPublishedId}: re-publishes a superseded revision; step-up required. */
export const postRollback = (request: Request, params: Promise<{ id: string }>) => postPublication(request, params, "rollback");

// ---------------------------------------------------------------- N5b: candidates, stops, reconciliation (C3)

const ACTION_MAX_BYTES = 4096;
/** JSON-escaped file text: KML quotes and newlines grow it; the text itself is capped at IMPORT_MAX_CHARS. */
const IMPORT_MAX_BYTES = 3_000_000;

export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "The request is not valid.";

async function stopParam(params: Promise<{ id: string }>): Promise<string> {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) throw notFound("No such stop in the open draft.");
  return id.value;
}

/** GET /api/v1/admin/stops: the stop members of the open draft (else the published revision, read-only). */
export function getStops(request: Request): Promise<Response> {
  return adminRoute(request, "admin/stops", "transit.revision.edit", async ({ requestId, db }) =>
    json(stopListSchema, await db(readStops, true), requestId),
  );
}

/**
 * POST /api/v1/admin/stops/:id {action, expectedVersionId, …}: promote, attach evidence, retire,
 * relocate or edit, each a new stop version in the open draft (409 when the stop changed since the
 * page loaded, or a rule refuses it).
 */
export function postStopAction(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/stops/action", "transit.revision.edit", async ({ user, requestId, db }) => {
    const stopPointId = await stopParam(params);
    const parsed = stopActionSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const versionId = await db(async (d) => ((await limited(d, request, user.id)) ? null : runStopAction(d, stopPointId, parsed.data)));
    if (!versionId) throw tooManyRequests();
    return json(stopActionResultSchema, { stopPointId, versionId }, requestId);
  });
}

/** GET /api/v1/admin/reconciliation: nearby pairs to decide, pin mismatches (read-only), recent decisions. */
export function getReconciliation(request: Request): Promise<Response> {
  return adminRoute(request, "admin/reconciliation", "transit.revision.edit", async ({ requestId, db }) =>
    json(reconciliationSchema, await db(readReconciliation, true), requestId),
  );
}

/** POST /api/v1/admin/reconciliation {a, b, decision, keepStopPointId?, note?}: link or keep separate. */
export function postReconciliation(request: Request): Promise<Response> {
  return adminRoute(request, "admin/reconciliation/decide", "transit.revision.edit", async ({ user, requestId, db }) => {
    const parsed = reconcilePayloadSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const r = await db(async (d) => ((await limited(d, request, user.id)) ? null : reconcile(d, parsed.data)));
    if (!r) throw tooManyRequests();
    return json(reconcileResultSchema, r, requestId);
  });
}

// ---------------------------------------------------------------- N5b: imports (C2)

/** GET /api/v1/admin/imports: the baseline (newest committed My Maps batch) and the batch history. */
export function getImports(request: Request): Promise<Response> {
  return adminRoute(request, "admin/imports", "transit.revision.edit", async ({ requestId, db }) =>
    json(importListSchema, await db(readImports, true), requestId),
  );
}

/** POST /api/v1/admin/imports/dry-run {format, fileName, text, retrievedOn}: the diff against the baseline. Writes nothing. */
export function postImportDryRun(request: Request): Promise<Response> {
  return adminRoute(request, "admin/imports/dry-run", "transit.revision.edit", async ({ user, requestId, db }) => {
    const parsed = importUploadSchema.safeParse(await readJsonBody(request, IMPORT_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const baseline = await db(async (d) => ((await limited(d, request, user.id)) ? "rate_limited" : readImportBaseline(d)));
    if (baseline === "rate_limited") throw tooManyRequests();
    return json(importDryRunSchema, planAdminImport(parsed.data, baseline).dryRun, requestId);
  });
}

/**
 * POST /api/v1/admin/imports/commit {…upload, expectedBaselineBatchId}: the server plans the file
 * again (the browser's diff is never used) and commits through ingest.admin_import_commit, which
 * recomputes the change kinds and writes nothing when nothing changed.
 */
export function postImportCommit(request: Request): Promise<Response> {
  return adminRoute(request, "admin/imports/commit", "transit.revision.edit", async ({ user, requestId, db }) => {
    const parsed = importCommitSchema.safeParse(await readJsonBody(request, IMPORT_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const { expectedBaselineBatchId, ...upload } = parsed.data;
    const result = await db(async (d) => {
      if (await limited(d, request, user.id)) return null;
      const baseline = await readImportBaseline(d);
      if (!baseline || baseline.batchId !== expectedBaselineBatchId) {
        throw conflict("Another import was committed since the dry run; run the dry run again.");
      }
      const plan = planAdminImport(upload, baseline);
      if (!plan.dryRun.canCommit) throw badRequest(`The file has problems; nothing was written. ${plan.dryRun.problems[0] ?? ""}`.trim());
      return commitImport(d, commitPayload(upload, plan, expectedBaselineBatchId));
    });
    if (!result) throw tooManyRequests();
    return json(importCommitResultSchema, result, requestId, result.outcome === "committed" ? 201 : 200);
  });
}
