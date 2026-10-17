import { describe, expect, it } from "vitest";
import {
  blockPayloadSchema,
  createCommentPayloadSchema,
  createPostPayloadSchema,
  editPostPayloadSchema,
  excerptOf,
  feedQuerySchema,
  parseTagInput,
  reportPayloadSchema,
  validateBody,
  validateComment,
  validateTitle,
} from "@/domain/community/schemas";
import { contentState, stateLabel } from "@/domain/community/status";
import { COMMUNITY_TOPICS, isTopic, topicLabel } from "@/domain/community/topics";
import { hideBlocked, nestComments, replyDepth, type ThreadRow } from "@/domain/community/thread";
import { applyEdit, authorVersion, awaitingEdit, liveVersion, type PostVersions } from "@/domain/community/versions";

const ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";
const post = (over: Record<string, unknown> = {}) => ({
  clientRequestId: ID,
  topic: "commute_tips",
  title: "Loop A before 7 am",
  body: "It is much easier to find a seat before 7 am on weekdays.",
  ...over,
});

describe("topics", () => {
  it("lists the three hub topics", () => {
    expect(COMMUNITY_TOPICS.map((t) => t.label)).toEqual(["Commute tips", "First-time questions", "Route/stop feedback"]);
    expect(isTopic("first_time")).toBe(true);
    expect(isTopic("memes")).toBe(false);
    expect(topicLabel("route_stop_feedback")).toBe("Route/stop feedback");
  });
});

describe("post and comment schemas", () => {
  it("accepts a valid post and defaults tags and the guidelines flag", () => {
    const r = createPostPayloadSchema.parse(post());
    expect(r.tags).toEqual([]);
    expect(r.guidelinesAccepted).toBe(false);
  });
  it("normalises, de-duplicates and limits tags", () => {
    expect(createPostPayloadSchema.parse(post({ tags: ["#Fares", "fares", " loop-a "] })).tags).toEqual(["fares", "loop-a"]);
    expect(createPostPayloadSchema.safeParse(post({ tags: ["a1", "b2", "c3", "d4"] })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ tags: ["bad tag"] })).success).toBe(false);
  });
  it("is strict and bounded", () => {
    expect(createPostPayloadSchema.safeParse(post({ extra: 1 })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ topic: "other" })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ title: "abc" })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ body: "x".repeat(2001) })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ body: "bad\u0007text here" })).success).toBe(false);
    expect(createPostPayloadSchema.safeParse(post({ routeCode: "R8-A" })).success).toBe(true);
    expect(createPostPayloadSchema.safeParse(post({ routeCode: "R 8" })).success).toBe(false);
  });
  it("edit has no topic; comment has a short body and an optional parent", () => {
    const { topic: _t, ...rest } = post();
    void _t;
    expect(editPostPayloadSchema.safeParse(rest).success).toBe(true);
    expect(editPostPayloadSchema.safeParse(post()).success).toBe(false);
    expect(createCommentPayloadSchema.safeParse({ clientRequestId: ID, body: "Thanks" }).success).toBe(true);
    expect(createCommentPayloadSchema.safeParse({ clientRequestId: ID, body: "x" }).success).toBe(false);
    expect(createCommentPayloadSchema.safeParse({ clientRequestId: ID, body: "Thanks", parentCommentId: "nope" }).success).toBe(false);
  });
  it("block and report bodies are strict", () => {
    expect(blockPayloadSchema.safeParse({ targetType: "post", targetId: ID }).success).toBe(true);
    expect(blockPayloadSchema.safeParse({ targetType: "user", targetId: ID }).success).toBe(false);
    expect(reportPayloadSchema.safeParse({ targetType: "comment", targetId: ID, reason: "spam" }).success).toBe(true);
    expect(reportPayloadSchema.safeParse({ targetType: "comment", targetId: ID, reason: "dislike" }).success).toBe(false);
  });
  it("feed query: defaults, bounds, cursor", () => {
    expect(feedQuerySchema.parse({}).scope).toBe("all");
    expect(feedQuerySchema.parse({ cursor: "42", topic: "first_time", q: " fares " })).toMatchObject({ cursor: 42, q: "fares" });
    expect(feedQuerySchema.safeParse({ q: "a" }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ topic: "nope" }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ scope: "everything" }).success).toBe(false);
  });
  it("form validators and helpers", () => {
    expect(validateTitle("abc")).not.toBeNull();
    expect(validateTitle("A good title")).toBeNull();
    expect(validateBody("short")).not.toBeNull();
    expect(validateComment("ok")).toBeNull();
    expect(parseTagInput("Fares, #loop-a  fares x")).toEqual({ tags: ["fares", "loop-a"], invalid: ["x"] });
    expect(excerptOf("a ".repeat(200)).length).toBeLessThanOrEqual(180);
  });
});

describe("status labels", () => {
  it("shows pending honestly", () => {
    expect(stateLabel(contentState("pending"))).toBe("Awaiting review");
    expect(stateLabel(contentState("human_review"))).toBe("Awaiting review");
    expect(stateLabel(contentState("rejected"))).toBe("Not published");
    expect(stateLabel(contentState("published"))).toBe("Published");
  });
});

const row = (id: string, parentId: string | null, depth: number, authorId: string): ThreadRow => ({ id, parentId, depth, authorId });

describe("comment nesting rule", () => {
  it("allows a reply to a top-level comment but not to a reply", () => {
    expect(replyDepth(null)).toBe(1);
    expect(replyDepth(1)).toBe(2);
    expect(replyDepth(2)).toBeNull();
  });
  it("builds two levels and drops a third or an orphan", () => {
    const tree = nestComments([
      row("a", null, 1, "u1"),
      row("b", "a", 2, "u2"),
      row("c", "b", 2, "u3"), // depth 2 under a depth-2 parent: dropped
      row("d", "zzz", 2, "u4"), // parent not visible: dropped
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.replies.map((r) => r.id)).toEqual(["b"]);
    expect(tree[0]?.replies[0]?.replies).toEqual([]);
  });
});

describe("block filtering", () => {
  const rows = [row("a", null, 1, "bad"), row("b", "a", 2, "ok"), row("c", null, 1, "ok"), row("d", "c", 2, "bad"), row("e", null, 1, "me")];
  it("hides a blocked author and everything under their comment", () => {
    expect(hideBlocked(rows, new Set(["bad"]), "me").map((r) => r.id)).toEqual(["c", "e"]);
  });
  it("leaves everything when nothing is blocked, and never hides the viewer's own rows", () => {
    expect(hideBlocked(rows, new Set(), null)).toHaveLength(5);
    expect(hideBlocked(rows, new Set(["me"]), "me").map((r) => r.id)).toContain("e");
  });
});

describe("edit-version rule", () => {
  const published: PostVersions = { versions: [{ n: 1, status: "published" }], publishedN: 1 };
  it("an edit is pending and the published version stays live", () => {
    const after = applyEdit(published, "pending");
    expect(after.versions).toEqual([{ n: 1, status: "published" }, { n: 2, status: "pending" }]);
    expect(liveVersion(after)?.n).toBe(1);
    expect(awaitingEdit(after)?.n).toBe(2);
  });
  it("a newer edit supersedes the older unreviewed one", () => {
    const after = applyEdit(applyEdit(published, "pending"), "pending");
    expect(after.versions.map((v) => v.status)).toEqual(["published", "superseded", "pending"]);
    expect(awaitingEdit(after)?.n).toBe(3);
  });
  it("an auto-published edit replaces the live version", () => {
    const after = applyEdit(published, "published");
    expect(liveVersion(after)?.n).toBe(2);
    expect(after.versions[0]?.status).toBe("superseded");
  });
  it("the author reads the live version, or the latest while nothing is live", () => {
    expect(authorVersion(applyEdit(published, "pending"))?.n).toBe(1);
    const first: PostVersions = { versions: [{ n: 1, status: "pending" }], publishedN: null };
    expect(liveVersion(first)).toBeNull();
    expect(authorVersion(first)?.n).toBe(1);
  });
});
