// A14 Corrections review (N6, C9): the shapes shared by /api/v1/admin/corrections and the browser,
// and what each status lets a reviewer do. Pure and browser-safe (zod only). The database repeats
// every rule (community.admin_review_correction, migration 0025): role, not your own report, the
// status the page saw, the transitions, templated reasons, and that an accepted change lands in the
// open DRAFT revision only (AC-13: nothing public changes until a validated publication).
import { z } from "zod";
import { CORRECTION_CATEGORIES, ENTITY_TYPES } from "@/domain/corrections/categories";
import { INFO_REASONS, REJECT_REASONS } from "@/domain/corrections/review-reasons";
import { CORRECTION_STATUSES, type CorrectionStatus } from "@/domain/corrections/status";
import { stopActionSchema, STOP_STATUSES } from "./stops";

export const REVIEW_ACTIONS = ["start_review", "request_info", "reject", "duplicate", "accept"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Mirrors the transition list in community.admin_review_correction (0025). */
const OFFERED: Readonly<Partial<Record<CorrectionStatus, readonly ReviewAction[]>>> = {
  submitted: ["start_review", "request_info", "reject", "duplicate"],
  under_review: ["accept", "request_info", "reject", "duplicate"],
  needs_evidence: ["start_review", "reject", "duplicate"],
};

export function reviewActions(status: CorrectionStatus): readonly ReviewAction[] {
  return OFFERED[status] ?? [];
}

export const ACTION_LABELS: Readonly<Record<ReviewAction, string>> = {
  start_review: "Start review",
  request_info: "Ask for more information",
  reject: "Reject",
  duplicate: "Mark as duplicate",
  accept: "Accept into the draft",
};

/** Reviewer-facing wording of the templated reasons (the reporter sees their own localized text). */
export const REASON_LABELS: Readonly<Record<(typeof INFO_REASONS)[number] | (typeof REJECT_REASONS)[number], string>> = {
  need_photo: "Needs a photo",
  need_location: "Needs the exact location",
  need_details: "Needs more detail",
  need_time: "Needs the date and time seen",
  already_correct: "The data already shows this",
  not_verifiable: "Could not be verified",
  out_of_scope: "Outside what ParaNaga covers",
  not_transport: "Not about transport data",
};

const uuid = z.uuid();
const ts = z.string().min(1);

export const draftChangeSchema = z.object({
  kind: z.enum(["draft_version", "proposal"]),
  entityKind: z.string().optional(),
  entityId: z.string().optional(),
  versionId: uuid.optional(),
  fareRuleVersionId: uuid.optional(),
});
export type DraftChange = z.infer<typeof draftChangeSchema>;

export const correctionItemSchema = z.object({
  id: uuid,
  kind: z.enum(CORRECTION_CATEGORIES),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string(),
  entityLabel: z.string().nullable(),
  entityRevisionId: uuid.nullable(),
  description: z.string(),
  status: z.enum(CORRECTION_STATUSES),
  submittedAt: ts.nullable(),
  updatedAt: ts,
  /** Jev's advisory outcome at submission (never a decision). */
  moderationReason: z.string().nullable(),
  reviewerNote: z.string().nullable(),
  duplicateOf: uuid.nullable(),
  draftRevisionId: uuid.nullable(),
  draftChange: draftChangeSchema.nullable(),
  incorporatedRevisionId: uuid.nullable(),
  reviewedAt: ts.nullable(),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable() }).nullable(),
  media: z.array(z.object({ id: uuid, mime: z.string().nullable() })),
  events: z.array(
    z.object({ from: z.string().nullable(), to: z.string(), at: ts, actorRole: z.string().nullable(), reasonCode: z.string().nullable(), note: z.string().nullable() }),
  ),
  similar: z.array(z.object({ id: uuid, kind: z.string(), status: z.string(), submittedAt: ts.nullable() })),
  stop: z
    .object({
      stopPointId: uuid,
      name: z.string(),
      versionId: uuid,
      status: z.enum(STOP_STATUSES),
      inDraft: z.boolean(),
      /** The draft already holds a new version of this stop (an edit made since publication). */
      changedInDraft: z.boolean(),
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  fares: z
    .array(
      z.object({
        fareRuleId: uuid,
        code: z.string(),
        modeCode: z.string(),
        versionId: uuid,
        baseCentavos: z.number().nullable(),
        status: z.string(),
        effectiveFrom: z.string().nullable(),
        sourceCodes: z.array(z.string()),
        evidence: z.array(z.object({ claim: z.string(), kind: z.string(), sourceCode: z.string().nullable() })),
        openConflicts: z.number(),
      }),
    )
    .nullable(),
});
export type CorrectionItem = z.infer<typeof correctionItemSchema>;

export const correctionQueueSchema = z.object({
  draft: z.object({ id: uuid, label: z.string() }).nullable(),
  corrections: z.array(correctionItemSchema),
});
export type CorrectionQueue = z.infer<typeof correctionQueueSchema>;

export const CORRECTION_SCOPES = ["open", "closed"] as const;
export type CorrectionScope = (typeof CORRECTION_SCOPES)[number];

const note = z.string().trim().max(1000);
const base = { expectedStatus: z.enum(CORRECTION_STATUSES), note: note.optional() };

/** How an accepted report lands in the draft. */
export const acceptChangeSchema = z.discriminatedUnion("kind", [
  /** A stop action (0024) made now, in the same transaction; the report's stop only. */
  z.object({ kind: z.literal("stop_action"), stopPointId: uuid, stopAction: stopActionSchema }).strict(),
  /** A version already in the open draft (an edit made on Stops & curbs). */
  z.object({ kind: z.literal("draft_version"), versionId: uuid }).strict(),
  /** No automatic mapping: the reviewer's note records what to change. */
  z.object({ kind: z.literal("proposal") }).strict(),
]);
export type AcceptChange = z.infer<typeof acceptChangeSchema>;

export const reviewPayloadSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("start_review"), ...base }).strict(),
    z.object({ action: z.literal("request_info"), ...base, reason: z.enum(INFO_REASONS) }).strict(),
    z.object({ action: z.literal("reject"), ...base, reason: z.enum(REJECT_REASONS) }).strict(),
    z.object({ action: z.literal("duplicate"), ...base, duplicateOf: uuid }).strict(),
    z.object({ action: z.literal("accept"), ...base, change: acceptChangeSchema, fareRuleVersionId: uuid.optional() }).strict(),
  ])
  .refine((p) => p.action !== "accept" || p.change.kind !== "proposal" || (p.note ?? "").trim().length > 0, {
    message: "A proposal needs a note that says what to change.",
  });
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;

export const reviewResultSchema = z.object({
  id: uuid,
  status: z.enum(CORRECTION_STATUSES),
  draftRevisionId: uuid.nullable(),
  draftChange: draftChangeSchema.nullable(),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

/** "₱13.00", or "–" when unknown. */
export function pesos(centavos: number | null): string {
  return centavos === null ? "–" : `₱${(centavos / 100).toFixed(2)}`;
}
