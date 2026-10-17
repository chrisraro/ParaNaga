import { z } from "zod";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { CORRECTION_CATEGORIES, ENTITY_TYPES } from "./categories";
import { CORRECTION_STATUSES } from "./status";

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const MAX_EVIDENCE_PHOTOS = 3;
export const MAX_ACCURACY_M = 5000;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const cleanText = z.string().refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), "control characters");

export const correctionLocationSchema = z
  .object({
    lat: z.number().min(NAGA_MAX_BOUNDS.south).max(NAGA_MAX_BOUNDS.north),
    lng: z.number().min(NAGA_MAX_BOUNDS.west).max(NAGA_MAX_BOUNDS.east),
    accuracyM: z.number().min(0).max(MAX_ACCURACY_M),
  })
  .strict();
export type CorrectionLocation = z.infer<typeof correctionLocationSchema>;

/** Body of POST /api/v1/corrections (create and submit in one call). */
export const createCorrectionPayloadSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    category: z.enum(CORRECTION_CATEGORIES),
    entityType: z.enum(ENTITY_TYPES),
    entityId: text(1, 120),
    entityLabel: text(1, 120).optional(),
    description: text(DESCRIPTION_MIN, DESCRIPTION_MAX).pipe(cleanText),
    location: correctionLocationSchema.optional(),
    mediaIds: z.array(z.string().uuid()).max(MAX_EVIDENCE_PHOTOS).default([]),
    /** True when the commuter accepted the AI-processing disclosure in this submission. */
    aiDisclosureAccepted: z.boolean().default(false),
  })
  .strict();
export type CreateCorrectionPayload = z.infer<typeof createCorrectionPayloadSchema>;
export type CreateCorrectionInput = z.input<typeof createCorrectionPayloadSchema>;

/** Wizard state validation per step (client). */
export function validateWhatsWrong(category: string | null): string | null {
  return category && (CORRECTION_CATEGORIES as readonly string[]).includes(category) ? null : "Choose what is wrong.";
}
export function validateDescription(description: string): string | null {
  const n = description.trim().length;
  if (n < DESCRIPTION_MIN) return `Write at least ${DESCRIPTION_MIN} characters.`;
  if (n > DESCRIPTION_MAX) return `Keep it under ${DESCRIPTION_MAX} characters.`;
  return null;
}

export const correctionSummarySchema = z.object({
  id: z.string().uuid(),
  category: z.enum(CORRECTION_CATEGORIES),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string(),
  entityLabel: z.string().nullable(),
  status: z.enum(CORRECTION_STATUSES),
  submittedAt: z.string(),
});
export type CorrectionSummary = z.infer<typeof correctionSummarySchema>;

export const createCorrectionResponseSchema = z.object({
  correction: correctionSummarySchema,
});
export type CreateCorrectionResponse = z.infer<typeof createCorrectionResponseSchema>;

export const myCorrectionsResponseSchema = z.object({
  corrections: z.array(correctionSummarySchema),
});
export type MyCorrectionsResponse = z.infer<typeof myCorrectionsResponseSchema>;
