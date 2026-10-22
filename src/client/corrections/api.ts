"use client";

// Browser side of the correction wizard: submit, and the optional photo upload through the B4
// media slots (slot -> PUT to quarantine -> confirm). Nothing is stored on the phone.

import {
  createCorrectionResponseSchema,
  type CorrectionSummary,
  type CreateCorrectionInput,
} from "@/domain/corrections/schemas";
import { confirmMediaResponseSchema, createMediaSlotResponseSchema } from "@/domain/media/schemas";
import { en } from "@/i18n/dict";

// English messages from the dictionary; screens show them with translated(message, en.report.api, t.report.api).
const M = en.report.api;

export type SubmitResult =
  | { ok: true; correction: CorrectionSummary }
  | { ok: false; reason: "signed_out" | "rate_limited" | "invalid" | "failed"; message: string };

const json = { "content-type": "application/json" };

export async function submitCorrection(input: CreateCorrectionInput): Promise<SubmitResult> {
  try {
    const res = await fetch("/api/v1/corrections", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { ok: false, reason: "signed_out", message: M.signedOut };
    if (res.status === 429) return { ok: false, reason: "rate_limited", message: M.rateLimited };
    if (res.status === 400) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, reason: "invalid", message: data?.error?.message ?? M.invalid };
    }
    if (!res.ok) return { ok: false, reason: "failed", message: M.failed };
    const parsed = createCorrectionResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: "failed", message: M.failed };
    return { ok: true, correction: parsed.data.correction };
  } catch {
    return { ok: false, reason: "failed", message: M.offline };
  }
}

export type UploadResult = { ok: true; mediaId: string } | { ok: false; message: string };

const UPLOAD_FAILED = M.uploadFailed;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function uploadEvidencePhoto(file: File): Promise<UploadResult> {
  return uploadPhoto(file, "correction_evidence");
}

/** Slot -> PUT to quarantine -> confirm. The verified photo stays private until a person approves it (N6). */
export async function uploadPhoto(file: File, purpose: "correction_evidence" | "community_photo"): Promise<UploadResult> {
  if (!IMAGE_TYPES.includes(file.type)) return { ok: false, message: M.photoType };
  try {
    const slotRes = await fetch("/api/v1/media/slots", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      body: JSON.stringify({ purpose, expectedBytes: file.size, mime: file.type }),
    });
    if (!slotRes.ok) return { ok: false, message: UPLOAD_FAILED };
    const slot = createMediaSlotResponseSchema.parse(await slotRes.json()).slot;
    const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
    if (!put.ok) return { ok: false, message: UPLOAD_FAILED };
    const confirm = await fetch("/api/v1/media/confirm", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      body: JSON.stringify({ slotId: slot.id }),
    });
    if (!confirm.ok) return { ok: false, message: UPLOAD_FAILED };
    const media = confirmMediaResponseSchema.parse(await confirm.json()).media;
    return media.status === "verified" ? { ok: true, mediaId: media.id } : { ok: false, message: M.photoRejected };
  } catch {
    return { ok: false, message: UPLOAD_FAILED };
  }
}
