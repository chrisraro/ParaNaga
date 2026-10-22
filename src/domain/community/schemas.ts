import { z } from "zod";
import { CONTENT_STATES } from "./status";
import { TOPIC_VALUES } from "./topics";
import { en, type Dict } from "@/i18n/dict";

// Request and response shapes of /api/v1/community/*. Request bodies are strict.

export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const BODY_MIN = 10;
export const BODY_MAX = 2000;
export const COMMENT_MIN = 2;
export const COMMENT_MAX = 600;
export const MAX_TAGS = 3;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 60;
export const NOTE_MAX = 300;
export const EXCERPT_CHARS = 180;
export const FEED_PAGE_SIZE = 20;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const clean = (s: string) => !CONTROL_CHARS.test(s);
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(clean, "control characters");

const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
/** A tag as typed: trimmed, lowercased, a leading "#" dropped. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, "");
}
export const isValidTag = (tag: string): boolean => TAG_RE.test(tag);
export const tagSchema = z.string().transform(normalizeTag).pipe(z.string().regex(TAG_RE));

const tagsSchema = z
  .array(tagSchema)
  .max(MAX_TAGS)
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const routeCodeSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/);
export const topicSchema = z.enum(TOPIC_VALUES);

const REASONS = ["spam", "harassment", "personal_info", "off_topic", "misleading", "other"] as const;
/** The report reasons in display order, worded in `copy`'s language (community.reasons). */
export const reportReasonsIn = (copy: Dict["community"] = en.community) => REASONS.map((value) => ({ value, label: copy.reasons[value] }));
export const REPORT_REASONS = reportReasonsIn();
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value) as [ReportReason, ...ReportReason[]];

export const targetTypeSchema = z.enum(["post", "comment"]);
export type TargetType = z.infer<typeof targetTypeSchema>;

// ---------------------------------------------------------------- requests
export const createPostPayloadSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    topic: topicSchema,
    title: text(TITLE_MIN, TITLE_MAX),
    body: text(BODY_MIN, BODY_MAX),
    tags: tagsSchema,
    routeCode: routeCodeSchema.optional(),
    guidelinesAccepted: z.boolean().default(false),
  })
  .strict();
export type CreatePostInput = z.input<typeof createPostPayloadSchema>;

export const editPostPayloadSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    title: text(TITLE_MIN, TITLE_MAX),
    body: text(BODY_MIN, BODY_MAX),
    tags: tagsSchema,
    guidelinesAccepted: z.boolean().default(false),
  })
  .strict();
export type EditPostInput = z.input<typeof editPostPayloadSchema>;

export const createCommentPayloadSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    parentCommentId: z.string().uuid().optional(),
    body: text(COMMENT_MIN, COMMENT_MAX),
    guidelinesAccepted: z.boolean().default(false),
  })
  .strict();
export type CreateCommentInput = z.input<typeof createCommentPayloadSchema>;

export const reactionPayloadSchema = z.object({ targetType: targetTypeSchema, targetId: z.string().uuid() }).strict();
export const bookmarkPayloadSchema = z.object({ postId: z.string().uuid() }).strict();
export const blockPayloadSchema = z.object({ targetType: targetTypeSchema, targetId: z.string().uuid() }).strict();
export const reportPayloadSchema = z
  .object({
    targetType: targetTypeSchema,
    targetId: z.string().uuid(),
    reason: z.enum(REPORT_REASON_VALUES),
    note: text(1, NOTE_MAX).optional(),
  })
  .strict();

export const FEED_SCOPES = ["all", "mine", "saved"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

/** Query string of GET /api/v1/community/posts. Unknown keys are ignored; bad values are errors. */
export const feedQuerySchema = z.object({
  topic: topicSchema.optional(),
  q: z.string().trim().min(SEARCH_MIN).max(SEARCH_MAX).refine(clean).optional(),
  tag: tagSchema.optional(),
  scope: z.enum(FEED_SCOPES).default("all"),
  cursor: z.coerce.number().int().positive().optional(),
  /** "1" asks for the signed-in view (own flags, blocks); the answer is then private. */
  me: z.enum(["1"]).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

// ---------------------------------------------------------------- responses
export const labelSchema = z.enum(["community", "official_notice", "incorporated_change"]);
export const LABEL_TEXT: Record<z.infer<typeof labelSchema>, string> = en.community.labels;

const stateSchema = z.enum(CONTENT_STATES);

export const postSummarySchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  topic: topicSchema,
  title: z.string(),
  excerpt: z.string(),
  tags: z.array(z.string()),
  routeCode: z.string().nullable(),
  label: labelSchema,
  authorHandle: z.string(),
  isOwn: z.boolean(),
  createdAt: z.string(),
  helpfulCount: z.number().int(),
  commentCount: z.number().int(),
  viewerHelpful: z.boolean(),
  viewerBookmarked: z.boolean(),
  state: stateSchema,
  hasPendingEdit: z.boolean(),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

export const feedResponseSchema = z.object({
  posts: z.array(postSummarySchema),
  nextCursor: z.number().int().nullable(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;

export type CommentDto = {
  id: string;
  parentId: string | null;
  depth: number;
  authorHandle: string;
  isOwn: boolean;
  body: string;
  createdAt: string;
  helpfulCount: number;
  viewerHelpful: boolean;
  state: z.infer<typeof stateSchema>;
  replies: CommentDto[];
};
export const commentSchema: z.ZodType<CommentDto> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    depth: z.number().int().min(1).max(2),
    authorHandle: z.string(),
    isOwn: z.boolean(),
    body: z.string(),
    createdAt: z.string(),
    helpfulCount: z.number().int(),
    viewerHelpful: z.boolean(),
    state: stateSchema,
    replies: z.array(commentSchema),
  }),
);

export const versionEntrySchema = z.object({
  n: z.number().int(),
  title: z.string(),
  state: stateSchema,
  isLive: z.boolean(),
  submittedAt: z.string(),
});

export const postDetailSchema = z.object({
  post: postSummarySchema.extend({
    body: z.string(),
    /** The author's own history; empty for everyone else. */
    versions: z.array(versionEntrySchema),
    /** What the editor starts from (the author's latest version); null for everyone else. */
    editDraft: z.object({ title: z.string(), body: z.string(), tags: z.array(z.string()) }).nullable(),
  }),
  comments: z.array(commentSchema),
});
export type PostDetail = z.infer<typeof postDetailSchema>;

export const submitPostResponseSchema = z.object({
  post: z.object({ id: z.string().uuid(), state: stateSchema, isEdit: z.boolean(), visibleToOthers: z.boolean() }),
});
export type SubmitPostResponse = z.infer<typeof submitPostResponseSchema>;

export const submitCommentResponseSchema = z.object({
  comment: z.object({ id: z.string().uuid(), state: stateSchema, depth: z.number().int() }),
});
export type SubmitCommentResponse = z.infer<typeof submitCommentResponseSchema>;

export const toggleResponseSchema = z.object({ active: z.boolean(), count: z.number().int().nullable() });
export type ToggleResponse = z.infer<typeof toggleResponseSchema>;

export const blockEntrySchema = z.object({ id: z.string().uuid(), handle: z.string() });
export const communityMeSchema = z.object({
  guidelinesAccepted: z.boolean(),
  blocked: z.array(blockEntrySchema),
});
export type CommunityMe = z.infer<typeof communityMeSchema>;
export const blockResponseSchema = z.object({ block: blockEntrySchema });
export const okResponseSchema = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------- form validation (client)
export function validateTitle(value: string, copy: Dict = en): string | null {
  const n = value.trim().length;
  if (n < TITLE_MIN) return copy.community.titleMin(TITLE_MIN);
  if (n > TITLE_MAX) return copy.community.titleMax(TITLE_MAX);
  return null;
}
export function validateBody(value: string, copy: Dict = en): string | null {
  const n = value.trim().length;
  if (n < BODY_MIN) return copy.forms.minChars(BODY_MIN);
  if (n > BODY_MAX) return copy.forms.maxChars(BODY_MAX);
  return null;
}
export function validateComment(value: string, copy: Dict = en): string | null {
  const n = value.trim().length;
  if (n < COMMENT_MIN) return copy.forms.minChars(COMMENT_MIN);
  if (n > COMMENT_MAX) return copy.forms.maxChars(COMMENT_MAX);
  return null;
}
/** Splits "a, b #c" into valid, unique tags; returns the invalid ones too. */
export function parseTagInput(raw: string): { tags: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\s,]+/)
    .map(normalizeTag)
    .filter(Boolean);
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!isValidTag(p)) invalid.push(p);
    else if (!tags.includes(p)) tags.push(p);
  }
  return { tags, invalid };
}

export function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}
