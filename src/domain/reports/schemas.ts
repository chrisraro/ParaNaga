import { z } from "zod";
import { CAPTURE_KINDS, complaintReceiptSchema } from "@/domain/complaints/schemas";
import { COMPLAINT_STATUSES } from "@/domain/complaints/status";
import { correctionSummarySchema } from "@/domain/corrections/schemas";
import { CORRECTION_STATUSES } from "@/domain/corrections/status";

// My reports (S19) and the MyNaga self-report (S20, F-D5), task B9. Everything here is the
// signed-in owner's own data, served `private, no-store`.

export const REPORT_KINDS = ["complaint"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const MYNAGA_REFERENCE_MAX = 64;
const CONTROL = /[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/;

/** Body of POST /api/v1/me/reports/complaint/[id]/mynaga. Strict: nothing else is accepted. */
export const myNagaSelfReportSchema = z
  .object({
    submitted: z.boolean(),
    reference: z
      .string()
      .trim()
      .min(1)
      .max(MYNAGA_REFERENCE_MAX)
      .refine((s) => !CONTROL.test(s), "control characters")
      .optional(),
  })
  .strict()
  .refine((b) => b.submitted || b.reference === undefined, "a reference needs the submitted flag");
export type MyNagaSelfReport = z.infer<typeof myNagaSelfReportSchema>;

/** What the reporter says they did in MyNaga. Never ParaNaga's own status. */
export const myNagaHandoffSchema = z.object({
  submitted: z.boolean(),
  submittedAt: z.string().nullable(),
  reference: z.string().nullable(),
});
export type MyNagaHandoff = z.infer<typeof myNagaHandoffSchema>;
export const myNagaHandoffResponseSchema = z.object({ handoff: myNagaHandoffSchema });

export const complaintEventSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  at: z.string(),
  /** A message the reviewer chose to show the reporter; reviewer-only notes never come back. */
  note: z.string().nullable(),
});

export const complaintDetailSchema = complaintReceiptSchema.extend({
  incidentAt: z.string(),
  description: z.string(),
  locationText: z.string().nullable(),
  operator: z.string().nullable(),
  plate: z.string().nullable(),
  bodyNumber: z.string().nullable(),
  outcomeCode: z.string().nullable(),
  evidence: z.array(z.object({ id: z.uuid(), captureKind: z.enum(CAPTURE_KINDS) })),
  events: z.array(complaintEventSchema),
  handoff: myNagaHandoffSchema,
});
export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;
export const complaintDetailResponseSchema = z.object({ complaint: complaintDetailSchema });

export const correctionDetailSchema = correctionSummarySchema.extend({
  description: z.string(),
  events: z.array(z.object({ status: z.enum(CORRECTION_STATUSES), at: z.string() })),
});
export type CorrectionDetail = z.infer<typeof correctionDetailSchema>;
export const correctionDetailResponseSchema = z.object({ correction: correctionDetailSchema });
