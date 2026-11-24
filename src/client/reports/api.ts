"use client";

// Browser side of My reports (S19) and the MyNaga handoff (S20). Every call is to the caller's own
// private endpoints; nothing is stored on the phone and nothing is cached (no-store, and the
// service worker never touches /api/v1/me/**).

import { isStepUpRequiredBody } from "@/domain/auth/step-up";
import { evidenceUrlResponseSchema, myComplaintsResponseSchema } from "@/domain/complaints/schemas";
import { myCorrectionsResponseSchema } from "@/domain/corrections/schemas";
import { mergeReports, type ReportRow } from "@/domain/reports/list";
import {
  complaintDetailResponseSchema,
  correctionDetailResponseSchema,
  myNagaHandoffResponseSchema,
  reportActionResponseSchema,
  type ComplaintAnswer,
  type ComplaintDetail,
  type CorrectionAnswer,
  type CorrectionDetail,
  type MyNagaHandoff,
  type MyNagaSelfReport,
} from "@/domain/reports/schemas";
import { en, type Dict } from "@/i18n/dict";

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "signed_out" | "not_found" | "rate_limited" | "failed" | "changed" | "invalid"; message: string };

const get = { credentials: "same-origin", cache: "no-store" } as const;
// English messages from the dictionary; screens show them with translated(message, en.reports.api, t.reports.api).
const M = en.reports.api;

function fail<T>(status: number | null): Loaded<T> {
  if (status === 401) return { ok: false, reason: "signed_out", message: M.signedOut };
  if (status === 404) return { ok: false, reason: "not_found", message: M.notFound };
  if (status === 429) return { ok: false, reason: "rate_limited", message: M.rateLimited };
  return { ok: false, reason: "failed", message: M.failed };
}

async function getJson(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, get);
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return null;
  }
}

/** The merged list is built here from the two existing own-list endpoints (no new server route); `copy` words its labels. */
export async function loadMyReports(copy: Dict = en): Promise<Loaded<ReportRow[]>> {
  const [c, d] = await Promise.all([getJson("/api/v1/me/corrections"), getJson("/api/v1/me/complaints")]);
  if (!c || !d) return fail(null);
  if (c.status === 401 || d.status === 401) return fail(401);
  const corrections = myCorrectionsResponseSchema.safeParse(c.body);
  const complaints = myComplaintsResponseSchema.safeParse(d.body);
  if (!corrections.success || !complaints.success) return fail(c.status === 429 || d.status === 429 ? 429 : null);
  return { ok: true, data: mergeReports(corrections.data.corrections, complaints.data.complaints, copy) };
}

export async function loadComplaint(id: string): Promise<Loaded<ComplaintDetail>> {
  const r = await getJson(`/api/v1/me/complaints/${encodeURIComponent(id)}`);
  if (!r) return fail(null);
  const parsed = complaintDetailResponseSchema.safeParse(r.body);
  return parsed.success ? { ok: true, data: parsed.data.complaint } : fail(r.status);
}

export async function loadCorrection(id: string): Promise<Loaded<CorrectionDetail>> {
  const r = await getJson(`/api/v1/me/corrections/${encodeURIComponent(id)}`);
  if (!r) return fail(null);
  const parsed = correctionDetailResponseSchema.safeParse(r.body);
  return parsed.success ? { ok: true, data: parsed.data.correction } : fail(r.status);
}

/** The 60 s signed link to one of the caller's own evidence files (unredacted original). */
export async function loadEvidenceUrl(complaintId: string, evidenceId: string): Promise<Loaded<string> | { ok: false; reason: "step_up" }> {
  try {
    const res = await fetch(`/api/v1/me/complaints/${encodeURIComponent(complaintId)}/evidence/${encodeURIComponent(evidenceId)}`, get);
    const body: unknown = await res.json().catch(() => null);
    // Originals need a fresh email code first (step-up, N3).
    if (res.status === 403 && isStepUpRequiredBody(body)) return { ok: false, reason: "step_up" };
    const parsed = evidenceUrlResponseSchema.safeParse(body);
    return res.ok && parsed.success ? { ok: true, data: parsed.data.url } : fail(res.status);
  } catch {
    return fail(null);
  }
}

export async function saveMyNagaSelfReport(complaintId: string, input: MyNagaSelfReport): Promise<Loaded<MyNagaHandoff>> {
  try {
    const res = await fetch(`/api/v1/me/reports/complaint/${encodeURIComponent(complaintId)}/mynaga`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
    });
    if (res.status === 400) return { ok: false, reason: "failed", message: M.badReference };
    if (!res.ok) return fail(res.status);
    const parsed = myNagaHandoffResponseSchema.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data.handoff } : fail(null);
  } catch {
    return fail(null);
  }
}

/** A reporter's own action on a report. 409: the report moved on; 400: the answer or files were refused. */
function actionFail(status: number | null): Loaded<true> {
  if (status === 409) return { ok: false, reason: "changed", message: M.changed };
  if (status === 400) return { ok: false, reason: "invalid", message: M.invalid };
  const r = fail<true>(status);
  return !r.ok && r.reason === "failed" ? { ...r, message: M.sendFailed } : r;
}

async function postAction(kind: "complaint" | "correction", id: string, action: "withdraw" | "answer", body: unknown): Promise<Loaded<true>> {
  try {
    const res = await fetch(`/api/v1/me/reports/${kind}/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok) return actionFail(res.status);
    return reportActionResponseSchema.safeParse(await res.json().catch(() => null)).success ? { ok: true, data: true } : actionFail(null);
  } catch {
    return actionFail(null);
  }
}

/** Takes back a driver report; it is deleted 30 days later. */
export const withdrawComplaint = (id: string) => postAction("complaint", id, "withdraw", {});
/** The reply to a reviewer who asked for more information on a driver report. */
export const answerComplaint = (id: string, answer: ComplaintAnswer) => postAction("complaint", id, "answer", answer);
/** The reply to a reviewer who asked for more evidence on a correction. */
export const answerCorrection = (id: string, answer: CorrectionAnswer) => postAction("correction", id, "answer", answer);
