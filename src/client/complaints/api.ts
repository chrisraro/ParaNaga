"use client";

// Browser side of Report a driver (S18): evidence upload through the B4 media slots
// (slot -> PUT to quarantine -> confirm; the server moves it to the private bucket), then the
// private submission. Nothing is written to the phone's storage; answers live in memory only.

import {
  createComplaintResponseSchema,
  type ComplaintReceipt,
  type CreateComplaintInput,
} from "@/domain/complaints/schemas";
import { confirmMediaResponseSchema, createMediaSlotResponseSchema, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from "@/domain/media/schemas";

export type SubmitComplaintResult =
  | { ok: true; complaint: ComplaintReceipt }
  | { ok: false; reason: "signed_out" | "rate_limited" | "invalid" | "failed"; message: string };

const json = { "content-type": "application/json" };
const KEPT = "Your answers are kept on this screen. Try again.";

export async function submitComplaint(input: CreateComplaintInput): Promise<SubmitComplaintResult> {
  try {
    const res = await fetch("/api/v1/complaints", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { ok: false, reason: "signed_out", message: "Sign in to send this report." };
    if (res.status === 429) return { ok: false, reason: "rate_limited", message: "You have sent several reports today. Try again tomorrow." };
    if (res.status === 400) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, reason: "invalid", message: data?.error?.message ?? "Check the report and try again." };
    }
    if (!res.ok) return { ok: false, reason: "failed", message: `The report could not be sent. ${KEPT}` };
    const parsed = createComplaintResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: "failed", message: `The report could not be sent. ${KEPT}` };
    return { ok: true, complaint: parsed.data.complaint };
  } catch {
    return { ok: false, reason: "failed", message: `No connection. ${KEPT}` };
  }
}

export const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"] as const;
type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** The upload type for a blob: codec parameters (video/webm;codecs=vp8) are dropped. */
export function evidenceType(mime: string): EvidenceType | null {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return (EVIDENCE_TYPES as readonly string[]).includes(base) ? (base as EvidenceType) : null;
}

export type EvidenceUploadResult = { ok: true; mediaId: string } | { ok: false; message: string };
const UPLOAD_FAILED = "This file could not be uploaded. Try again, remove it, or send the report without it.";

export async function uploadComplaintEvidence(blob: Blob): Promise<EvidenceUploadResult> {
  const mime = evidenceType(blob.type);
  if (!mime) return { ok: false, message: "Use a JPEG, PNG or WebP photo, or an MP4 or WebM video." };
  const max = mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (blob.size === 0 || blob.size > max) return { ok: false, message: `This file is too large. The limit is ${Math.round(max / 1024 / 1024)} MB.` };
  try {
    const slotRes = await fetch("/api/v1/media/slots", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ purpose: "complaint_evidence", expectedBytes: blob.size, mime }),
    });
    if (!slotRes.ok) return { ok: false, message: UPLOAD_FAILED };
    const slot = createMediaSlotResponseSchema.parse(await slotRes.json()).slot;
    const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: blob, referrerPolicy: "no-referrer" });
    if (!put.ok) return { ok: false, message: UPLOAD_FAILED };
    const confirm = await fetch("/api/v1/media/confirm", {
      method: "POST",
      headers: json,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ slotId: slot.id }),
    });
    if (!confirm.ok) return { ok: false, message: UPLOAD_FAILED };
    const media = confirmMediaResponseSchema.parse(await confirm.json()).media;
    return media.status === "verified" ? { ok: true, mediaId: media.id } : { ok: false, message: "This file was not accepted. Try another one." };
  } catch {
    return { ok: false, message: UPLOAD_FAILED };
  }
}
