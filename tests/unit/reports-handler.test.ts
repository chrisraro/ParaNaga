// GET /api/v1/me/complaints/[id], GET /api/v1/me/corrections/[id] and
// POST /api/v1/me/reports/[kind]/[id]/mynaga (task B9). authorize() first, strict body, rate
// limit, definer function only, owner only (another person's id answers 404), every response
// `private, no-store`, nothing from the report in logs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import { complaintDetailResponseSchema, correctionDetailResponseSchema, myNagaHandoffResponseSchema } from "@/domain/reports/schemas";

type User = { id: string; name: string; roles: string[] };
const OWNER: User = { id: "user-owner", name: "A", roles: ["commuter"] };
const OTHER: User = { id: "user-other", name: "B", roles: ["commuter"] };
const COMPLAINT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const CORRECTION_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a55";
const EVIDENCE_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a77";
const SECRET_REF = "MN-SECRET-REF-9931";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  rateLimited: false,
  owners: new Map<string, string>(),
  calls: [] as string[],
  queries: [] as { userId: string | null; text: string; params: unknown[] }[],
  authorized: [] as string[],
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
        // RLS: only the owner's rows ever come back.
        const owns = (id: unknown) => state.owners.get(String(id)) === ctx.userId;
        if (t.includes("from priv.complaint c")) {
          state.calls.push("complaint");
          return {
            rows: owns(p[0])
              ? [
                  {
                    id: COMPLAINT_ID,
                    public_ref: "PN-7KQ4-2M",
                    category: "overcharging",
                    status: "under_review",
                    submitted_at: "2026-10-17T16:00:00Z",
                    incident_at: "2026-10-17T14:30:00Z",
                    description: "Asked for 40 pesos.",
                    location_text: "Near Centro",
                    operator_text: null,
                    plate_text: "ABC 1234",
                    body_number_text: null,
                    outcome_code: null,
                  },
                ]
              : [],
          };
        }
        if (t.includes("from priv.complaint_media")) return { rows: [{ id: EVIDENCE_ID, capture_kind: "in_app_camera" }] };
        if (t.includes("from priv.complaint_event")) {
          return {
            rows: [
              { to_status: "submitted", at: "2026-10-17T16:00:00Z", note: null },
              { to_status: "under_review", at: "2026-10-18T01:00:00Z", note: "We are looking at it." },
            ],
          };
        }
        if (t.includes("from priv.external_handoff")) return { rows: [{ submitted_externally_at: "2026-10-18T02:00:00Z", self_reported_reference: SECRET_REF }] };
        if (t.includes("from community.correction c")) {
          state.calls.push("correction");
          return {
            rows: owns(p[0])
              ? [
                  {
                    id: CORRECTION_ID,
                    kind: "wrong_curb_side",
                    entity_type: "stop",
                    entity_id: "s1",
                    entity_label: "Centro stop",
                    status: "accepted",
                    submitted_at: "2026-10-10T00:00:00Z",
                    description: "The stop is on the other side.",
                  },
                ]
              : [],
          };
        }
        if (t.includes("from community.correction_event")) {
          return { rows: [{ to_status: "submitted", at: "2026-10-10T00:00:00Z" }, { to_status: "accepted", at: "2026-10-12T00:00:00Z" }] };
        }
        if (t.includes("priv.set_mynaga_handoff")) {
          state.calls.push("handoff");
          // The definer function returns no row for a report that is not the caller's.
          if (!owns(p[0])) return { rows: [] };
          const submitted = p[1] as boolean;
          return { rows: [{ submitted, submitted_at: submitted ? "2026-10-18T02:00:00Z" : null, reference: submitted ? p[2] : null }] };
        }
        return { rows: [] };
      },
    }),
}));

const { GET: GET_COMPLAINT } = await import("@/app/api/v1/me/complaints/[id]/route");
const { GET: GET_CORRECTION } = await import("@/app/api/v1/me/corrections/[id]/route");
const { POST: POST_HANDOFF } = await import("@/app/api/v1/me/reports/[kind]/[id]/mynaga/route");

const getComplaint = (id = COMPLAINT_ID) =>
  GET_COMPLAINT(new Request(`http://localhost/api/v1/me/complaints/${id}`), { params: Promise.resolve({ id }) } as never);
const getCorrection = (id = CORRECTION_ID) =>
  GET_CORRECTION(new Request(`http://localhost/api/v1/me/corrections/${id}`), { params: Promise.resolve({ id }) } as never);
const handoff = (body: unknown, kind = "complaint", id = COMPLAINT_ID) =>
  POST_HANDOFF(
    new Request(`http://localhost/api/v1/me/reports/${kind}/${id}/mynaga`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ kind, id }) } as never,
  );

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
  state.owners = new Map([
    [COMPLAINT_ID, OWNER.id],
    [CORRECTION_ID, OWNER.id],
  ]);
  state.calls = [];
  state.queries = [];
  state.authorized = [];
  logged = [];
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});

describe("GET /api/v1/me/complaints/[id]", () => {
  it("returns the owner report with reporter-visible events and the self-reported handoff", async () => {
    const res = await getComplaint();
    expect(res.status).toBe(200);
    expectPrivate(res);
    const { complaint } = complaintDetailResponseSchema.parse(await res.json());
    expect(complaint).toMatchObject({ reference: "PN-7KQ4-2M", description: "Asked for 40 pesos.", plate: "ABC 1234", locationText: "Near Centro" });
    expect(complaint.events.map((e) => e.status)).toEqual(["submitted", "under_review"]);
    expect(complaint.handoff).toEqual({ submitted: true, submittedAt: "2026-10-18T02:00:00.000Z", reference: SECRET_REF });
    expect(state.authorized).toEqual(["complaint.submit"]);
    // Only reporter-visible events are asked for; reviewer-only notes never leave the database.
    expect(state.queries.find((q) => q.text.includes("priv.complaint_event"))?.text).toContain("visibility = 'reporter'");
  });

  it("answers another person's report and a malformed id with the same 404", async () => {
    state.user = OTHER;
    await expectError(await getComplaint(), 404, "not_found");
    state.user = OWNER;
    await expectError(await getComplaint("not-a-uuid"), 404, "not_found");
  });

  it("answers 401 to guests before touching the database", async () => {
    state.user = null;
    await expectError(await getComplaint(), 401, "unauthorized");
    expect(state.queries).toEqual([]);
  });
});

describe("GET /api/v1/me/corrections/[id]", () => {
  it("returns the author correction with its status events", async () => {
    const res = await getCorrection();
    expect(res.status).toBe(200);
    expectPrivate(res);
    const { correction } = correctionDetailResponseSchema.parse(await res.json());
    expect(correction).toMatchObject({ category: "wrong_curb_side", status: "accepted", description: "The stop is on the other side." });
    expect(correction.events.map((e) => e.status)).toEqual(["submitted", "accepted"]);
    expect(state.authorized).toEqual(["correction.submit"]);
  });

  it("answers another person's correction with 404", async () => {
    state.user = OTHER;
    await expectError(await getCorrection(), 404, "not_found");
  });
});

describe("POST /api/v1/me/reports/[kind]/[id]/mynaga", () => {
  it("records the self-report through the definer function and answers with it", async () => {
    const res = await handoff({ submitted: true, reference: ` ${SECRET_REF} ` });
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(myNagaHandoffResponseSchema.parse(await res.json()).handoff).toEqual({ submitted: true, submittedAt: "2026-10-18T02:00:00.000Z", reference: SECRET_REF });
    expect(state.authorized).toEqual(["complaint.submit"]);
    expect(state.calls).toEqual(["rate", "handoff"]);
    const q = state.queries.find((x) => x.text.includes("priv.set_mynaga_handoff"));
    expect(q?.userId).toBe(OWNER.id);
    expect(q?.params).toEqual([COMPLAINT_ID, true, SECRET_REF]);
  });

  it("can take the note back, which clears the reference", async () => {
    const body = myNagaHandoffResponseSchema.parse(await (await handoff({ submitted: false })).json());
    expect(body.handoff).toEqual({ submitted: false, submittedAt: null, reference: null });
  });

  it("answers another person's report, a correction and a malformed id with 404", async () => {
    state.user = OTHER;
    await expectError(await handoff({ submitted: true }), 404, "not_found");
    state.user = OWNER;
    await expectError(await handoff({ submitted: true }, "correction", CORRECTION_ID), 404, "not_found");
    await expectError(await handoff({ submitted: true }, "complaint", "nope"), 404, "not_found");
  });

  it("refuses unknown fields, a long reference and a reference without the flag before the database", async () => {
    state.calls = [];
    await expectError(await handoff({ submitted: true, status: "closed" }), 400, "bad_request");
    await expectError(await handoff({ submitted: true, reference: "x".repeat(65) }), 400, "bad_request");
    await expectError(await handoff({ submitted: false, reference: "MN-1" }), 400, "bad_request");
    expect(state.calls).toEqual([]);
  });

  it("answers 401 to guests and 429 when rate limited, without calling the function", async () => {
    state.user = null;
    await expectError(await handoff({ submitted: true }), 401, "unauthorized");
    state.user = OWNER;
    state.rateLimited = true;
    await expectError(await handoff({ submitted: true }), 429, "too_many_requests");
    expect(state.calls).not.toContain("handoff");
  });

  it("never logs the reference or any report text, even on failure", async () => {
    await handoff({ submitted: true, reference: SECRET_REF });
    await getComplaint();
    state.user = null;
    await handoff({ submitted: true, reference: SECRET_REF });
    expect(logged.join("\n")).not.toContain(SECRET_REF);
    expect(logged.join("\n")).not.toContain("Asked for 40 pesos");
  });
});
