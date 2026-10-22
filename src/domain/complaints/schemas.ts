import { z } from "zod";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { COMPLAINT_CATEGORIES } from "./categories";
import { REFERENCE_RE } from "./reference";
import { COMPLAINT_STATUSES } from "./status";
import { en, type Dict } from "@/i18n/dict";

// Limits from spec 05 §5.6 (complaint description 2 000 chars) and §3.9 (evidence).
export const COMPLAINT_DESCRIPTION_MIN = 10;
export const COMPLAINT_DESCRIPTION_MAX = 2000;
export const MAX_COMPLAINT_EVIDENCE = 3;
export const MAX_LOCATION_ACCURACY_M = 5000;
export const LOCATION_TEXT_MAX = 200;
export const OPERATOR_MAX = 120;
export const VEHICLE_ID_MAX = 16;
/** How far back an incident may be reported, and the clock skew allowed into the future. */
export const INCIDENT_MAX_AGE_DAYS = 365;
export const INCIDENT_FUTURE_SKEW_MS = 5 * 60 * 1000;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/;
const clean = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((s) => !CONTROL.test(s), "control characters");
const vehicleId = z.string().trim().min(1).max(VEHICLE_ID_MAX).regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/);

/** Null when fine, else a short reason. `now` is injected so the rule is testable. */
export function incidentTimeProblem(iso: string, now: number, copy: Dict["driverReport"] = en.driverReport): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return copy.enterWhen;
  if (t > now + INCIDENT_FUTURE_SKEW_MS) return copy.future;
  if (t < now - INCIDENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return copy.tooOld;
  return null;
}

export const complaintGpsSchema = z
  .object({
    lat: z.number().min(NAGA_MAX_BOUNDS.south).max(NAGA_MAX_BOUNDS.north),
    lng: z.number().min(NAGA_MAX_BOUNDS.west).max(NAGA_MAX_BOUNDS.east),
    accuracyM: z.number().min(0).max(MAX_LOCATION_ACCURACY_M),
  })
  .strict();
export type ComplaintGps = z.infer<typeof complaintGpsSchema>;

export const CAPTURE_KINDS = ["in_app_camera", "file_upload"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const complaintEvidenceInputSchema = z
  .object({
    mediaId: z.uuid(),
    captureKind: z.enum(CAPTURE_KINDS),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

/** Body of POST /api/v1/complaints. Strict: unknown fields (e.g. a status or queue) are refused. */
export const createComplaintPayloadSchema = z
  .object({
    clientRequestId: z.uuid(),
    category: z.enum(COMPLAINT_CATEGORIES),
    description: clean(COMPLAINT_DESCRIPTION_MIN, COMPLAINT_DESCRIPTION_MAX),
    incidentAt: z.iso
      .datetime({ offset: true })
      .refine((s) => incidentTimeProblem(s, Date.now()) === null, "incident time out of range"),
    gps: complaintGpsSchema.optional(),
    locationText: clean(1, LOCATION_TEXT_MAX).optional(),
    operator: clean(1, OPERATOR_MAX).optional(),
    plate: vehicleId.optional(),
    bodyNumber: vehicleId.optional(),
    evidence: z
      .array(complaintEvidenceInputSchema)
      .max(MAX_COMPLAINT_EVIDENCE)
      .default([])
      .refine((list) => new Set(list.map((e) => e.mediaId)).size === list.length, "duplicate evidence"),
    /** The reporter ticked the acknowledgment (brief §9D) on the review step. */
    noticeAccepted: z.literal(true),
  })
  .strict();
export type CreateComplaintPayload = z.infer<typeof createComplaintPayloadSchema>;
export type CreateComplaintInput = z.input<typeof createComplaintPayloadSchema>;

export const complaintReceiptSchema = z.object({
  id: z.uuid(),
  reference: z.string().regex(REFERENCE_RE),
  category: z.enum(COMPLAINT_CATEGORIES),
  status: z.enum(COMPLAINT_STATUSES),
  submittedAt: z.string(),
});
export type ComplaintReceipt = z.infer<typeof complaintReceiptSchema>;

export const createComplaintResponseSchema = z.object({ complaint: complaintReceiptSchema });
export type CreateComplaintResponse = z.infer<typeof createComplaintResponseSchema>;

export const myComplaintSchema = complaintReceiptSchema.extend({
  incidentAt: z.string(),
  evidence: z.array(z.object({ id: z.uuid(), captureKind: z.enum(CAPTURE_KINDS) })),
});
export type MyComplaint = z.infer<typeof myComplaintSchema>;

export const myComplaintsResponseSchema = z.object({ complaints: z.array(myComplaintSchema) });
export type MyComplaintsResponse = z.infer<typeof myComplaintsResponseSchema>;

/** GET /api/v1/me/complaints/[id]/evidence/[evidenceId]: a short-lived download link, never cached. */
export const evidenceUrlResponseSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number().int().min(1).max(60),
});
export type EvidenceUrlResponse = z.infer<typeof evidenceUrlResponseSchema>;

// ---------------------------------------------------------------- per-step checks (client)

export function validateCategory(category: string | null, copy: Dict = en): string | null {
  return category && (COMPLAINT_CATEGORIES as readonly string[]).includes(category) ? null : copy.driverReport.chooseWhat;
}

export function validateComplaintDescription(description: string, copy: Dict = en): string | null {
  const n = description.trim().length;
  if (n < COMPLAINT_DESCRIPTION_MIN) return copy.forms.minChars(COMPLAINT_DESCRIPTION_MIN);
  if (n > COMPLAINT_DESCRIPTION_MAX) return copy.forms.maxChars(COMPLAINT_DESCRIPTION_MAX);
  if (CONTROL.test(description)) return copy.driverReport.hiddenChars;
  return null;
}

export function validateVehicleId(value: string, label: string, copy: Dict["driverReport"] = en.driverReport): string | null {
  const v = value.trim();
  if (!v) return null;
  return vehicleId.safeParse(v).success ? null : copy.vehicleId(label, VEHICLE_ID_MAX);
}
