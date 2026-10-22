// /api/v1/admin/{users,providers,jobs,audit} (N7, C12): who reaches each (404 before any database
// call otherwise), role changes behind a fresh step-up with no self-change, the database refusals
// (last admin → 409), lookup by full email only, the Jev panel that never carries a key and a
// diagnostic that is skipped without one, and an audit log whose non-admin readers are pinned to
// their own rows with a keyset cursor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditPageSchema, diagnosticResultSchema, providersSchema } from "@/domain/admin/system";
import { apiErrorSchema } from "@/domain/api/schemas";

const SECRET = "sk-or-v1-THIS-MUST-NEVER-APPEAR";
const A1 = "9a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  stepUp: true,
  calls: [] as string[],
  params: new Map<string, unknown[]>(),
  sqls: [] as string[],
  fail: null as { code: string; message: string } | null,
  env: {} as Record<string, unknown>,
  jevCalls: 0,
  auditRows: [] as Record<string, unknown>[],
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : typeof c === "object" && c && "queryChunks" in c ? text(c) : "?"))
    .join("");
const flat = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).flatMap((c) =>
    typeof c === "object" && c && "value" in c ? [] : typeof c === "object" && c && "queryChunks" in c ? flat(c) : [c],
  );

vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/env", () => ({ serverEnv: () => state.env }));
vi.mock("@/server/auth/step-up", () => ({
  currentStepUpKey: async () => "k".repeat(64),
  applyStepUp: async () => state.stepUp,
  isStepUpError: (e: { cause?: { code?: string; message?: string } }) => e?.cause?.code === "42501" && String(e?.cause?.message).includes("step-up required"),
}));
vi.mock("@/server/adapters/jev/client", () => ({
  jevBudgetKey: (day: string) => `key-${day}`,
  createJevClient: () => ({
    classify: async () => {
      state.jevCalls++;
      return { status: "ok", verdict: { recommendation: "publish", confidence: 0.91 } };
    },
  }),
}));

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        const key = t.match(/ops\.take_token|core\.audit_event|core\.(?:admin_\w+|grant_role|revoke_role|audit)|ops\.provider_health|ops\.rate_limit_bucket|ops\.feature_flag|ops\.job/)?.[0] ?? "other";
        state.calls.push(key);
        state.params.set(key, flat(q));
        state.sqls.push(t);
        if (key === "ops.take_token") return { rows: [{ ok: true }] };
        if (state.fail && (key === "core.grant_role" || key === "core.revoke_role" || key.startsWith("core.admin_"))) throw Object.assign(new Error("Failed query"), { cause: state.fail });
        switch (key) {
          case "core.admin_staff":
            return { rows: [{ d: [{ userId: "u-x", name: "X", email: "x@example.com", self: false, suspended: false, roles: [{ role: "admin", active: true, grantedAt: "2026-10-01 00:00:00+00", grantedBy: null, revokedAt: null, reason: "bootstrap" }] }] }] };
          case "core.admin_find_user":
            return { rows: [{ d: null }] };
          case "ops.provider_health":
            return { rows: [] };
          case "ops.rate_limit_bucket":
            return { rows: [{ count: 7 }] };
          case "ops.feature_flag":
            return { rows: [{ key: "auto_publish", enabled: false, updated_at: null }] };
          case "ops.job":
            return { rows: [] };
          case "core.audit_event":
            return { rows: state.auditRows };
          default:
            return { rows: [] };
        }
      },
    }),
}));

const h = await import("@/server/admin/system-handlers");

const post = (url: string, body: unknown = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const problem = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
const dbCalls = () => state.calls.filter((c) => c !== "other");

const ADMIN = { id: "u-admin", name: "A", roles: ["commuter", "admin"] };
const MODERATOR = { id: "u-mod", name: "M", roles: ["commuter", "community_moderator"] };
const REVIEWER = { id: "u-rev", name: "R", roles: ["commuter", "transport_reviewer"] };
const COMPLAINTS = { id: "u-k", name: "K", roles: ["commuter", "complaint_reviewer"] };
const COMMUTER = { id: "u-c", name: "C", roles: ["commuter"] };

const BASE_ENV = {
  OPENROUTER_API_KEY: SECRET,
  JEV_MODEL_ID: "typesafe/jev-1.13-20260917",
  JEV_DECISIONS_URL: "https://openrouter.ai/api/alpha/decisions",
  JEV_POLICY_VERSION: "paranaga-community-v1",
  JEV_TIMEOUT_MS: 10000,
  JEV_DAILY_BUDGET_REQUESTS: 5000,
  AUTO_PUBLISH_ENABLED: false,
  JEV_COMPLAINTS_ENABLED: false,
  CRON_SECRET: "c".repeat(40),
  STORAGE_SECRET_ACCESS_KEY: "storage-secret-NEVER",
  NEON_AUTH_COOKIE_SECRET: "cookie-secret-NEVER-".repeat(2),
};

beforeEach(() => {
  state.user = null;
  state.stepUp = true;
  state.calls = [];
  state.params.clear();
  state.sqls = [];
  state.fail = null;
  state.env = { ...BASE_ENV };
  state.jevCalls = 0;
  state.auditRows = [];
});

const roleBody = { userId: "u-x", role: "complaint_reviewer", change: "grant", reason: "Named by the owner on 22 Oct." };

describe("who reaches what", () => {
  it("users, jobs and the diagnostic: admins only (404 before any database call)", async () => {
    for (const user of [null, COMMUTER, MODERATOR, REVIEWER, COMPLAINTS]) {
      state.user = user;
      for (const res of [
        await h.getStaff(get("/api/v1/admin/users")),
        await h.postUserLookup(post("/api/v1/admin/users/lookup", { email: "x@example.com" })),
        await h.postRoleChange(post("/api/v1/admin/users/roles", roleBody)),
        await h.getJobs(get("/api/v1/admin/jobs")),
        await h.postJevDiagnostic(post("/api/v1/admin/providers/jev-diagnostic")),
      ]) {
        expect(res.status, JSON.stringify(user)).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
    expect(dbCalls()).toEqual([]);
  });

  it("providers: moderators and admins; audit: any staff; neither for commuters", async () => {
    for (const user of [null, COMMUTER]) {
      state.user = user;
      expect((await h.getProviders(get("/api/v1/admin/providers"))).status).toBe(404);
      expect((await h.getAudit(get("/api/v1/admin/audit"))).status).toBe(404);
    }
    for (const user of [REVIEWER, COMPLAINTS]) {
      state.user = user;
      expect((await h.getProviders(get("/api/v1/admin/providers"))).status).toBe(404);
    }
    expect(dbCalls()).toEqual([]);
    state.user = MODERATOR;
    expect((await h.getProviders(get("/api/v1/admin/providers"))).status).toBe(200);
  });
});

describe("users and roles (A18)", () => {
  it("a role change runs after the step-up with the reason; without step-up nothing is called", async () => {
    state.user = ADMIN;
    expect((await h.postRoleChange(post("/api/v1/admin/users/roles", roleBody))).status).toBe(200);
    expect(state.params.get("core.grant_role")).toEqual(["u-x", "complaint_reviewer", "Named by the owner on 22 Oct."]);
    expect((await h.postRoleChange(post("/api/v1/admin/users/roles", { ...roleBody, change: "revoke", role: "admin" }))).status).toBe(200);
    expect(state.params.get("core.revoke_role")).toEqual(["u-x", "admin", "Named by the owner on 22 Oct."]);
    state.calls = [];
    state.stepUp = false;
    const res = await h.postRoleChange(post("/api/v1/admin/users/roles", roleBody));
    expect(res.status).toBe(403);
    expect((await problem(res)).code).toBe("step_up_required");
    expect(dbCalls()).not.toContain("core.grant_role");
  });

  it("refuses your own roles before any database call, a missing reason and granting commuter", async () => {
    state.user = ADMIN;
    const self = await h.postRoleChange(post("/api/v1/admin/users/roles", { ...roleBody, userId: ADMIN.id }));
    expect(self.status).toBe(403);
    expect((await problem(self)).message).toMatch(/your own roles/);
    for (const body of [{ ...roleBody, reason: " " }, { ...roleBody, role: "commuter" }, { ...roleBody, role: "superuser" }, { ...roleBody, extra: true }]) {
      expect((await h.postRoleChange(post("/api/v1/admin/users/roles", body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(dbCalls()).toEqual([]);
  });

  it("the database's refusals: the last admin is a 409, an unknown user a 400", async () => {
    state.user = ADMIN;
    state.fail = { code: "55000", message: "cannot remove the last admin" };
    const last = await h.postRoleChange(post("/api/v1/admin/users/roles", { ...roleBody, change: "revoke", role: "admin" }));
    expect(last.status).toBe(409);
    expect((await problem(last)).message).toBe("Cannot remove the last admin.");
    state.fail = { code: "22023", message: "unknown user: they must sign in once first" };
    expect((await h.postRoleChange(post("/api/v1/admin/users/roles", roleBody))).status).toBe(400);
  });

  it("lookup takes a full email address only; no match is {user: null}", async () => {
    state.user = ADMIN;
    for (const email of ["x", "x@", "@example.com", "x@example", "a b@example.com"]) {
      expect((await h.postUserLookup(post("/api/v1/admin/users/lookup", { email }))).status, email).toBe(400);
    }
    const res = await h.postUserLookup(post("/api/v1/admin/users/lookup", { email: " X@Example.com " }));
    expect(await res.json()).toEqual({ user: null });
    expect(state.params.get("core.admin_find_user")).toEqual(["x@example.com"]);
    const staff = await (await h.getStaff(get("/api/v1/admin/users"))).json();
    expect(staff.staff[0].roles[0].grantedAt).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("Jev and providers (A19)", () => {
  it("shows the configuration as yes/no and never a key or secret", async () => {
    state.user = MODERATOR;
    const res = await h.getProviders(get("/api/v1/admin/providers"));
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toMatch(/NEVER/);
    const body = providersSchema.parse(JSON.parse(raw));
    expect(body.jev).toMatchObject({ keyPresent: true, enabled: true, modelPinned: true, decisionsHost: "openrouter.ai", usedToday: 7, dailyBudget: 5000 });
    expect(body.canRunDiagnostic).toBe(false);
    expect(body.providers.find((p) => p.id === "cron")).toMatchObject({ configured: true });
  });

  it("the diagnostic is skipped (and audited) without a key; with one it makes one call and records health", async () => {
    state.user = ADMIN;
    state.env = { ...BASE_ENV, OPENROUTER_API_KEY: undefined };
    let res = await h.postJevDiagnostic(post("/api/v1/admin/providers/jev-diagnostic"));
    expect(diagnosticResultSchema.parse(await res.json())).toMatchObject({ ran: false, status: "skipped" });
    expect(state.jevCalls).toBe(0);
    expect(dbCalls()).toContain("core.audit");

    state.env = { ...BASE_ENV, JEV_DAILY_BUDGET_REQUESTS: 0 };
    res = await h.postJevDiagnostic(post("/api/v1/admin/providers/jev-diagnostic"));
    expect((await res.json()).status).toBe("skipped");
    expect(state.jevCalls).toBe(0);

    state.env = { ...BASE_ENV };
    state.calls = [];
    res = await h.postJevDiagnostic(post("/api/v1/admin/providers/jev-diagnostic"));
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw)).toMatchObject({ ran: true, status: "ok", recommendation: "publish", confidence: 0.91 });
    expect(state.jevCalls).toBe(1);
    expect(dbCalls()).toEqual(expect.arrayContaining(["ops.provider_health", "core.audit"]));
  });
});

describe("audit log (A21)", () => {
  const row = (n: number) => ({
    id: `9a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8${String(n).padStart(3, "0")}`,
    at: "2026-10-22 02:00:00.123456+00",
    at_us: "1792634400123456",
    actor_user_id: "u-admin",
    actor_name: "A",
    actor_role: "admin",
    action: "role.grant",
    entity_type: "user",
    entity_id: "u-x",
    after: { role: "admin" },
    request_id: "r1",
  });

  it("non-admin staff are pinned to their own rows, whatever actor they ask for", async () => {
    state.user = MODERATOR;
    const res = await h.getAudit(get("/api/v1/admin/audit?actor=u-admin"));
    expect(auditPageSchema.parse(await res.json()).scope).toBe("own");
    expect(state.params.get("core.audit_event")).toContain(MODERATOR.id);
    expect(state.params.get("core.audit_event")).not.toContain("u-admin");
  });

  it("admins filter by actor, action prefix and Manila dates; 51 rows give a microsecond cursor", async () => {
    state.user = ADMIN;
    state.auditRows = Array.from({ length: 51 }, (_, i) => row(i));
    const res = await h.getAudit(get("/api/v1/admin/audit?actor=u-x&action=role.*&from=2026-10-21&to=2026-10-22"));
    const body = auditPageSchema.parse(await res.json());
    expect(body.scope).toBe("all");
    expect(body.rows).toHaveLength(50);
    expect(body.next).toBe(`1792634400123456|${row(49).id}`);
    const p = state.params.get("core.audit_event")!;
    expect(p).toEqual(expect.arrayContaining(["u-x", "role.%", "2026-10-20T16:00:00.000Z", "2026-10-22T16:00:00.000Z"]));
    await h.getAudit(get(`/api/v1/admin/audit?before=${encodeURIComponent(body.next!)}`));
    expect(state.params.get("core.audit_event")).toEqual(expect.arrayContaining(["1792634400123456", row(49).id]));
  });

  it("rejects a bad cursor, action or date", async () => {
    state.user = ADMIN;
    for (const qs of ["before=garbage", "before=123|not-a-uuid", "action=DROP TABLE", "from=22/10/2026", "page=2"]) {
      expect((await h.getAudit(get(`/api/v1/admin/audit?${qs}`))).status, qs).toBe(400);
    }
  });
});

describe("jobs (A20)", () => {
  it("lists counts and rows (never the payload) and the retention runs", async () => {
    state.user = ADMIN;
    const res = await h.getJobs(get("/api/v1/admin/jobs"));
    expect(res.status).toBe(200);
    expect(state.sqls.find((s) => s.includes("from ops.job order by"))).not.toMatch(/payload/);
  });
});

void A1;
