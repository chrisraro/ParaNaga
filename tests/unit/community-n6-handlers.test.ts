// Commuter side of N6 (C10): a new post's photos are attached in the same transaction and wait
// for a moderator; Jev's typed answer is stored next to the content inside a savepoint (a failure
// there never undoes the post); appeals (once per item, 409 on a repeat); approved photos are read
// from the public bucket only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appealResponseSchema, submitPostResponseSchema } from "@/domain/community/schemas";

const POST = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const VERSION = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const PHOTO = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a03";
const M1 = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a04";
const REQ = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a05";

const state = vi.hoisted(() => ({
  user: { id: "user-1", name: "A", roles: ["commuter"] } as { id: string; name: string; roles: string[] } | null,
  sql: [] as string[],
  evidenceFail: false,
  appealFail: null as null | { code: string },
  photoRow: null as null | { public_bucket: string; public_key: string },
  storage: [] as string[],
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "queryChunks" in c ? text(c) : typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");

vi.mock("@/server/auth/authorize", () => ({
  authorize: async () => {
    if (!state.user) throw Object.assign(new Error("Not allowed"), { name: "AuthorizationError", reason: "unauthenticated" });
    return state.user;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ AUTO_PUBLISH_ENABLED: false, JEV_POLICY_VERSION: "paranaga-community-v1", JEV_MODEL_ID: "typesafe/jev-1.13-20260917", STORAGE_BUCKET_PUBLIC: "public-media" }),
}));
vi.mock("@/server/adapters/jev/client", () => ({
  createJevClient: () => ({ classify: async () => ({ status: "ok", verdict: { recommendation: "human_review", confidence: 0.6 } }) }),
}));
vi.mock("@/server/storage/adapter", () => ({
  getStorage: () => ({
    headObject: async (b: string, k: string) => (state.storage.push(`head ${b}/${k}`), { bytes: 3, mime: "image/jpeg" }),
    getObject: async (b: string, k: string) => (state.storage.push(`get ${b}/${k}`), new Uint8Array([0xff, 0xd8, 0xff])),
  }),
}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        state.sql.push(t);
        if (t.includes("ops.take_token")) return { rows: [{ ok: true }] };
        if (t.includes("from core.ack")) return { rows: [{ one: 1 }] };
        if (t.includes("community.create_post")) return { rows: [{ post_id: POST, version_id: VERSION, status: "pending" }] };
        if (t.includes("community.record_jev_evidence") && state.evidenceFail) throw Object.assign(new Error("db"), { code: "23514" });
        if (t.includes("community.submit_appeal")) {
          if (state.appealFail) throw Object.assign(new Error("db"), state.appealFail);
          return { rows: [{ id: REQ }] };
        }
        if (t.includes("from community.post_photo")) return { rows: state.photoRow ? [state.photoRow] : [] };
        return { rows: [] };
      },
    }),
}));

const h = await import("@/server/community/handlers");

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const newPost = (extra: object = {}) => ({ clientRequestId: REQ, topic: "commute_tips", title: "Loop X at dawn", body: "Seats are easy to find before six.", ...extra });

beforeEach(() => {
  state.user = { id: "user-1", name: "A", roles: ["commuter"] };
  state.sql = [];
  state.evidenceFail = false;
  state.appealFail = null;
  state.photoRow = null;
  state.storage = [];
});

describe("new post with photos and Jev evidence", () => {
  it("records Jev's answer in a savepoint, then attaches the photos, in the post's transaction", async () => {
    const res = await h.createPost(post("/api/v1/community/posts", newPost({ photoIds: [M1] })));
    expect(res.status).toBe(201);
    expect(submitPostResponseSchema.parse(await res.json()).post.state).toBe("pending");
    const order = ["community.create_post", "savepoint jev_evidence", "community.record_jev_evidence", "release savepoint jev_evidence", "community.add_post_photos"];
    const at = order.map((s) => state.sql.findIndex((q) => q.includes(s)));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("a failure storing the evidence rolls back to the savepoint and the post still saves", async () => {
    state.evidenceFail = true;
    const res = await h.createPost(post("/api/v1/community/posts", newPost()));
    expect(res.status).toBe(201);
    expect(state.sql.some((q) => q.includes("rollback to savepoint jev_evidence"))).toBe(true);
    expect(state.sql.some((q) => q.includes("community.add_post_photos"))).toBe(false);
  });

  it("refuses more than three photos or a bad id before any write", async () => {
    for (const photoIds of [[M1, M1, M1, M1], ["not-a-uuid"]]) {
      state.sql = [];
      expect((await h.createPost(post("/api/v1/community/posts", newPost({ photoIds })))).status).toBe(400);
      expect(state.sql.some((q) => q.includes("community.create_post"))).toBe(false);
    }
  });
});

describe("appeals", () => {
  const body = { targetType: "post_version", targetId: VERSION, note: "It is criticism of the service, not abuse." };

  it("201 with the appeal; guests 401; a short note 400 without a database call", async () => {
    const res = await h.submitAppeal(post("/api/v1/community/appeals", body));
    expect(res.status).toBe(201);
    expect(appealResponseSchema.parse(await res.json()).appeal).toEqual({ id: REQ, state: "open" });
    state.user = null;
    expect((await h.submitAppeal(post("/api/v1/community/appeals", body))).status).toBe(401);
    state.user = { id: "user-1", name: "A", roles: ["commuter"] };
    state.sql = [];
    expect((await h.submitAppeal(post("/api/v1/community/appeals", { ...body, note: "no" }))).status).toBe(400);
    expect(state.sql).toEqual([]);
  });

  it("maps the database: already appealed 409, not rejected 400, not yours 404", async () => {
    for (const [code, status] of [["23505", 409], ["22023", 400], ["P0002", 404]] as const) {
      state.appealFail = { code };
      expect((await h.submitAppeal(post("/api/v1/community/appeals", body))).status, code).toBe(status);
    }
  });
});

describe("approved photos", () => {
  it("served from the public bucket only, with a short public cache", async () => {
    state.photoRow = { public_bucket: "public-media", public_key: `community_photo/${M1}.jpeg` };
    const res = await h.getPhoto(new Request(`http://localhost/api/v1/community/photos/${PHOTO}`), PHOTO);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(state.storage.every((s) => s.includes("public-media/"))).toBe(true);
    expect(state.sql.some((q) => q.includes("ph.moderation_status = 'published'"))).toBe(true);
  });

  it("404 for a pending photo, another bucket or a bad id, without touching storage", async () => {
    expect((await h.getPhoto(new Request("http://localhost/x"), PHOTO)).status).toBe(404);
    state.photoRow = { public_bucket: "evidence-private", public_key: "x.jpeg" };
    expect((await h.getPhoto(new Request("http://localhost/x"), PHOTO)).status).toBe(404);
    expect((await h.getPhoto(new Request("http://localhost/x"), "nope")).status).toBe(404);
    expect(state.storage).toEqual([]);
  });
});
