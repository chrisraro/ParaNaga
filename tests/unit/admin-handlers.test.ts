// /api/v1/admin/** (N5a): the role guard (404 for everyone but admin and transport reviewer), the
// step-up gate before publish/rollback (applied first in the same transaction), the order of the
// validation calls, the database refusal → HTTP mapping, strict bodies and private headers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDashboardSchema, publishResultSchema, validationReportSchema } from "@/domain/admin/schemas";
import { apiErrorSchema } from "@/domain/api/schemas";

const REV = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const PUB = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  stepUpAt: null as Date | null,
  authAt: new Date() as Date | null,
  calls: [] as string[],
  params: new Map<string, unknown[]>(),
  publishFail: null as { code: string; message: string } | null,
  facts: null as unknown,
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const params = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => !(typeof c === "object" && c && "value" in c));

vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => state.user,
  getAuthSession: async () => (state.user ? { userId: state.user.id, sessionId: "sess-1", email: "a@example.com", authenticatedAt: state.authAt } : null),
}));
vi.mock("@/server/repos/network-repo", () => ({
  getPublishedRevision: async () => ({ revisionId: REV, label: "draft-x", kind: "provisional", publishedAt: "2026-10-22T02:00:00.000Z" }),
}));

const FACTS = {
  revision: { id: REV, label: "draft-x", kind: "provisional", status: "draft", isSynthetic: false },
  membershipHash: "b".repeat(64),
  dbCheck: { ok: true },
  members: [{ kind: "route", code: "FX-1", isSynthetic: true }],
  stops: [],
  terminals: [],
  variants: [],
  routeStops: [],
  shapes: [],
};

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        const key = t.match(/ops\.take_token|core\.step_up_apply|app\.step_up_at|transit\.admin_\w+/)?.[0] ?? "other";
        state.calls.push(key);
        state.params.set(key, params(q));
        switch (key) {
          case "ops.take_token":
            return { rows: [{ ok: true }] };
          case "core.step_up_apply":
            return { rows: [{ at: state.stepUpAt }] };
          case "transit.admin_dashboard":
            return {
              rows: [{ d: { published: { id: PUB, seq: 3, label: "modes-lines", kind: "provisional", publishedAt: "2026-10-16 08:00:00.5+00" }, drafts: 0, latestDraft: null, stopsTotal: 128, stopCandidates: 128, openCorrections: 2, lastImport: null } }],
            };
          case "transit.admin_validation_facts":
            return { rows: [{ f: state.facts ?? FACTS }] };
          case "transit.admin_record_validation":
            return { rows: [{ at: "2026-10-22 10:00:00.123456+08" }] };
          case "transit.admin_publish_revision":
            if (state.publishFail) throw Object.assign(new Error("Failed query"), { cause: state.publishFail });
            return { rows: [{ p: { revisionId: REV, previousRevisionId: PUB, mode: "publish" } }] };
          default:
            return { rows: [] };
        }
      },
    }),
}));

const { getDashboard, getRevisions, postPublish, postRollback, postValidate, postDraft, adminProblem } = await import("@/server/admin/handlers");

const post = (url: string, body: unknown = {}, type = "application/json") =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const idParams = (id = REV) => Promise.resolve({ id });
const errorCode = async (res: Response) => apiErrorSchema.parse(await res.json()).error.code;

const STAFF = [
  { id: "u-admin", name: "A", roles: ["commuter", "admin"] },
  { id: "u-rev", name: "R", roles: ["commuter", "transport_reviewer"] },
];
const NOT_STAFF = [
  null,
  { id: "u-c", name: "C", roles: ["commuter"] },
  { id: "u-m", name: "M", roles: ["commuter", "community_moderator", "contributor"] },
  { id: "u-k", name: "K", roles: ["commuter", "complaint_reviewer"] },
  { id: "u-s", name: "S", roles: [] },
];

beforeEach(() => {
  state.user = null;
  state.stepUpAt = null;
  state.authAt = new Date();
  state.calls = [];
  state.params.clear();
  state.publishFail = null;
  state.facts = null;
});

describe("role guard", () => {
  it("answers 404 (never 401/403) to guests, commuters, moderators, complaint reviewers and suspended accounts", async () => {
    for (const user of NOT_STAFF) {
      state.user = user;
      for (const res of [
        await getDashboard(get("/api/v1/admin/dashboard")),
        await getRevisions(get("/api/v1/admin/revisions")),
        await postDraft(post("/api/v1/admin/revisions")),
        await postValidate(post(`/api/v1/admin/revisions/${REV}/validate`), idParams()),
        await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB }), idParams()),
        await postRollback(post(`/api/v1/admin/revisions/${REV}/rollback`, { expectedPublishedId: PUB }), idParams()),
      ]) {
        expect(res.status, JSON.stringify(user)).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
    expect(state.calls.filter((c) => c.startsWith("transit."))).toEqual([]);
  });

  it("lets admins and transport reviewers read the dashboard (private, no-store, no-referrer)", async () => {
    for (const user of STAFF) {
      state.user = user;
      const res = await getDashboard(get("/api/v1/admin/dashboard"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      const body = adminDashboardSchema.parse(await res.json());
      expect(body.published?.publishedAt).toBe("2026-10-16T08:00:00.500Z");
      expect(body.stopCandidates).toBe(128);
    }
  });
});

describe("12-hour staff re-login (spec 05 §5.4)", () => {
  it("answers 401 sign-in-again to staff whose session is over 12 hours old, before any data call", async () => {
    for (const user of STAFF) {
      state.user = user;
      for (const authAt of [new Date(Date.now() - 12 * 3_600_000 - 60_000), null]) {
        state.authAt = authAt;
        state.calls = [];
        for (const res of [
          await getDashboard(get("/api/v1/admin/dashboard")),
          await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB }), idParams()),
        ]) {
          expect(res.status).toBe(401);
          expect(await errorCode(res)).toBe("unauthorized");
          expect(res.headers.get("cache-control")).toBe("private, no-store");
        }
        expect(state.calls).toEqual([]);
      }
      state.authAt = new Date(Date.now() - 11 * 3_600_000);
      expect((await getDashboard(get("/api/v1/admin/dashboard"))).status).toBe(200);
    }
  });
});

describe("validate", () => {
  it("reads the facts, runs the rules (synthetic guard included) and records the report with the facts' membership hash", async () => {
    state.user = STAFF[1]!;
    const res = await postValidate(post(`/api/v1/admin/revisions/${REV}/validate`), idParams());
    expect(res.status).toBe(200);
    const report = validationReportSchema.parse(await res.json());
    expect(report).toMatchObject({ ok: false, errorCount: 1, validatedAt: "2026-10-22T02:00:00.123Z" });
    expect(report.issues[0]).toMatchObject({ rule: "synthetic", ref: "route FX-1" });
    const order = state.calls.filter((c) => c.startsWith("transit."));
    expect(order).toEqual(["transit.admin_validation_facts", "transit.admin_record_validation"]);
    const [id, hash, json] = state.params.get("transit.admin_record_validation")!;
    expect(id).toBe(REV);
    expect(hash).toBe("b".repeat(64));
    expect(JSON.parse(String(json))).toMatchObject({ ok: false, errorCount: 1 });
  });

  it("404 for a malformed id, 400 for a non-JSON body", async () => {
    state.user = STAFF[0]!;
    expect((await postValidate(post("/api/v1/admin/revisions/x/validate"), idParams("not-a-uuid"))).status).toBe(404);
    expect((await postValidate(post(`/api/v1/admin/revisions/${REV}/validate`, {}, "text/plain"), idParams())).status).toBe(400);
  });
});

describe("publish and rollback", () => {
  it("without a fresh step-up: 403 step_up_required, and the publish function is never called", async () => {
    state.user = STAFF[0]!;
    for (const res of [
      await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB }), idParams()),
      await postRollback(post(`/api/v1/admin/revisions/${REV}/rollback`, { expectedPublishedId: PUB }), idParams()),
    ]) {
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("step_up_required");
    }
    expect(state.calls).not.toContain("transit.admin_publish_revision");
  });

  it("with a fresh step-up: applies it first in the transaction, then publishes and answers the new head", async () => {
    state.user = STAFF[1]!;
    state.stepUpAt = new Date();
    const res = await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB }), idParams());
    expect(res.status).toBe(200);
    const body = publishResultSchema.parse(await res.json());
    expect(body).toMatchObject({ mode: "publish", revisionId: REV, previousRevisionId: PUB, head: { revisionId: REV } });
    const i = state.calls.indexOf("core.step_up_apply");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(state.calls.indexOf("transit.admin_publish_revision")).toBeGreaterThan(i);
    expect(state.params.get("transit.admin_publish_revision")).toEqual([REV, PUB, "publish"]);
  });

  it("refuses a body without expectedPublishedId or with extra fields", async () => {
    state.user = STAFF[0]!;
    state.stepUpAt = new Date();
    expect((await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, {}), idParams())).status).toBe(400);
    expect((await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB, force: true }), idParams())).status).toBe(400);
    expect(state.calls).not.toContain("transit.admin_publish_revision");
  });

  it("maps database refusals: stale page or validation 409, step-up 403, role 404, unknown 404", async () => {
    state.user = STAFF[0]!;
    state.stepUpAt = new Date();
    const cases: [{ code: string; message: string }, number, string][] = [
      [{ code: "55000", message: "the published revision changed since this page was loaded; reload and try again" }, 409, "conflict"],
      [{ code: "55000", message: "validate the revision first; publication needs a validation without errors" }, 409, "conflict"],
      [{ code: "23514", message: "revision x has synthetic or missing members: route:1" }, 409, "conflict"],
      [{ code: "42501", message: "step-up required" }, 403, "step_up_required"],
      [{ code: "42501", message: "a second reviewer must publish this revision" }, 403, "forbidden"],
      [{ code: "42501", message: "forbidden" }, 404, "not_found"],
      [{ code: "22023", message: "unknown revision" }, 404, "not_found"],
    ];
    for (const [fail, status, code] of cases) {
      state.publishFail = fail;
      const res = await postPublish(post(`/api/v1/admin/revisions/${REV}/publish`, { expectedPublishedId: PUB }), idParams());
      expect(res.status, fail.message).toBe(status);
      expect(await errorCode(res)).toBe(code);
    }
  });

  it("adminProblem leaves unknown errors alone (they become 500)", () => {
    const e = new Error("boom");
    expect(adminProblem(e)).toBe(e);
  });
});
