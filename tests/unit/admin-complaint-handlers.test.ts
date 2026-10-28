// /api/v1/admin/complaints/** (N7, C11): the role guard (404 before any database call for every
// role but complaint_reviewer, admins included), the step-up applied first in the same transaction
// (403 step_up_required and no report function otherwise), the definer function each call uses,
// strict bodies, the 60-second attachment link with private, no-referrer headers, and the
// refusal → HTTP mapping.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { complaintDetailSchema, complaintListSchema, evidenceLinkSchema } from "@/domain/admin/complaints";
import { apiErrorSchema } from "@/domain/api/schemas";

const C1 = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const E1 = "8a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  stepUp: true,
  calls: [] as string[],
  params: new Map<string, unknown[]>(),
  fail: null as { code: string; message: string } | null,
  detail: null as unknown,
  evidence: null as { bucket: string; object_key: string } | null,
  signed: [] as unknown[][],
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const flat = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).flatMap((c) =>
    typeof c === "object" && c && "value" in c ? [] : typeof c === "object" && c && "queryChunks" in c ? flat(c) : [c],
  );

vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => state.user,
  getAuthSession: async () => (state.user ? { userId: state.user.id, sessionId: "sess-1", email: null, authenticatedAt: new Date() } : null),
}));
vi.mock("@/server/auth/step-up", () => ({
  currentStepUpKey: async () => "k".repeat(64),
  applyStepUp: async (db: { execute: (q: unknown) => Promise<unknown> }) => {
    await db.execute({ queryChunks: [{ value: ["select core.step_up_apply(?)"] }] });
    return state.stepUp;
  },
  isStepUpError: (e: { cause?: { code?: string; message?: string } }) => e?.cause?.code === "42501" && String(e?.cause?.message).includes("step-up required"),
}));

const LIST_ROW = {
  id: C1, publicRef: "PN-7KQ4-2M", category: "overcharging", status: "submitted", queue: "queue_priority",
  submittedAt: "2026-10-22 10:00:00.5+08", incidentAt: "2026-10-22 09:00:00+08", updatedAt: "2026-10-22 10:00:00.5+08",
  closedAt: null, outcomeCode: null, legalHold: false, evidenceCount: 1,
};
const DETAIL = {
  ...LIST_ROW, description: "Asked for twice the fare on the loop.", retentionUntil: null, operator: null, plate: "ABC 1234", bodyNumber: null,
  location: { source: "gps", text: null, accuracyM: "12", lat: "13.6234", lng: "123.1847" },
  evidence: [{ id: E1, captureKind: "in_app_camera", capturedAt: null, receivedAt: "2026-10-22 10:00:00+08", mime: "image/jpeg", bytes: "2048", sha256: "a".repeat(64), available: true }],
  events: [{ from: null, to: "submitted", actorRole: "reporter", mine: false, visibility: "reporter", outcomeCode: null, note: null, at: "2026-10-22 10:00:00+08" }],
  access: [],
};

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const key = text(q).match(/ops\.take_token|core\.step_up_apply|priv\.\w+/)?.[0] ?? "other";
        state.calls.push(key);
        state.params.set(key, flat(q));
        if (key === "ops.take_token") return { rows: [{ ok: true }] };
        if (key === "core.step_up_apply") return { rows: [] };
        if (state.fail) throw Object.assign(new Error("Failed query"), { cause: state.fail });
        switch (key) {
          case "priv.review_list":
            return { rows: [{ d: [LIST_ROW] }] };
          case "priv.review_complaint":
            return { rows: [{ d: state.detail }] };
          case "priv.set_complaint_status":
          case "priv.set_complaint_legal_hold":
            return { rows: [{ ok: true }] };
          case "priv.reviewer_evidence_download":
            return { rows: state.evidence ? [state.evidence] : [] };
          default:
            return { rows: [] };
        }
      },
    }),
}));

vi.mock("@/server/storage/adapter", () => ({
  getStorage: () => ({
    createPresignedDownload: async (...args: unknown[]) => {
      state.signed.push(args);
      return "https://storage.example/evidence-private/complaint_evidence/x.jpg?X-Amz-Signature=abc&response-content-disposition=attachment";
    },
  }),
}));

const h = await import("@/server/admin/complaint-handlers");

const post = (url: string, body: unknown = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const problem = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
const reportCalls = () => state.calls.filter((c) => c.startsWith("priv."));

const REVIEWER = { id: "u-k", name: "K", roles: ["commuter", "complaint_reviewer"] };
const NOT_REVIEWERS = [
  null,
  { id: "u-c", name: "C", roles: ["commuter"] },
  { id: "u-m", name: "M", roles: ["commuter", "community_moderator"] },
  { id: "u-t", name: "T", roles: ["commuter", "transport_reviewer"] },
  { id: "u-a", name: "A", roles: ["commuter", "admin"] },
  { id: "u-s", name: "S", roles: [] },
];

const all = () => [
  h.getComplaints(get("/api/v1/admin/complaints")),
  h.getComplaint(get(`/api/v1/admin/complaints/${C1}`), Promise.resolve({ id: C1 })),
  h.postComplaintAction(post(`/api/v1/admin/complaints/${C1}`, { action: "status", to: "under_review" }), Promise.resolve({ id: C1 })),
  h.postComplaintEvidence(post(`/api/v1/admin/complaints/${C1}/evidence/${E1}`), Promise.resolve({ id: C1, evidenceId: E1 })),
];

beforeEach(() => {
  state.user = null;
  state.stepUp = true;
  state.calls = [];
  state.params.clear();
  state.fail = null;
  state.detail = DETAIL;
  state.evidence = { bucket: "evidence-private", object_key: "complaint_evidence/x.jpg" };
  state.signed = [];
});

describe("role guard (AC-14)", () => {
  it("404 before any database call for commuters, moderators, transport reviewers and admins", async () => {
    for (const user of NOT_REVIEWERS) {
      state.user = user;
      for (const res of await Promise.all(all())) {
        expect(res.status, JSON.stringify(user)).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      }
    }
    expect(state.calls).toEqual([]);
  });

  it("a reviewer without a fresh step-up gets 403 step_up_required and no report function runs", async () => {
    state.user = REVIEWER;
    state.stepUp = false;
    for (const res of await Promise.all(all())) {
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe("step_up_required");
    }
    expect(reportCalls()).toEqual([]);
  });

  it("the database's own refusals: 'forbidden' answers 404, a missing step-up 403", async () => {
    state.user = REVIEWER;
    state.fail = { code: "42501", message: "forbidden" };
    expect((await h.getComplaints(get("/api/v1/admin/complaints"))).status).toBe(404);
    state.fail = { code: "42501", message: "step-up required" };
    const res = await h.getComplaint(get(`/api/v1/admin/complaints/${C1}`), Promise.resolve({ id: C1 }));
    expect(res.status).toBe(403);
    expect((await problem(res)).code).toBe("step_up_required");
  });
});

describe("queue and report", () => {
  it("lists the scope through priv.review_list after the step-up, with ISO times", async () => {
    state.user = REVIEWER;
    const res = await h.getComplaints(get("/api/v1/admin/complaints?scope=open"));
    expect(res.status).toBe(200);
    const body = complaintListSchema.parse(await res.json());
    expect(body.complaints[0]!.submittedAt).toBe("2026-10-22T02:00:00.500Z");
    expect(state.calls.filter((c) => c !== "other")).toEqual(["core.step_up_apply", "priv.review_list"]);
    expect(state.params.get("priv.review_list")).toEqual(["open"]);
    expect((await h.getComplaints(get("/api/v1/admin/complaints?scope=all"))).status).toBe(400);
  });

  it("opens one report (numbers parsed), and answers 404 for a missing or own report", async () => {
    state.user = REVIEWER;
    const res = await h.getComplaint(get(`/api/v1/admin/complaints/${C1}`), Promise.resolve({ id: C1 }));
    const body = complaintDetailSchema.parse(await res.json());
    expect(body.location).toEqual({ source: "gps", text: null, accuracyM: 12, lat: 13.6234, lng: 123.1847 });
    expect(body.evidence[0]!.bytes).toBe(2048);
    expect(JSON.stringify(body)).not.toMatch(/reporter_?id|object_?key/i);
    state.detail = null;
    expect((await h.getComplaint(get(`/api/v1/admin/complaints/${C1}`), Promise.resolve({ id: C1 }))).status).toBe(404);
    expect((await h.getComplaint(get("/api/v1/admin/complaints/not-a-uuid"), Promise.resolve({ id: "not-a-uuid" }))).status).toBe(404);
  });
});

describe("status changes and legal hold", () => {
  it("passes exactly the fields to priv.set_complaint_status; closing needs an outcome, and only closing", async () => {
    state.user = REVIEWER;
    const ok = await h.postComplaintAction(
      post(`/api/v1/admin/complaints/${C1}`, { action: "status", to: "closed", outcomeCode: "insufficient_detail", note: "No plate or time.", visibility: "reporter" }),
      Promise.resolve({ id: C1 }),
    );
    expect(ok.status).toBe(200);
    expect(state.params.get("priv.set_complaint_status")).toEqual([C1, "closed", "insufficient_detail", "No plate or time.", "reporter"]);
    for (const body of [
      { action: "status", to: "closed" },
      { action: "status", to: "under_review", outcomeCode: "duplicate" },
      { action: "status", to: "withdrawn" },
      { action: "status", to: "under_review", extra: 1 },
      { action: "legal_hold", hold: true, note: "x" },
    ]) {
      expect((await h.postComplaintAction(post(`/api/v1/admin/complaints/${C1}`, body), Promise.resolve({ id: C1 }))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("a status change defaults the note to reviewers only; legal hold goes through its own function", async () => {
    state.user = REVIEWER;
    await h.postComplaintAction(post(`/api/v1/admin/complaints/${C1}`, { action: "status", to: "under_review" }), Promise.resolve({ id: C1 }));
    expect(state.params.get("priv.set_complaint_status")).toEqual([C1, "under_review", null, null, "reviewer_only"]);
    await h.postComplaintAction(post(`/api/v1/admin/complaints/${C1}`, { action: "legal_hold", hold: true, note: "Police request 22 Oct." }), Promise.resolve({ id: C1 }));
    expect(state.params.get("priv.set_complaint_legal_hold")).toEqual([C1, true, "Police request 22 Oct."]);
  });

  it("an invalid transition from the database is a 400 with its message", async () => {
    state.user = REVIEWER;
    state.fail = { code: "22023", message: "invalid transition closed to under_review" };
    const res = await h.postComplaintAction(post(`/api/v1/admin/complaints/${C1}`, { action: "status", to: "under_review" }), Promise.resolve({ id: C1 }));
    expect(res.status).toBe(400);
    expect((await problem(res)).message).toBe("Invalid transition closed to under_review.");
  });
});

describe("evidence (60-second links)", () => {
  it("records the issuance in the database first, then signs a 60-second attachment link; private and no-referrer", async () => {
    state.user = REVIEWER;
    const res = await h.postComplaintEvidence(post(`/api/v1/admin/complaints/${C1}/evidence/${E1}`), Promise.resolve({ id: C1, evidenceId: E1 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(evidenceLinkSchema.parse(await res.json()).expiresInSeconds).toBe(60);
    expect(state.params.get("priv.reviewer_evidence_download")).toEqual([C1, E1]);
    expect(state.signed).toEqual([["evidence-private", "complaint_evidence/x.jpg", 60, { attachment: true }]]);
    expect(state.calls.filter((c) => c !== "other")).toEqual(["ops.take_token", "core.step_up_apply", "priv.reviewer_evidence_download"]);
  });

  it("no file (missing, someone else's evidence id, not verified): 404 and nothing signed", async () => {
    state.user = REVIEWER;
    state.evidence = null;
    expect((await h.postComplaintEvidence(post(`/api/v1/admin/complaints/${C1}/evidence/${E1}`), Promise.resolve({ id: C1, evidenceId: E1 }))).status).toBe(404);
    expect(state.signed).toEqual([]);
  });

  it("the reviewer's own report: the database refusal is a 403, nothing signed", async () => {
    state.user = REVIEWER;
    state.fail = { code: "42501", message: "forbidden: own report" };
    expect((await h.postComplaintEvidence(post(`/api/v1/admin/complaints/${C1}/evidence/${E1}`), Promise.resolve({ id: C1, evidenceId: E1 }))).status).toBe(403);
    expect(state.signed).toEqual([]);
  });
});
