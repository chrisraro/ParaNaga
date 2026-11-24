import { z } from "zod";
import { CAPTURE_KINDS, complaintEvidenceInputSchema, complaintReceiptSchema, MAX_COMPLAINT_EVIDENCE } from "@/domain/complaints/schemas";
import { COMPLAINT_STATUSES } from "@/domain/complaints/status";
import { correctionSummarySchema } from "@/domain/corrections/schemas";
import { REVIEW_REASONS } from "@/domain/corrections/review-reasons";
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

/** What the reporter says they did in MyNaga. Never Lunad's own status. */
export const myNagaHandoffSchema = z.object({
  submitted: z.boolean(),
  submittedAt: z.string().nullable(),
  reference: z.string().nullable(),
});
export type MyNagaHandoff = z.infer<typeof myNagaHandoffSchema>;
export const myNagaHandoffResponseSchema = z.object({ handoff: myNagaHandoffSchema });

/** What a reporter may still do with a report they sent (migration 0038). */
export const ANSWER_MAX = 1000;
/** Files on one driver report, first evidence and answers together; photos on one correction. */
export const COMPLAINT_FILES_MAX = 6;
export const CORRECTION_PHOTOS_MAX = 3;
const ANSWER_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;
const answerText = z.string().trim().min(1).max(ANSWER_MAX).refine((s) => !ANSWER_CONTROL.test(s), "control characters");
const distinct = (ids: string[]) => new Set(ids).size === ids.length;

/** Body of POST /api/v1/me/reports/complaint/[id]/answer. */
export const complaintAnswerSchema = z
  .object({
    text: answerText,
    evidence: z.array(complaintEvidenceInputSchema).max(MAX_COMPLAINT_EVIDENCE).default([]).refine((l) => distinct(l.map((e) => e.mediaId)), "duplicate evidence"),
  })
  .strict();
/** Body of POST /api/v1/me/reports/correction/[id]/answer. */
export const correctionAnswerSchema = z
  .object({ text: answerText, mediaIds: z.array(z.uuid()).max(CORRECTION_PHOTOS_MAX).default([]).refine(distinct, "duplicate photo") })
  .strict();
export type ComplaintAnswer = z.input<typeof complaintAnswerSchema>;
export type CorrectionAnswer = z.input<typeof correctionAnswerSchema>;
export const reportActionResponseSchema = z.object({ ok: z.literal(true) });

/** A reporter withdraws before a reviewer has it, or while they wait for an answer (spec 04 §4.7). */
export const canWithdraw = (status: (typeof COMPLAINT_STATUSES)[number]) => status === "submitted" || status === "needs_information";

export const complaintEventSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  at: z.string(),
  /** A message the reviewer chose to show the reporter, or the reporter's own answer (own); reviewer-only notes never come back. */
  note: z.string().nullable(),
  own: z.boolean().default(false),
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
  /** reason: a reviewer's templated reason (N6), shown to the reporter in their language. */
  events: z.array(z.object({ status: z.enum(CORRECTION_STATUSES), at: z.string(), reason: z.enum(REVIEW_REASONS).nullable().default(null), answer: z.string().nullable().default(null) })),
  /** Photos already on the report (an answer may add up to CORRECTION_PHOTOS_MAX in total). */
  photoCount: z.number().int().min(0).default(0),
});
export type CorrectionDetail = z.infer<typeof correctionDetailSchema>;
export const correctionDetailResponseSchema = z.object({ correction: correctionDetailSchema });
