// /api/v1/community/*: authorize first, strict body, rate limit, guidelines gate, Jev is advisory
// (a failure never blocks and content lands pending), no-store on personal responses, short public
// cache on the shared feed. The database is a mock that records the SQL it was asked to run.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import { feedResponseSchema, submitCommentResponseSchema, submitPostResponseSchema } from "@/domain/community/schemas";

const POST_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const REQ = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";

const state = vi.hoisted(() => ({
  user: { id: "user-1", name: "A", roles: ["commuter"] } as { id: string; name: string; roles: string[] } | null,
  autoPublish: false,
  acked: false,
  rateLimited: false,
  dbFail: null as null | { code: string },
  jev: "ok" as "ok" | "throws" | "reject",
  calls: [] as string[],
  sql: [] as string[],
}));

const text = (q: unknown): string => {
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "object" && c && "queryChunks" in c) return text(c);
      return typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?";
    })
    .join("");
};

vi.mock("@/server/auth/authorize", () => ({
  authorize: async () => {
    if (!state.user) throw Object.assign(new Error("Not allowed"), { name: "AuthorizationError", reason: "unauthenticated" });
    return state.user;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ AUTO_PUBLISH_ENABLED: state.autoPublish }) }));
vi.mock("@/server/adapters/jev/client", () => ({
  createJevClient: () => ({
    classify: async (input: { text: string }) => {
      state.calls.push(`jev:${input.text}`);
      if (state.jev === "throws") throw new Error("boom");
      if (state.jev === "reject") return { status: "ok", verdict: { recommendation: "reject", confidence: 0.99 } };
      return { status: "ok", verdict: { recommendation: "publish", confidence: 0.9 } };
    },
  }),
}));

const feedRow = {
  id: POST_ID, seq: "7", topic: "commute_tips", route_code: null, label: "community", helpful_count: 2,
  created_at: "2026-10-18T01:00:00Z", author_id: "other", author_handle: "Commuter AB12C", is_own: false,
  title: "Loop A before 7 am", body: "Easy to find a seat.", tags: ["loop-a"], moderation_status: "published",
  comment_count: 1, viewer_helpful: false, viewer_bookmarked: false, has_pending_edit: false,
};

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        state.sql.push(t);
        if (t.includes("ops.take_token")) {
          state.calls.push("rate");
          return { rows: [{ ok: !state.rateLimited }] };
        }
        if (t.includes("insert into core.ack")) {
          state.calls.push("ack-insert");
          return { rows: [] };
        }
        if (t.includes("from core.ack")) return { rows: state.acked ? [{ one: 1 }] : [] };
        if (t.includes("community.create_post") || t.includes("community.edit_post") || t.includes("community.create_comment")) {
          state.calls.push("write");
          if (state.dbFail) throw Object.assign(new Error("db"), state.dbFail);
          const status = "pending";
          if (t.includes("create_comment")) return { rows: [{ comment_id: POST_ID, status, depth: 1 }] };
          return { rows: [{ post_id: POST_ID, version_id: POST_ID, n: 2, status, is_live: false }] };
        }
        if (t.includes("community.toggle_reaction")) {
          if (state.dbFail) throw Object.assign(new Error("db"), state.dbFail);
          return { rows: [{ active: true, helpful_count: 3 }] };
        }
        if (t.includes("from community.post p")) return { rows: [feedRow] };
        return { rows: [] };
      },
    }),
}));

const { GET: FEED, POST: CREATE } = await import("@/app/api/v1/community/posts/route");
const { PATCH: EDIT } = await import("@/app/api/v1/community/posts/[id]/route");
const { POST: COMMENT } = await import("@/app/api/v1/community/posts/[id]/comments/route");
const { POST: REACT } = await import("@/app/api/v1/community/reactions/route");

const json = { "content-type": "application/json" };
const postBody = (over: Record<string, unknown> = {}) => ({
  clientRequestId: REQ, topic: "commute_tips", title: "Loop A before 7 am",
  body: "Easy to find a seat, call 0917 123 4567 to ask.", guidelinesAccepted: true, ...over,
});
const send = (fn: (r: Request, c: never) => Promise<Response>, url: string, body: unknown, method = "POST") =>
  fn(new Request(`http://localhost${url}`, { method, headers: json, body: JSON.stringify(body) }), { params: Promise.resolve({ id: POST_ID }) } as never);

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(apiErrorSchema.parse(await res.json()).error.code).toBe(code);
}

beforeEach(() => {
  state.user = { id: "user-1", name: "A", roles: ["commuter"] };
  state.autoPublish = false;
  state.acked = false;
  state.rateLimited = false;
  state.dbFail = null;
  state.jev = "ok";
  state.calls = [];
  state.sql = [];
});

describe("POST /api/v1/community/posts", () => {
  it("needs a session", async () => {
    state.user = null;
    await expectError(await send(CREATE, "/api/v1/community/posts", postBody()), 401, "unauthorized");
    expect(state.calls).toEqual([]);
  });
  it("rejects a bad body before any database work", async () => {
    await expectError(await send(CREATE, "/api/v1/community/posts", postBody({ title: "no" })), 400, "bad_request");
    await expectError(await send(CREATE, "/api/v1/community/posts", postBody({ extra: true })), 400, "bad_request");
    expect(state.calls).toEqual([]);
  });
  it("is rate limited", async () => {
    state.rateLimited = true;
    await expectError(await send(CREATE, "/api/v1/community/posts", postBody()), 429, "too_many_requests");
    expect(state.calls).not.toContain("write");
  });
  it("requires the guidelines the first time and records them", async () => {
    await expectError(await send(CREATE, "/api/v1/community/posts", postBody({ guidelinesAccepted: false })), 400, "bad_request");
    expect(state.calls).not.toContain("write");
    const res = await send(CREATE, "/api/v1/community/posts", postBody());
    expect(res.status).toBe(201);
    expect(state.calls).toContain("ack-insert");
  });
  it("lands pending, masked for Jev, with no-store", async () => {
    state.acked = true;
    const res = await send(CREATE, "/api/v1/community/posts", postBody({ guidelinesAccepted: false }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = submitPostResponseSchema.parse(await res.json());
    expect(body.post).toMatchObject({ state: "pending", visibleToOthers: false });
    const jev = state.calls.find((c) => c.startsWith("jev:")) ?? "";
    expect(jev).toContain("[number]");
    expect(jev).not.toContain("0917");
  });
  it("a Jev failure never blocks the submission", async () => {
    state.acked = true;
    state.jev = "throws";
    const res = await send(CREATE, "/api/v1/community/posts", postBody());
    expect(res.status).toBe(201);
    expect(state.calls).toContain("write");
  });
});

describe("edit, comment, reaction", () => {
  it("an edit is a new pending version and says the old one stays visible", async () => {
    state.acked = true;
    const { topic: _t, ...edit } = postBody();
    void _t;
    const res = await send(EDIT, `/api/v1/community/posts/${POST_ID}`, edit, "PATCH");
    expect(res.status).toBe(200);
    expect(submitPostResponseSchema.parse(await res.json()).post).toMatchObject({ isEdit: true, state: "pending", visibleToOthers: false });
    expect(state.sql.some((s) => s.includes("community.edit_post"))).toBe(true);
  });
  it("editing someone else's post is the same 404 as a missing one (no existence oracle)", async () => {
    state.acked = true;
    state.dbFail = { code: "42501" };
    const { topic: _t, ...edit } = postBody();
    void _t;
    await expectError(await send(EDIT, `/api/v1/community/posts/${POST_ID}`, edit, "PATCH"), 404, "not_found");
  });
  it("a reply to a reply (depth) is a 400 from the database", async () => {
    state.acked = true;
    state.dbFail = { code: "22023" };
    await expectError(
      await send(COMMENT, `/api/v1/community/posts/${POST_ID}/comments`, { clientRequestId: REQ, body: "Thanks!", parentCommentId: POST_ID }),
      400,
      "bad_request",
    );
  });
  it("a comment lands pending", async () => {
    state.acked = true;
    const res = await send(COMMENT, `/api/v1/community/posts/${POST_ID}/comments`, { clientRequestId: REQ, body: "Thanks!" });
    expect(res.status).toBe(201);
    expect(submitCommentResponseSchema.parse(await res.json()).comment.state).toBe("pending");
  });
  it("reacting to missing content is a 404; own content a 400", async () => {
    state.dbFail = { code: "P0002" };
    await expectError(await send(REACT, "/api/v1/community/reactions", { targetType: "post", targetId: POST_ID }), 404, "not_found");
    state.dbFail = { code: "22023" };
    await expectError(await send(REACT, "/api/v1/community/reactions", { targetType: "post", targetId: POST_ID }), 400, "bad_request");
  });
  it("toggles a reaction", async () => {
    const res = await send(REACT, "/api/v1/community/reactions", { targetType: "post", targetId: POST_ID });
    expect(await res.json()).toEqual({ active: true, count: 3 });
  });
});

describe("GET /api/v1/community/posts", () => {
  const get = (qs = "") => FEED(new Request(`http://localhost/api/v1/community/posts${qs}`));
  it("serves guests the shared feed with a short public cache and no block filter data", async () => {
    state.user = null;
    const res = await get("?topic=commute_tips");
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30");
    const body = feedResponseSchema.parse(await res.json());
    expect(body.posts[0]?.title).toBe("Loop A before 7 am");
    expect(body.nextCursor).toBeNull();
  });
  it("shows only published posts and hides blocked authors in the query", async () => {
    await get("?me=1");
    const q = state.sql.find((s) => s.includes("from community.post p")) ?? "";
    expect(q).toContain("p.published_version_id is not null");
    expect(q).toContain("community.user_block");
  });
  it("is private for ?me=1 and for personal scopes", async () => {
    expect((await get("?me=1")).headers.get("cache-control")).toBe("no-store");
    expect((await get("?scope=mine")).headers.get("cache-control")).toBe("no-store");
  });
  it("personal scopes need a session; a bad filter is a 400", async () => {
    state.user = null;
    await expectError(await get("?scope=saved"), 401, "unauthorized");
    await expectError(await get("?topic=nope"), 400, "bad_request");
  });
});
