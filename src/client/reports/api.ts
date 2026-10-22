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
  type ComplaintDetail,
  type CorrectionDetail,
  type MyNagaHandoff,
  type MyNagaSelfReport,
} from "@/domain/reports/schemas";

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "signed_out" | "not_found" | "rate_limited" | "failed"; message: string };

const get = { credentials: "same-origin", cache: "no-store" } as const;
const FAILED = "This could not be loaded. Check your connection and try again.";

function fail<T>(status: number | null): Loaded<T> {
  if (status === 401) return { ok: false, reason: "signed_out", message: "Sign in to see your reports." };
  if (status === 404) return { ok: false, reason: "not_found", message: "This report was not found." };
  if (status === 429) return { ok: false, reason: "rate_limited", message: "Too many requests. Wait a moment, then try again." };
  return { ok: false, reason: "failed", message: FAILED };
}

async function getJson(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, get);
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return null;
  }
}

/** The merged list is built here from the two existing own-list endpoints (no new server route). */
export async function loadMyReports(): Promise<Loaded<ReportRow[]>> {
  const [c, d] = await Promise.all([getJson("/api/v1/me/corrections"), getJson("/api/v1/me/complaints")]);
  if (!c || !d) return fail(null);
  if (c.status === 401 || d.status === 401) return fail(401);
  const corrections = myCorrectionsResponseSchema.safeParse(c.body);
  const complaints = myComplaintsResponseSchema.safeParse(d.body);
  if (!corrections.success || !complaints.success) return fail(c.status === 429 || d.status === 429 ? 429 : null);
  return { ok: true, data: mergeReports(corrections.data.corrections, complaints.data.complaints) };
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
    if (res.status === 400) return { ok: false, reason: "failed", message: "Check the reference. It can be up to 64 characters." };
    if (!res.ok) return fail(res.status);
    const parsed = myNagaHandoffResponseSchema.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data.handoff } : fail(null);
  } catch {
    return fail(null);
  }
}
