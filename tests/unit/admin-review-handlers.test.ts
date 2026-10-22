// /api/v1/admin/{corrections,moderation,media} (N6): the role guard (404 before any database call
// for every role without the action), strict bodies, the definer function each action calls, an
// accept that makes its stop edit first in the same transaction, the refusal → HTTP mapping, the
// photo copy to the public bucket (and its removal when the transaction fails), and the private
// photo stream with its headers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { correctionQueueSchema, reviewResultSchema } from "@/domain/admin/corrections";
import { decisionResultSchema, moderationQueueSchema } from "@/domain/admin/moderation";
import { apiErrorSchema } from "@/domain/api/schemas";

const C1 = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const C2 = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const STOP = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a03";
const VER = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a04";
const NEW_VER = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a05";
const DRAFT = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a06";
const PHOTO = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a07";
const MEDIA = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a08";
const DECISION = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a09";
const APPEAL = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a0a";
const KEY = `community_photo/${MEDIA}.jpeg`;

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  calls: [] as string[],
  params: new Map<string, unknown[]>(),
  fail: null as { code: string; message: string } | null,
  commitFail: false,
  copy: true,
  storage: [] as string[],
  photoCopy: null as unknown,
  media: null as { bucket: string; object_key: string; mime: string } | null,
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const flat = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).flatMap((c) =>
    typeof c === "object" && c && "value" in c ? [] : typeof c === "object" && c && "queryChunks" in c ? flat(c) : [c],
  );

vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));

const QUEUE = {
  draft: { id: DRAFT, label: "draft-x" },
  corrections: [
    {
      id: C1, kind: "stop_moved_removed", entityType: "stop", entityId: STOP, entityLabel: "Plaza Rizal", entityRevisionId: null,
      description: "The stop is now across the street.", status: "under_review", submittedAt: "2026-10-22 10:00:00.5+08",
      updatedAt: "2026-10-22 10:00:00.5+08", moderationReason: "auto_publish_disabled", reviewerNote: null, duplicateOf: null,
      draftRevisionId: null, draftChange: null, incorporatedRevisionId: null, reviewedAt: null,
      location: { lat: 13.6234, lng: 123.1847, accuracyM: 8 }, media: [{ id: MEDIA, mime: "image/jpeg" }],
      events: [{ from: "draft", to: "submitted", at: "2026-10-22 10:00:00.5+08", actorRole: "commuter", reasonCode: "auto_publish_disabled", note: null }],
      similar: [{ id: C2, kind: "stop_moved_removed", status: "submitted", submittedAt: "2026-10-22 11:00:00+08" }],
      stop: { stopPointId: STOP, name: "Plaza Rizal", versionId: VER, status: "candidate", inDraft: true, changedInDraft: false, lat: 13.6233, lng: 123.1846 },
      fares: null,
    },
  ],
};

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const out = await fn({
      execute: async (q: unknown) => {
        const key = text(q).match(/ops\.take_token|(?:transit|ingest|community|core)\.admin_\w+/)?.[0] ?? "other";
        state.calls.push(key);
        state.params.set(key, flat(q));
        if (key === "ops.take_token") return { rows: [{ ok: true }] };
        if (state.fail) throw Object.assign(new Error("Failed query"), { cause: state.fail });
        switch (key) {
          case "community.admin_corrections":
            return { rows: [{ d: QUEUE }] };
          case "community.admin_review_correction":
            return { rows: [{ r: { id: C1, status: "accepted", draftRevisionId: DRAFT, draftChange: { kind: "draft_version", entityKind: "stop_point", entityId: STOP, versionId: NEW_VER } } }] };
          case "community.admin_moderation_queue":
            return { rows: [{ d: { items: [], appeals: [], history: [] } }] };
          case "community.admin_moderate":
          case "community.admin_resolve_appeal":
            return { rows: [{ r: { decisionId: DECISION, isOverride: false, copy: state.photoCopy } }] };
          case "core.admin_review_media":
            return { rows: state.media ? [state.media] : [] };
          default:
            if (key.startsWith("transit.admin_")) return { rows: [{ v: NEW_VER }] };
            return { rows: [] };
        }
      },
    });
    if (state.commitFail) throw new Error("commit failed");
    return out;
  },
}));

vi.mock("@/server/storage/adapter", () => ({
  getStorage: () => ({
    copyObject: async (sb: string, sk: string, db: string, dk: string) => {
      state.storage.push(`copy ${sb}/${sk} -> ${db}/${dk}`);
      return state.copy;
    },
    deleteObject: async (b: string, k: string) => {
      state.storage.push(`delete ${b}/${k}`);
      return true;
    },
    getObject: async (b: string, k: string) => {
      state.storage.push(`get ${b}/${k}`);
      return new Uint8Array([0xff, 0xd8, 0xff]);
    },
  }),
}));

const h = await import("@/server/admin/review-handlers");

const post = (url: string, body: unknown = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const idParams = (id: string) => Promise.resolve({ id });
const problem = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
const db = () => state.calls.filter((c) => c !== "ops.take_token" && c !== "other");

const ADMIN = { id: "u-admin", name: "A", roles: ["commuter", "admin"] };
const REVIEWER = { id: "u-rev", name: "R", roles: ["commuter", "transport_reviewer"] };
const MODERATOR = { id: "u-mod", name: "M", roles: ["commuter", "community_moderator"] };
const COMMUTER = { id: "u-c", name: "C", roles: ["commuter"] };
const COMPLAINTS = { id: "u-k", name: "K", roles: ["commuter", "complaint_reviewer"] };
const SUSPENDED = { id: "u-s", name: "S", roles: [] };

beforeEach(() => {
  state.user = null;
  state.calls = [];
  state.params.clear();
  state.fail = null;
  state.commitFail = false;
  state.copy = true;
  state.storage = [];
  state.photoCopy = null;
  state.media = null;
});

describe("role guard", () => {
  it("corrections: 404 before any database call for everyone but transport reviewers and admins", async () => {
    for (const user of [null, COMMUTER, MODERATOR, COMPLAINTS, SUSPENDED]) {
      state.user = user;
      for (const res of [
        await h.getCorrections(get("/api/v1/admin/corrections")),
        await h.postCorrectionReview(post(`/api/v1/admin/corrections/${C1}`, { action: "start_review", expectedStatus: "submitted" }), idParams(C1)),
      ]) {
        expect(res.status, JSON.stringify(user)).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
    expect(db()).toEqual([]);
  });

  it("moderation: 404 before any database call for everyone but community moderators and admins", async () => {
    for (const user of [null, COMMUTER, REVIEWER, COMPLAINTS, SUSPENDED]) {
      state.user = user;
      for (const res of [
        await h.getModeration(get("/api/v1/admin/moderation")),
        await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", { targetType: "comment", targetId: C1, outcome: "published", reason: "meets_guidelines" })),
        await h.postAppealResolution(post(`/api/v1/admin/moderation/appeals/${APPEAL}`, { outcome: "upheld", note: "Still a threat." }), idParams(APPEAL)),
      ]) {
        expect(res.status, JSON.stringify(user)).toBe(404);
      }
    }
    expect(db()).toEqual([]);
  });

  it("media: guests, commuters and complaint reviewers get 404 without a database call; staff ask the database", async () => {
    for (const user of [null, COMMUTER, COMPLAINTS]) {
      state.user = user;
      expect((await h.getReviewMedia(get(`/api/v1/admin/media/${MEDIA}`), idParams(MEDIA))).status).toBe(404);
    }
    expect(db()).toEqual([]);
  });
});

describe("corrections review (C9)", () => {
  it("lists the queue, private, with ISO times", async () => {
    state.user = REVIEWER;
    const res = await h.getCorrections(get("/api/v1/admin/corrections?scope=open"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = correctionQueueSchema.parse(await res.json());
    expect(body.corrections[0]!.submittedAt).toBe("2026-10-22T02:00:00.500Z");
    expect(body.corrections[0]!.events[0]!.at).toBe("2026-10-22T02:00:00.500Z");
    expect(state.params.get("community.admin_corrections")).toEqual(["open"]);
    expect((await h.getCorrections(get("/api/v1/admin/corrections?scope=all"))).status).toBe(400);
  });

  it("each action passes the page's status and only the fields it takes", async () => {
    state.user = REVIEWER;
    const cases: [unknown, unknown[]][] = [
      [{ action: "start_review", expectedStatus: "submitted" }, [C1, "submitted", "start_review", null, null, null, null, null]],
      [{ action: "request_info", expectedStatus: "under_review", reason: "need_photo", note: "Sign photo please" }, [C1, "under_review", "request_info", "need_photo", "Sign photo please", null, null, null]],
      [{ action: "reject", expectedStatus: "submitted", reason: "already_correct" }, [C1, "submitted", "reject", "already_correct", null, null, null, null]],
      [{ action: "duplicate", expectedStatus: "submitted", duplicateOf: C2 }, [C1, "submitted", "duplicate", null, null, C2, null, null]],
      [{ action: "accept", expectedStatus: "under_review", change: { kind: "proposal" }, note: "Change R4 base fare", fareRuleVersionId: C2 }, [C1, "under_review", "accept", null, "Change R4 base fare", null, null, C2]],
      [{ action: "accept", expectedStatus: "under_review", change: { kind: "draft_version", versionId: NEW_VER } }, [C1, "under_review", "accept", null, null, null, NEW_VER, null]],
    ];
    for (const [body, args] of cases) {
      state.calls = [];
      const res = await h.postCorrectionReview(post(`/api/v1/admin/corrections/${C1}`, body), idParams(C1));
      expect(res.status, JSON.stringify(body)).toBe(200);
      reviewResultSchema.parse(await res.json());
      expect(db()).toEqual(["community.admin_review_correction"]);
      expect(state.params.get("community.admin_review_correction")).toEqual(args);
    }
  });

  it("an accept with a stop action makes the stop edit first, in the same transaction, then records its version", async () => {
    state.user = REVIEWER;
    const res = await h.postCorrectionReview(
      post(`/api/v1/admin/corrections/${C1}`, {
        action: "accept",
        expectedStatus: "under_review",
        change: { kind: "stop_action", stopPointId: STOP, stopAction: { action: "relocate", expectedVersionId: VER, lat: 13.6234, lng: 123.1847, reason: "Commuter correction" } },
      }),
      idParams(C1),
    );
    expect(res.status).toBe(200);
    expect(db()).toEqual(["transit.admin_relocate_stop", "community.admin_review_correction"]);
    expect(state.params.get("transit.admin_relocate_stop")).toEqual([STOP, VER, 13.6234, 123.1847, "Commuter correction"]);
    expect(state.params.get("community.admin_review_correction")![6]).toBe(NEW_VER);
  });

  it("400 on a bad body without a database call: proposal without a note, unknown reason, extra field", async () => {
    state.user = ADMIN;
    for (const body of [
      { action: "accept", expectedStatus: "under_review", change: { kind: "proposal" } },
      { action: "reject", expectedStatus: "submitted", reason: "spam" },
      { action: "start_review", expectedStatus: "submitted", extra: true },
      { action: "accept", expectedStatus: "under_review", change: { kind: "draft_version", versionId: "x" } },
    ]) {
      expect((await h.postCorrectionReview(post(`/api/v1/admin/corrections/${C1}`, body), idParams(C1))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await h.postCorrectionReview(post("/api/v1/admin/corrections/x", {}), idParams("x"))).status).toBe(404);
    expect(db()).toEqual([]);
  });

  it("maps the database's refusals: own report 403, stale page 409, unknown 404, role 404", async () => {
    state.user = REVIEWER;
    const body = { action: "start_review", expectedStatus: "submitted" };
    const cases: [{ code: string; message: string }, number, string | null][] = [
      [{ code: "42501", message: "you cannot review your own report" }, 403, "You cannot review your own report."],
      [{ code: "55000", message: "this report changed since the page was loaded; reload and try again" }, 409, null],
      [{ code: "22023", message: "unknown correction" }, 404, "No such report."],
      [{ code: "42501", message: "forbidden" }, 404, null],
      [{ code: "55000", message: "no draft revision is open; create one under Revisions first" }, 409, null],
    ];
    for (const [fail, status, message] of cases) {
      state.fail = fail;
      const res = await h.postCorrectionReview(post(`/api/v1/admin/corrections/${C1}`, body), idParams(C1));
      expect(res.status, fail.message).toBe(status);
      if (message) expect((await problem(res)).message).toBe(message);
    }
  });
});

describe("moderation (C10)", () => {
  it("reads the queue", async () => {
    state.user = MODERATOR;
    const res = await h.getModeration(get("/api/v1/admin/moderation"));
    expect(res.status).toBe(200);
    moderationQueueSchema.parse(await res.json());
  });

  it("a text decision passes no bucket and copies nothing", async () => {
    state.user = MODERATOR;
    const res = await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", { targetType: "post_version", targetId: C1, outcome: "rejected", reason: "threat" }));
    expect(res.status).toBe(200);
    expect(decisionResultSchema.parse(await res.json())).toEqual({ decisionId: DECISION, isOverride: false });
    expect(state.params.get("community.admin_moderate")).toEqual(["post_version", C1, "rejected", "threat", null, null]);
    expect(state.storage).toEqual([]);
  });

  it("approving a photo passes the public bucket and copies the private object there before the commit", async () => {
    state.user = MODERATOR;
    state.photoCopy = { sourceBucket: "evidence-private", key: KEY, mime: "image/jpeg", publicBucket: "public-media" };
    const res = await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", { targetType: "photo", targetId: PHOTO, outcome: "published", reason: "meets_guidelines" }));
    expect(res.status).toBe(200);
    expect(state.params.get("community.admin_moderate")).toEqual(["photo", PHOTO, "published", "meets_guidelines", null, "public-media"]);
    expect(state.storage).toEqual([`copy evidence-private/${KEY} -> public-media/${KEY}`]);
  });

  it("a failed copy answers 503 (the transaction rolls back); a failed commit removes the public copy again", async () => {
    state.user = MODERATOR;
    state.photoCopy = { sourceBucket: "evidence-private", key: KEY, mime: "image/jpeg", publicBucket: "public-media" };
    state.copy = false;
    const body = { targetType: "photo", targetId: PHOTO, outcome: "published", reason: "meets_guidelines" };
    expect((await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", body))).status).toBe(503);
    expect(state.storage.filter((s) => s.startsWith("delete"))).toEqual([]);
    state.copy = true;
    state.commitFail = true;
    state.storage = [];
    expect((await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", body))).status).toBe(500);
    expect(state.storage).toEqual([`copy evidence-private/${KEY} -> public-media/${KEY}`, `delete public-media/${KEY}`]);
  });

  it("rejecting a photo copies nothing and passes no bucket", async () => {
    state.user = ADMIN;
    const res = await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", { targetType: "photo", targetId: PHOTO, outcome: "rejected", reason: "unsafe_photo" }));
    expect(res.status).toBe(200);
    expect(state.params.get("community.admin_moderate")![5]).toBeNull();
    expect(state.storage).toEqual([]);
  });

  it("400 without a database call: reason that does not fit, other without a note, unknown type", async () => {
    state.user = MODERATOR;
    for (const body of [
      { targetType: "comment", targetId: C1, outcome: "published", reason: "spam" },
      { targetType: "comment", targetId: C1, outcome: "rejected", reason: "meets_guidelines" },
      { targetType: "comment", targetId: C1, outcome: "rejected", reason: "other" },
      { targetType: "post", targetId: C1, outcome: "rejected", reason: "spam" },
    ]) {
      expect((await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(db()).toEqual([]);
  });

  it("maps refusals: own content 403, already decided 409, override without a note 400", async () => {
    state.user = MODERATOR;
    const body = { targetType: "comment", targetId: C1, outcome: "rejected", reason: "spam" };
    for (const [fail, status] of [
      [{ code: "42501", message: "you cannot moderate your own content" }, 403],
      [{ code: "55000", message: "this item was already decided; reload" }, 409],
      [{ code: "22023", message: "going against Jev's recommendation needs a note" }, 400],
    ] as const) {
      state.fail = fail;
      expect((await h.postModerationDecision(post("/api/v1/admin/moderation/decisions", body))).status, fail.message).toBe(status);
    }
  });

  it("appeals: a note is required; the original decider gets 403 from the database", async () => {
    state.user = MODERATOR;
    expect((await h.postAppealResolution(post(`/api/v1/admin/moderation/appeals/${APPEAL}`, { outcome: "overturned" }), idParams(APPEAL))).status).toBe(400);
    expect(db()).toEqual([]);
    const ok = await h.postAppealResolution(post(`/api/v1/admin/moderation/appeals/${APPEAL}`, { outcome: "overturned", note: "Criticism, not a threat." }), idParams(APPEAL));
    expect(ok.status).toBe(200);
    expect(state.params.get("community.admin_resolve_appeal")).toEqual([APPEAL, "overturned", "Criticism, not a threat.", "public-media"]);
    state.fail = { code: "42501", message: "a different moderator must decide this appeal" };
    const res = await h.postAppealResolution(post(`/api/v1/admin/moderation/appeals/${APPEAL}`, { outcome: "upheld", note: "Mine." }), idParams(APPEAL));
    expect(res.status).toBe(403);
    expect((await problem(res)).message).toBe("A different moderator must decide this appeal.");
  });
});

describe("private photos for reviewers", () => {
  it("streams an image the database allowed, never cached, sniff-proof and sandboxed", async () => {
    state.user = REVIEWER;
    state.media = { bucket: "evidence-private", object_key: KEY, mime: "image/jpeg" };
    const res = await h.getReviewMedia(get(`/api/v1/admin/media/${MEDIA}`), idParams(MEDIA));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(state.storage).toEqual([`get evidence-private/${KEY}`]);
  });

  it("404 when the database refuses or the object is not an image", async () => {
    state.user = MODERATOR;
    state.fail = { code: "42501", message: "forbidden" };
    expect((await h.getReviewMedia(get(`/api/v1/admin/media/${MEDIA}`), idParams(MEDIA))).status).toBe(404);
    state.fail = null;
    state.media = { bucket: "evidence-private", object_key: "x.svg", mime: "image/svg+xml" };
    expect((await h.getReviewMedia(get(`/api/v1/admin/media/${MEDIA}`), idParams(MEDIA))).status).toBe(404);
    expect(state.storage).toEqual([]);
  });
});
