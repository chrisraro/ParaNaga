// POST /api/v1/complaints, GET /api/v1/me/complaints and the owner evidence link (task B8).
// authorize() first, strict body, idempotent replay, rate limit, definer function only, every
// response `private, no-store` + no-referrer, nothing from the report in logs, never Jev.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import { createComplaintResponseSchema, evidenceUrlResponseSchema, myComplaintsResponseSchema } from "@/domain/complaints/schemas";

type User = { id: string; name: string; roles: string[] };
const OWNER: User = { id: "user-owner", name: "A", roles: ["commuter"] };
const COMPLAINT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const EVIDENCE_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a77";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  rateLimited: false,
  existing: false,
  submitFail: [] as { code: string }[],
  // Rows the database would return to the caller: keyed by the user id in the request context.
  owned: new Map<string, string>(),
  calls: [] as string[],
  queries: [] as { userId: string | null; text: string; params: unknown[] }[],
  authorized: [] as string[],
  jev: 0,
  signed: [] as { bucket: string; key: string; ttl: number }[],
  // Step-up (N3): what core.step_up_apply returns for this session, the Neon Auth session id, and
  // whether the definer function itself refuses (priv.require_step_up raising 42501).
  stepUpAt: null as Date | null,
  sessionId: "sess-1" as string | null,
  dbRefusesStepUp: false,
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const params = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => !(typeof c === "object" && c && "value" in c));

vi.mock("@/server/auth/authorize", () => ({
  authorize: async (action: string) => {
    state.authorized.push(action);
    if (!state.user) throw Object.assign(new Error("Not allowed"), { name: "AuthorizationError", reason: "unauthenticated" });
    return state.user;
  },
}));
vi.mock("@/server/adapters/jev/client", () => ({
  createJevClient: () => ({
    classify: async () => {
      state.jev += 1;
      return { status: "unavailable", reason: "x" };
    },
  }),
}));
vi.mock("@/server/auth/session", () => ({
  getAuthSession: async () => (state.user ? { userId: state.user.id, sessionId: state.sessionId, email: "a@example.com" } : null),
}));
vi.mock("@/server/storage/adapter", () => ({
  getStorage: () => ({
    createPresignedDownload: async (bucket: string, key: string, ttl: number) => {
      state.signed.push({ bucket, key, ttl });
      return `https://storage.example/${bucket}/${key}?X-Amz-Expires=${ttl}&X-Amz-Signature=abc`;
    },
  }),
}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (ctx: { userId: string | null }, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        const p = params(q);
        state.queries.push({ userId: ctx.userId, text: t, params: p });
        if (t.includes("ops.take_token")) {
          state.calls.push("rate");
          return { rows: [{ ok: !state.rateLimited }] };
        }
        if (t.includes("insert into core.ack")) {
          state.calls.push("ack");
          return { rows: [] };
        }
        if (t.includes("priv.submit_complaint")) {
          state.calls.push("submit");
          const fail = state.submitFail.shift();
          if (fail) throw Object.assign(new Error("Failed query"), { cause: fail });
          return { rows: [{ id: COMPLAINT_ID, public_ref: p[1], category: p[2], status: "submitted", submitted_at: "2026-10-18T01:00:00Z" }] };
        }
        if (t.includes("core.step_up_apply")) {
          state.calls.push("step-up");
          return { rows: [{ at: state.stepUpAt }] };
        }
        if (t.includes("set_config('app.step_up_at'")) {
          state.calls.push("step-up-clear");
          return { rows: [] };
        }
        if (t.includes("priv.my_evidence_download")) {
          state.calls.push("evidence");
          if (state.dbRefusesStepUp) throw Object.assign(new Error("Failed query"), { cause: { code: "42501", message: "step-up required" } });
          // The definer function answers only the reporter of that complaint.
          return state.owned.get(String(p[0])) === ctx.userId
            ? { rows: [{ bucket: "evidence-private", object_key: "complaint_evidence/ab/abc.jpg" }] }
            : { rows: [] };
        }
        if (t.includes("from priv.complaint") && t.includes("client_request_id")) {
          state.calls.push("replay-check");
          return {
            rows: state.existing
              ? [{ id: COMPLAINT_ID, public_ref: "PN-7KQ4-2M", category: "overcharging", status: "submitted", submitted_at: "2026-10-18T01:00:00Z" }]
              : [],
          };
        }
        if (t.includes("from priv.complaint")) {
          state.calls.push("list");
          // RLS: only the caller's own rows ever come back.
          const mine = [...state.owned.entries()].filter(([, owner]) => owner === ctx.userId);
          return {
            rows: mine.map(([id]) => ({
              id,
              public_ref: "PN-7KQ4-2M",
              category: "overcharging",
              status: "under_review",
              submitted_at: "2026-10-18T01:00:00Z",
              incident_at: "2026-10-17T23:00:00Z",
              evidence: [{ id: EVIDENCE_ID, captureKind: "in_app_camera" }],
            })),
          };
        }
        return { rows: [] };
      },
    }),
}));

const { POST } = await import("@/app/api/v1/complaints/route");
const { GET: LIST } = await import("@/app/api/v1/me/complaints/route");
const { GET: EVIDENCE } = await import("@/app/api/v1/me/complaints/[id]/evidence/[evidenceId]/route");

const DESCRIPTION = "The driver of plate ABC 1234 asked for 40 pesos, call me at 0917 123 4567.";
const body = (over: Record<string, unknown> = {}) => ({
  clientRequestId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11",
  category: "overcharging",
  description: DESCRIPTION,
  incidentAt: new Date(Date.now() - 3_600_000).toISOString(),
  plate: "ABC 1234",
  evidence: [{ mediaId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12", captureKind: "in_app_camera" }],
  noticeAccepted: true,
  ...over,
});
const post = (b: unknown) =>
  POST(new Request("http://localhost/api/v1/complaints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
const list = () => LIST(new Request("http://localhost/api/v1/me/complaints"));
const evidence = (id = COMPLAINT_ID, evidenceId = EVIDENCE_ID) =>
  EVIDENCE(new Request(`http://localhost/api/v1/me/complaints/${id}/evidence/${evidenceId}`), {
    params: Promise.resolve({ id, evidenceId }),
  } as never);

function expectPrivate(res: Response) {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}
async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expectPrivate(res);
  expect(apiErrorSchema.parse(await res.json()).error.code).toBe(code);
}

let logged: string[];
beforeEach(() => {
  state.user = OWNER;
  state.rateLimited = false;
  state.existing = false;
  state.submitFail = [];
  state.owned = new Map([[COMPLAINT_ID, OWNER.id]]);
  state.calls = [];
  state.queries = [];
  state.authorized = [];
  state.jev = 0;
  state.signed = [];
  state.stepUpAt = new Date(Date.now() - 60_000);
  state.sessionId = "sess-1";
  state.dbRefusesStepUp = false;
  logged = [];
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "info").mockImplementation(capture);
});

describe("POST /api/v1/complaints", () => {
  it("answers 404 and writes nothing while DRIVER_REPORTS_ENABLED is off (N2)", async () => {
    vi.stubEnv("DRIVER_REPORTS_ENABLED", "false");
    try {
      await expectError(await post(body()), 404, "not_found");
      expect(state.queries).toEqual([]);
      expect(state.authorized).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("creates a private report and answers with a PN reference only", async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    expectPrivate(res);
    const json = await res.json();
    const parsed = createComplaintResponseSchema.parse(json);
    expect(parsed.complaint.reference).toMatch(/^PN-[2-9A-Z]{4}-[2-9A-Z]{2}$/);
    expect(JSON.stringify(json)).not.toContain("ABC 1234");
    expect(JSON.stringify(json)).not.toContain("40 pesos");
    expect(state.authorized).toEqual(["complaint.submit"]);
    expect(state.calls).toEqual(["replay-check", "rate", "rate", "ack", "submit"]);
    expect(state.jev).toBe(0); // complaint text is never sent to Jev
  });

  it("routes deterministically on the server (the client cannot pick a queue)", async () => {
    await post(body({ category: "harassment" }));
    const submit = state.queries.find((q) => q.text.includes("priv.submit_complaint"));
    expect(submit?.params).toContain("queue_priority");
    expect(submit?.userId).toBe(OWNER.id);
  });

  it("answers 401 to guests before touching the database", async () => {
    state.user = null;
    await expectError(await post(body()), 401, "unauthorized");
    expect(state.queries).toEqual([]);
  });

  it("refuses unknown fields, a missing acknowledgment and oversized text", async () => {
    await expectError(await post(body({ status: "closed" })), 400, "bad_request");
    await expectError(await post(body({ queue: "queue_priority" })), 400, "bad_request");
    await expectError(await post(body({ noticeAccepted: false })), 400, "bad_request");
    await expectError(await post(body({ description: "x".repeat(2001) })), 400, "bad_request");
    expect(state.calls).toEqual([]);
  });

  it("answers 429 at the daily limit without creating anything", async () => {
    state.rateLimited = true;
    await expectError(await post(body()), 429, "too_many_requests");
    expect(state.calls).not.toContain("submit");
  });

  it("replays a stored report without spending the rate limit", async () => {
    state.existing = true;
    state.rateLimited = true;
    const res = await post(body());
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(createComplaintResponseSchema.parse(await res.json()).complaint.reference).toBe("PN-7KQ4-2M");
    expect(state.calls).toEqual(["replay-check"]);
  });

  it("retries a reference clash with a new reference", async () => {
    state.submitFail = [{ code: "23505" }];
    const res = await post(body());
    expect(res.status).toBe(201);
    const refs = state.queries.filter((q) => q.text.includes("priv.submit_complaint")).map((q) => q.params[1]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it("gives up after repeated clashes with a 503", async () => {
    state.submitFail = [{ code: "23505" }, { code: "23505" }, { code: "23505" }, { code: "23505" }];
    await expectError(await post(body()), 503, "unavailable");
  });

  it("explains evidence the database refused (not the caller's, not verified, already used)", async () => {
    state.submitFail = [{ code: "22023" }];
    await expectError(await post(body()), 400, "bad_request");
  });

  it("never logs report text, plates or phone numbers, even on a server error", async () => {
    state.submitFail = [{ code: "XX000" }];
    await expectError(await post(body()), 500, "internal");
    const all = logged.join("\n");
    expect(all).not.toContain("ABC 1234");
    expect(all).not.toContain("0917");
    expect(all).not.toContain("pesos");
    expect(all).toContain("complaints");
  });
});

describe("GET /api/v1/me/complaints", () => {
  it("lists the caller's own reports, private and schema-valid", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expectPrivate(res);
    const parsed = myComplaintsResponseSchema.parse(await res.json());
    expect(parsed.complaints.map((c) => c.id)).toEqual([COMPLAINT_ID]);
    const q = state.queries.find((x) => x.text.includes("from priv.complaint"));
    expect(q?.text).toMatch(/where c\.reporter_id = \?/);
    expect(q?.params).toContain(OWNER.id);
  });

  it("answers 401 to guests", async () => {
    state.user = null;
    await expectError(await list(), 401, "unauthorized");
  });
});

describe("GET /api/v1/me/complaints/[id]/evidence/[evidenceId]", () => {
  it("gives the owner a 60 s link, private, with no-referrer", async () => {
    const res = await evidence();
    expect(res.status).toBe(200);
    expectPrivate(res);
    const parsed = evidenceUrlResponseSchema.parse(await res.json());
    expect(parsed.expiresInSeconds).toBe(60);
    expect(state.signed).toEqual([{ bucket: "evidence-private", key: "complaint_evidence/ab/abc.jpg", ttl: 60 }]);
    expect(logged.join("\n")).not.toContain("X-Amz-Signature");
  });

  it("answers the same 404 for bad ids and other people's evidence", async () => {
    await expectError(await evidence("not-a-uuid"), 404, "not_found");
    await expectError(await evidence(COMPLAINT_ID, "../../etc"), 404, "not_found");
    state.owned = new Map([[COMPLAINT_ID, "someone-else"]]);
    await expectError(await evidence(), 404, "not_found");
    expect(state.signed).toEqual([]);
  });

  it("answers 429 when links are requested too often", async () => {
    state.rateLimited = true;
    await expectError(await evidence(), 429, "too_many_requests");
    expect(state.signed).toEqual([]);
  });

  describe("step-up (N3)", () => {
    it("without a verification: 403 step_up_required, before any evidence lookup", async () => {
      state.stepUpAt = null;
      await expectError(await evidence(), 403, "step_up_required");
      expect(state.calls).toEqual(["rate", "step-up"]);
      expect(state.signed).toEqual([]);
    });

    it("the same answer for someone else's evidence (no existence leak)", async () => {
      state.stepUpAt = null;
      state.owned = new Map([[COMPLAINT_ID, "someone-else"]]);
      await expectError(await evidence(), 403, "step_up_required");
    });

    it("fresh: sets app.step_up_at first, in the same transaction as the evidence query", async () => {
      state.stepUpAt = new Date(Date.now() - 14 * 60_000);
      const res = await evidence();
      expect(res.status).toBe(200);
      expect(state.calls).toEqual(["rate", "step-up", "evidence"]);
      // One transaction (one context): the key passed is a sha256 of the session id, never the id.
      const apply = state.queries.find((q) => q.text.includes("core.step_up_apply"))!;
      expect(apply.userId).toBe(OWNER.id);
      expect(String(apply.params[0])).toMatch(/^[0-9a-f]{64}$/);
      expect(String(apply.params[0])).not.toContain("sess-1");
    });

    it("stale (over 15 minutes): step-up required again", async () => {
      state.stepUpAt = new Date(Date.now() - 16 * 60_000);
      await expectError(await evidence(), 403, "step_up_required");
      expect(state.calls).not.toContain("evidence");
    });

    it("no session id from Neon Auth: never passes, and the setting is cleared", async () => {
      state.sessionId = null;
      await expectError(await evidence(), 403, "step_up_required");
      expect(state.calls).toEqual(["rate", "step-up-clear"]);
    });

    it("the database gate refusing (priv.require_step_up) also answers step_up_required", async () => {
      state.dbRefusesStepUp = true;
      await expectError(await evidence(), 403, "step_up_required");
      expect(state.signed).toEqual([]);
    });
  });
});

// IDOR matrix at the handler level. The database mock behaves like forced RLS plus the definer
// function: rows come back only for the reporter. Every other actor is denied or sees nothing.
describe("access matrix: guest, owner, other commuter, community moderator, complaint reviewer", () => {
  const actors: { name: string; user: User | null; sees: boolean }[] = [
    { name: "guest", user: null, sees: false },
    { name: "owner", user: OWNER, sees: true },
    { name: "other commuter", user: { id: "user-other", name: "B", roles: ["commuter"] }, sees: false },
    { name: "community moderator", user: { id: "user-mod", name: "M", roles: ["commuter", "community_moderator"] }, sees: false },
    // Reviewers never use the owner endpoints for other people's reports: they need the
    // step-up-gated priv.review_* definer functions (not exposed over HTTP in this task).
    { name: "complaint reviewer", user: { id: "user-rev", name: "R", roles: ["commuter", "complaint_reviewer"] }, sees: false },
  ];

  for (const actor of actors) {
    it(`${actor.name}: ${actor.sees ? "sees" : "cannot see"} the report and its evidence`, async () => {
      state.user = actor.user;
      const listed = await list();
      const ev = await evidence();
      expectPrivate(listed);
      expectPrivate(ev);
      if (!actor.user) {
        expect(listed.status).toBe(401);
        expect(ev.status).toBe(401);
        return;
      }
      const ids = myComplaintsResponseSchema.parse(await listed.json()).complaints.map((c) => c.id);
      expect(ids.includes(COMPLAINT_ID)).toBe(actor.sees);
      expect(ev.status).toBe(actor.sees ? 200 : 404);
    });
  }
});
