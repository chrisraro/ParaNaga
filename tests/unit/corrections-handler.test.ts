// POST /api/v1/corrections and GET /api/v1/me/corrections: authorize first, strict body, rate
// limit, disclosure gate, Jev is advisory (a failure never blocks), no-store on every response.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import { createCorrectionResponseSchema, myCorrectionsResponseSchema } from "@/domain/corrections/schemas";

const state = vi.hoisted(() => ({
  user: { id: "user-1", name: "A", roles: ["commuter"] } as { id: string; name: string; roles: string[] } | null,
  allowed: true,
  acked: false,
  rateLimited: false,
  dbFail: null as null | { code: string },
  jev: "ok" as "ok" | "throws" | "unavailable" | "reject",
  calls: [] as string[],
  authorized: [] as string[],
}));

const text = (q: unknown): string => {
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
};

vi.mock("@/server/auth/authorize", () => ({
  authorize: async (action: string) => {
    state.authorized.push(action);
    if (!state.user) throw Object.assign(new Error("Not allowed"), { name: "AuthorizationError", reason: "unauthenticated" });
    if (!state.allowed) throw Object.assign(new Error("Not allowed"), { name: "AuthorizationError", reason: "forbidden" });
    return state.user;
  },
}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ AUTO_PUBLISH_ENABLED: false }) }));
vi.mock("@/server/adapters/jev/client", () => ({
  createJevClient: () => ({
    classify: async (input: { kind: string; text: string }) => {
      state.calls.push(`jev:${input.kind}:${input.text}`);
      if (state.jev === "throws") throw new Error("boom");
      if (state.jev === "unavailable") return { status: "unavailable", reason: "timeout" };
      if (state.jev === "reject") return { status: "ok", verdict: { recommendation: "reject", confidence: 0.99 } };
      return { status: "ok", verdict: { recommendation: "publish", confidence: 0.9 } };
    },
  }),
}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        if (t.includes("ops.take_token")) {
          state.calls.push("rate");
          return { rows: [{ ok: !state.rateLimited }] };
        }
        if (t.includes("insert into core.ack")) {
          state.calls.push("ack-insert");
          return { rows: [] };
        }
        if (t.includes("from core.ack")) return { rows: state.acked ? [{ one: 1 }] : [] };
        if (t.includes("submit_correction")) {
          state.calls.push("submit");
          if (state.dbFail) throw Object.assign(new Error("db"), state.dbFail);
          return {
            rows: [
              {
                id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99",
                kind: "wrong_curb_side",
                entity_type: "stop",
                entity_id: "stop-1",
                entity_label: "Plaza",
                status: "submitted",
                submitted_at: "2026-10-18T01:00:00Z",
              },
            ],
          };
        }
        if (t.includes("from community.correction")) {
          state.calls.push("list");
          return {
            rows: [
              {
                id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99",
                kind: "fare_mismatch",
                entity_type: "route",
                entity_id: "R4",
                entity_label: null,
                status: "under_review",
                submitted_at: "2026-10-18T01:00:00Z",
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
}));

const { POST } = await import("@/app/api/v1/corrections/route");
const { GET } = await import("@/app/api/v1/me/corrections/route");

const body = (over: Record<string, unknown> = {}) => ({
  clientRequestId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11",
  category: "wrong_curb_side",
  entityType: "stop",
  entityId: "stop-1",
  entityLabel: "Plaza",
  description: "The sign is on the other side of the road, call 0917 123 4567.",
  aiDisclosureAccepted: true,
  ...over,
});
const post = (b: unknown, raw?: string) =>
  POST(
    new Request("http://localhost/api/v1/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(b),
    }),
  );

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(apiErrorSchema.parse(await res.json()).error.code).toBe(code);
}

beforeEach(() => {
  state.user = { id: "user-1", name: "A", roles: ["commuter"] };
  state.allowed = true;
  state.acked = false;
  state.rateLimited = false;
  state.dbFail = null;
  state.jev = "ok";
  state.calls = [];
  state.authorized = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/v1/corrections", () => {
  it("creates a submitted correction, no-store, schema-valid", async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const parsed = createCorrectionResponseSchema.parse(await res.json());
    expect(parsed.correction.status).toBe("submitted");
    expect(state.authorized).toEqual(["correction.submit"]);
    expect(state.calls).toEqual(["rate", "rate", "ack-insert", expect.stringContaining("jev:community:"), "submit"]);
  });

  it("answers 401 for guests and 403 when not allowed, before touching the database", async () => {
    state.user = null;
    await expectError(await post(body()), 401, "unauthorized");
    state.user = { id: "u", name: "", roles: [] };
    state.allowed = false;
    await expectError(await post(body()), 403, "forbidden");
    expect(state.calls).toEqual([]);
  });

  it("rejects bad bodies with 400 (strict schema, bad JSON, wrong content type)", async () => {
    await expectError(await post(body({ status: "accepted" })), 400, "bad_request");
    await expectError(await post(body({ description: "short" })), 400, "bad_request");
    await expectError(await post(null, "{nope"), 400, "bad_request");
    const res = await POST(
      new Request("http://localhost/api/v1/corrections", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }),
    );
    await expectError(res, 400, "bad_request");
  });

  it("is rate limited per user (429), and nothing is saved", async () => {
    state.rateLimited = true;
    await expectError(await post(body()), 429, "too_many_requests");
    expect(state.calls).not.toContain("submit");
  });

  it("requires the AI disclosure on the first submission, and remembers it after", async () => {
    await expectError(await post(body({ aiDisclosureAccepted: false })), 400, "bad_request");
    expect(state.calls).not.toContain("submit");
    expect(state.calls).not.toContain("ack-insert");
    state.calls = [];
    state.acked = true;
    expect((await post(body({ aiDisclosureAccepted: false }))).status).toBe(201);
    expect(state.calls).not.toContain("ack-insert");
  });

  it("sends only masked text to Jev, as community content", async () => {
    await post(body());
    const jev = state.calls.find((c) => c.startsWith("jev:"))!;
    expect(jev.startsWith("jev:community:")).toBe(true);
    expect(jev).not.toContain("0917");
    expect(jev).toContain("[number]");
  });

  it.each(["throws", "unavailable", "reject"] as const)("never blocks the commuter when Jev is %s", async (mode) => {
    state.jev = mode;
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(createCorrectionResponseSchema.parse(await res.json()).correction.status).toBe("submitted");
  });

  it("maps a rejected photo reference to 400 and other database failures to 500 without leaks", async () => {
    state.dbFail = { code: "22023" };
    await expectError(await post(body()), 400, "bad_request");
    state.dbFail = { code: "XX000" };
    await expectError(await post(body()), 500, "internal");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("0917");
  });
});

describe("GET /api/v1/me/corrections", () => {
  it("lists the caller's own corrections, no-store", async () => {
    const res = await GET(new Request("http://localhost/api/v1/me/corrections"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const parsed = myCorrectionsResponseSchema.parse(await res.json());
    expect(parsed.corrections[0]).toMatchObject({ category: "fare_mismatch", status: "under_review" });
  });
  it("answers 401 for guests", async () => {
    state.user = null;
    await expectError(await GET(new Request("http://localhost/api/v1/me/corrections")), 401, "unauthorized");
  });
});
