// A15 Community moderation and A16 Appeals (N6, C10): shapes shared by /api/v1/admin/moderation
// and the browser, the reason codes, and when a decision overrides Jev. Pure and browser-safe. The
// database repeats every rule (community.admin_moderate / admin_resolve_appeal, migration 0025):
// role, never your own content, the item must still be pending, an override needs a note, and an
// appeal goes to a different moderator than the one who decided.
import { z } from "zod";

export const TARGET_TYPES = ["post_version", "comment", "photo"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const PUBLISH_REASONS = ["meets_guidelines"] as const;
export const REJECT_REASONS = [
  "spam",
  "harassment",
  "threat",
  "personal_info",
  "driver_allegation",
  "off_topic",
  "misleading",
  "unsafe_photo",
  "other",
] as const;
export type ModerationReason = (typeof PUBLISH_REASONS)[number] | (typeof REJECT_REASONS)[number];

export const REASON_LABELS: Readonly<Record<ModerationReason, string>> = {
  meets_guidelines: "Meets the guidelines",
  spam: "Spam or advertising",
  harassment: "Harassment or insults",
  threat: "Threat of harm",
  personal_info: "Personal information (names, numbers, faces, plates)",
  driver_allegation: "Identifying allegation against a driver (use a private report)",
  off_topic: "Off topic",
  misleading: "Misleading transport information",
  unsafe_photo: "Photo not suitable (faces, plates, unsafe)",
  other: "Other (note required)",
};

export type JevRecommendation = "publish" | "reject" | "human_review";

/**
 * A person's decision overrides Jev when it goes against Jev's typed recommendation: rejecting
 * what Jev would publish, or publishing what Jev would reject. human_review, a failure or no
 * answer is never overridden (there was nothing to go against). Same rule as admin_moderate.
 */
export function isOverride(jev: JevRecommendation | null | undefined, outcome: "published" | "rejected"): boolean {
  return (jev === "publish" && outcome === "rejected") || (jev === "reject" && outcome === "published");
}

/** Reasons that fit an outcome; "other" is only for rejecting. */
export const reasonsFor = (outcome: "published" | "rejected"): readonly ModerationReason[] =>
  outcome === "published" ? PUBLISH_REASONS : REJECT_REASONS;

/** "84%" for a 0..1 confidence; probabilities, not prose (spec 06 A15). */
export const percent = (p: number | null | undefined) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}%`);

const uuid = z.uuid();
const ts = z.string().min(1);

const jevSchema = z
  .object({
    recommendation: z.enum(["publish", "reject", "human_review"]).nullable(),
    confidence: z.number().nullable(),
    unavailableReason: z.string().nullable(),
    policyVersion: z.string().nullable(),
  })
  .nullable();

export const moderationItemSchema = z.object({
  kind: z.enum(TARGET_TYPES),
  id: uuid,
  postId: uuid,
  status: z.string(),
  submittedAt: ts,
  title: z.string().nullable(),
  body: z.string().nullable(),
  tags: z.array(z.string()),
  topic: z.string().nullable(),
  authorHandle: z.string(),
  /** Why it is waiting (the server's policy outcome: auto_publish_disabled, needs_human_review, …). */
  reason: z.string().nullable(),
  isEdit: z.boolean(),
  liveTitle: z.string().nullable(),
  jev: jevSchema,
  openReports: z.number(),
  mediaId: uuid.optional(),
});
export type ModerationItem = z.infer<typeof moderationItemSchema>;

export const appealItemSchema = z.object({
  id: uuid,
  decisionId: uuid,
  targetType: z.enum(TARGET_TYPES),
  targetId: uuid,
  reasonCode: z.string(),
  decidedAt: ts,
  decidedBy: z.enum(["policy", "moderator"]),
  jevRecommendation: z.string().nullable(),
  jevConfidence: z.number().nullable(),
  note: z.string(),
  createdAt: ts,
  excerpt: z.string().nullable(),
  mediaId: uuid.nullable(),
});
export type AppealItem = z.infer<typeof appealItemSchema>;

export const moderationQueueSchema = z.object({
  items: z.array(moderationItemSchema),
  appeals: z.array(appealItemSchema),
  history: z.array(
    z.object({
      id: uuid,
      targetType: z.enum(TARGET_TYPES),
      targetId: uuid,
      outcome: z.enum(["published", "rejected"]),
      reasonCode: z.string(),
      deciderRole: z.enum(["policy", "community_moderator", "admin"]),
      isOverride: z.boolean(),
      mine: z.boolean(),
      appealed: z.boolean(),
      at: ts,
    }),
  ),
});
export type ModerationQueue = z.infer<typeof moderationQueueSchema>;

const note = z.string().trim().max(1000);

export const moderatePayloadSchema = z
  .object({
    targetType: z.enum(TARGET_TYPES),
    targetId: uuid,
    outcome: z.enum(["published", "rejected"]),
    reason: z.enum([...PUBLISH_REASONS, ...REJECT_REASONS]),
    note: note.optional(),
  })
  .strict()
  .refine((p) => (reasonsFor(p.outcome) as readonly string[]).includes(p.reason), { message: "Choose a reason that fits the decision." })
  .refine((p) => p.reason !== "other" || (p.note ?? "").length > 0, { message: "The reason “Other” needs a note." });
export type ModeratePayload = z.infer<typeof moderatePayloadSchema>;

export const resolveAppealPayloadSchema = z
  .object({
    outcome: z.enum(["upheld", "overturned"]),
    note: z.string().trim().min(3, "Write a note for the decision history.").max(1000),
  })
  .strict();
export type ResolveAppealPayload = z.infer<typeof resolveAppealPayloadSchema>;

export const decisionResultSchema = z.object({ decisionId: uuid, isOverride: z.boolean() });
export type DecisionResult = z.infer<typeof decisionResultSchema>;

/** The private source and public destination of an approved photo (from the database). */
export const photoCopySchema = z
  .object({ sourceBucket: z.string(), key: z.string(), mime: z.string().nullable(), publicBucket: z.string() })
  .nullable();
