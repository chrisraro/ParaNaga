"use client";

// Browser side of /api/v1/admin/** (N5a). Every answer is parsed with the shared schema before it
// is shown; nothing is cached (the endpoints answer private, no-store, and the service worker
// never stores /api/v1/admin).
import type { z } from "zod";
import {
  adminDashboardSchema,
  coverageSchema,
  createDraftResultSchema,
  publishResultSchema,
  revisionListSchema,
  validationReportSchema,
} from "@/domain/admin/schemas";
import {
  importCommitResultSchema,
  importDryRunSchema,
  importListSchema,
  reconcileResultSchema,
  reconciliationSchema,
  stopActionResultSchema,
  stopListSchema,
  type ImportUpload,
  type ReconcilePayload,
  type StopAction,
} from "@/domain/admin/stops";
import { correctionQueueSchema, reviewResultSchema, type CorrectionScope, type ReviewPayload } from "@/domain/admin/corrections";
import { decisionResultSchema, moderationQueueSchema, type ModeratePayload, type ResolveAppealPayload } from "@/domain/admin/moderation";
import { apiErrorSchema } from "@/domain/api/schemas";
import { confirmMediaResponseSchema, createMediaSlotResponseSchema } from "@/domain/media/schemas";

export type AdminFailure = { ok: false; status: number; code: string | null; message: string };
export type AdminResult<T> = { ok: true; data: T } | AdminFailure;

const FAILED = "The request failed. Check the connection and try again.";

async function call<S extends z.ZodType>(url: string, schema: S, body?: unknown): Promise<AdminResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, message: FAILED };
  }
  const raw: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = schema.safeParse(raw);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: res.status, code: null, message: "The server sent an answer this page cannot read. Reload." };
  }
  const err = apiErrorSchema.safeParse(raw);
  return { ok: false, status: res.status, code: err.success ? err.data.error.code : null, message: err.success ? err.data.error.message : FAILED };
}

export const fetchDashboard = () => call("/api/v1/admin/dashboard", adminDashboardSchema);
export const fetchRevisions = () => call("/api/v1/admin/revisions", revisionListSchema);
export const createDraft = () => call("/api/v1/admin/revisions", createDraftResultSchema, {});
export const validate = (id: string) => call(`/api/v1/admin/revisions/${encodeURIComponent(id)}/validate`, validationReportSchema, {});
export const publish = (id: string, mode: "publish" | "rollback", expectedPublishedId: string | null) =>
  call(`/api/v1/admin/revisions/${encodeURIComponent(id)}/${mode}`, publishResultSchema, { expectedPublishedId });
export const fetchCoverage = () => call("/api/v1/admin/coverage", coverageSchema);

// ---------------------------------------------------------------- N5b: stops, reconciliation, imports

export const fetchStops = () => call("/api/v1/admin/stops", stopListSchema);
export const stopAction = (stopPointId: string, action: StopAction) =>
  call(`/api/v1/admin/stops/${encodeURIComponent(stopPointId)}`, stopActionResultSchema, action);
export const fetchReconciliation = () => call("/api/v1/admin/reconciliation", reconciliationSchema);
export const decidePair = (payload: ReconcilePayload) => call("/api/v1/admin/reconciliation", reconcileResultSchema, payload);
export const fetchImports = () => call("/api/v1/admin/imports", importListSchema);
export const importDryRun = (upload: ImportUpload) => call("/api/v1/admin/imports/dry-run", importDryRunSchema, upload);
export const importCommit = (upload: ImportUpload, expectedBaselineBatchId: string) =>
  call("/api/v1/admin/imports/commit", importCommitResultSchema, { ...upload, expectedBaselineBatchId });

// ---------------------------------------------------------------- N6: corrections review, moderation

export const fetchCorrections = (scope: CorrectionScope) => call(`/api/v1/admin/corrections?scope=${scope}`, correctionQueueSchema);
export const reviewCorrection = (id: string, payload: ReviewPayload) =>
  call(`/api/v1/admin/corrections/${encodeURIComponent(id)}`, reviewResultSchema, payload);
export const fetchModeration = () => call("/api/v1/admin/moderation", moderationQueueSchema);
export const decideItem = (payload: ModeratePayload) => call("/api/v1/admin/moderation/decisions", decisionResultSchema, payload);
export const resolveAppeal = (id: string, payload: ResolveAppealPayload) =>
  call(`/api/v1/admin/moderation/appeals/${encodeURIComponent(id)}`, decisionResultSchema, payload);
/** A private photo under review, streamed by the server (same origin; each read is audited). */
export const reviewMediaSrc = (mediaId: string) => `/api/v1/admin/media/${encodeURIComponent(mediaId)}`;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A stop photo through the existing upload slots (purpose stop_photo): quarantine, server check,
 * metadata stripped, stored in the private evidence bucket. Returns the media object id to attach.
 */
export async function uploadStopPhoto(file: File): Promise<AdminResult<{ mediaObjectId: string }>> {
  const fail = (message: string): AdminFailure => ({ ok: false, status: 0, code: null, message });
  if (!PHOTO_TYPES.includes(file.type)) return fail("Choose a JPEG, PNG or WebP photo.");
  if (file.size > PHOTO_MAX_BYTES) return fail("The photo is larger than 10 MB.");
  const slot = await call("/api/v1/media/slots", createMediaSlotResponseSchema, { purpose: "stop_photo", expectedBytes: file.size, mime: file.type });
  if (!slot.ok) return slot;
  try {
    const put = await fetch(slot.data.slot.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
    if (!put.ok) return fail("The photo could not be uploaded. Try again.");
  } catch {
    return fail(FAILED);
  }
  const confirm = await call("/api/v1/media/confirm", confirmMediaResponseSchema, { slotId: slot.data.slot.id });
  if (!confirm.ok) return confirm;
  return confirm.data.media.status === "verified"
    ? { ok: true, data: { mediaObjectId: confirm.data.media.id } }
    : fail("The photo was refused (not a readable image).");
}
