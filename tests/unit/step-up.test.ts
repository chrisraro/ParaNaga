// Step-up verification (N3): the window logic, and the two endpoints that send and check the
// emailed code. Neon Auth (email OTP) and the database are mocked; the SQL side is pinned in
// step-up-migration.test.ts and run live in tests/integration/step-up-rls.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import {
  isStepUpFresh,
  isStepUpRequiredBody,
  STEP_UP_MAX_SKEW_MS,
  STEP_UP_WINDOW_MS,
  stepUpVerifyPayloadSchema,
  stepUpVerifyResponseSchema,
} from "@/domain/auth/step-up";

const NOW = new Date("2026-10-22T05:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("step-up window (mirrors priv.require_step_up)", () => {
  it("passes for a verification inside 15 minutes, edges included", () => {
    expect(isStepUpFresh(NOW, NOW)).toBe(true);
    expect(isStepUpFresh(ago(60_000), NOW)).toBe(true);
    expect(isStepUpFresh(ago(STEP_UP_WINDOW_MS), NOW)).toBe(true);
  });

  it("fails when stale, missing, invalid or too far in the future", () => {
    expect(isStepUpFresh(ago(STEP_UP_WINDOW_MS + 1), NOW)).toBe(false);
    expect(isStepUpFresh(ago(60 * 60_000), NOW)).toBe(false);
    expect(isStepUpFresh(null, NOW)).toBe(false);
    expect(isStepUpFresh(undefined, NOW)).toBe(false);
    expect(isStepUpFresh(new Date("nonsense"), NOW)).toBe(false);
    expect(isStepUpFresh(ago(-STEP_UP_MAX_SKEW_MS), NOW)).toBe(true);
    expect(isStepUpFresh(ago(-STEP_UP_MAX_SKEW_MS - 1), NOW)).toBe(false);
  });

  it("is 15 minutes, as spec 05 §5.4 and the SQL say", () => {
    expect(STEP_UP_WINDOW_MS).toBe(15 * 60_000);
  });

  it("recognises the step-up error body only", () => {
    expect(isStepUpRequiredBody({ error: { code: "step_up_required", message: "x", requestId: "r" } })).toBe(true);
    expect(isStepUpRequiredBody({ error: { code: "forbidden" } })).toBe(false);
    expect(isStepUpRequiredBody(null)).toBe(false);
  });

  it("accepts a code and nothing else", () => {
    expect(stepUpVerifyPayloadSchema.safeParse({ code: " 123456 " }).success).toBe(true);
    expect(stepUpVerifyPayloadSchema.safeParse({ code: "12" }).success).toBe(false);
    expect(stepUpVerifyPayloadSchema.safeParse({ code: "12345'; drop" }).success).toBe(false);
    expect(stepUpVerifyPayloadSchema.safeParse({ code: "123456", userId: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- endpoints

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  session: null as { userId: string; sessionId: string | null; email: string | null } | null,
  rateLimited: false,
  pending: true,
  otp: "123456",
  upstreamDown: false,
  calls: [] as string[],
  params: [] as unknown[][],
  sends: [] as { email: string; type: string }[],
  checks: [] as { email: string; type: string; otp: string }[],
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const params = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => !(typeof c === "object" && c && "value" in c));

vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => state.user,
  getAuthSession: async () => state.session,
}));
vi.mock("@/server/auth/neon", () => ({
  neonAuth: () => ({
    emailOtp: {
      sendVerificationOtp: async (args: { email: string; type: string }) => {
        state.sends.push(args);
        return state.upstreamDown ? { data: null, error: { status: 502, message: "down" } } : { data: { success: true }, error: null };
      },
      checkVerificationOtp: async (args: { email: string; type: string; otp: string }) => {
        state.checks.push(args);
        if (state.upstreamDown) return { data: null, error: { status: 502, message: "down" } };
        return args.otp === state.otp
          ? { data: { success: true }, error: null }
          : { data: null, error: { status: 400, code: "INVALID_OTP", message: "Invalid OTP" } };
      },
    },
  }),
}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        const p = params(q);
        if (t.includes("ops.take_token")) {
          state.calls.push("rate");
          return { rows: [{ ok: !state.rateLimited }] };
        }
        if (t.includes("core.step_up_begin")) {
          state.calls.push("begin");
          state.params.push(p);
          return { rows: [] };
        }
        if (t.includes("core.step_up_pending")) {
          state.calls.push("pending");
          return { rows: [{ pending: state.pending }] };
        }
        if (t.includes("core.step_up_finish")) {
          state.calls.push(`finish:${String(p[1])}`);
          state.params.push(p);
          return { rows: [{ at: p[1] === true && state.pending ? NOW : null }] };
        }
        return { rows: [] };
      },
    }),
}));

const { POST: SEND } = await import("@/app/api/v1/me/step-up/code/route");
const { POST: VERIFY } = await import("@/app/api/v1/me/step-up/route");

const req = (url: string, body: unknown, type = "application/json") =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
const send = () => SEND(req("/api/v1/me/step-up/code", {}));
const verify = (code: unknown) => VERIFY(req("/api/v1/me/step-up", { code }));

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(apiErrorSchema.parse(await res.json()).error.code).toBe(code);
}

let logged: string[];
beforeEach(() => {
  state.user = { id: "user-1", name: "A", roles: ["commuter"] };
  state.session = { userId: "user-1", sessionId: "sess-1", email: "a@example.com" };
  state.rateLimited = false;
  state.pending = true;
  state.upstreamDown = false;
  state.calls = [];
  state.params = [];
  state.sends = [];
  state.checks = [];
  logged = [];
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
});

describe("POST /api/v1/me/step-up/code", () => {
  it("opens a challenge for this session, then has Neon Auth email a sign-in code", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ sent: true });
    expect(state.calls).toEqual(["rate", "rate", "begin"]);
    expect(String(state.params[0]![0])).toMatch(/^[0-9a-f]{64}$/);
    expect(state.sends).toEqual([{ email: "a@example.com", type: "sign-in" }]);
  });

  it("answers 401 to guests and to a request without a Neon Auth session id", async () => {
    state.user = null;
    await expectError(await send(), 401, "unauthorized");
    state.user = { id: "user-1", name: "A", roles: ["commuter"] };
    state.session = { userId: "user-1", sessionId: null, email: "a@example.com" };
    await expectError(await send(), 401, "unauthorized");
    expect(state.sends).toEqual([]);
  });

  it("refuses suspended accounts (no roles)", async () => {
    state.user = { id: "user-1", name: "A", roles: [] };
    await expectError(await send(), 403, "forbidden");
  });

  it("rate-limits code requests without sending anything", async () => {
    state.rateLimited = true;
    await expectError(await send(), 429, "too_many_requests");
    expect(state.sends).toEqual([]);
  });

  it("takes JSON only (a cross-site form cannot trigger emails)", async () => {
    await expectError(await SEND(req("/api/v1/me/step-up/code", {}, "text/plain")), 400, "bad_request");
    expect(state.sends).toEqual([]);
  });

  it("answers 503 when Neon Auth cannot send", async () => {
    state.upstreamDown = true;
    await expectError(await send(), 503, "unavailable");
  });
});

describe("POST /api/v1/me/step-up", () => {
  it("a right code: Neon Auth checks it, the server records the step-up for 15 minutes", async () => {
    const res = await verify("123456");
    expect(res.status).toBe(200);
    const body = stepUpVerifyResponseSchema.parse(await res.json());
    expect(new Date(body.verifiedUntil).getTime()).toBe(NOW.getTime() + STEP_UP_WINDOW_MS);
    expect(state.checks).toEqual([{ email: "a@example.com", type: "sign-in", otp: "123456" }]);
    expect(state.calls).toEqual(["rate", "rate", "pending", "finish:true"]);
  });

  it("a wrong code: 400, the failure is recorded (audited in SQL), nothing is verified", async () => {
    await expectError(await verify("654321"), 400, "bad_request");
    expect(state.calls).toContain("finish:false");
  });

  it("no open challenge for this session: 400 without asking Neon Auth", async () => {
    state.pending = false;
    await expectError(await verify("123456"), 400, "bad_request");
    expect(state.checks).toEqual([]);
  });

  it("rate-limits checks before Neon Auth sees the code", async () => {
    state.rateLimited = true;
    await expectError(await verify("123456"), 429, "too_many_requests");
    expect(state.checks).toEqual([]);
  });

  it("refuses a malformed body or extra fields", async () => {
    await expectError(await verify("12"), 400, "bad_request");
    await expectError(await VERIFY(req("/api/v1/me/step-up", { code: "123456", verifiedAt: NOW.toISOString() })), 400, "bad_request");
    expect(state.checks).toEqual([]);
  });

  it("answers 503 when Neon Auth cannot check, without recording a failure", async () => {
    state.upstreamDown = true;
    await expectError(await verify("123456"), 503, "unavailable");
    expect(state.calls.some((c) => c.startsWith("finish"))).toBe(false);
  });

  it("never logs the code or the email, even on a server error", async () => {
    state.session = { userId: "user-1", sessionId: "sess-1", email: "a@example.com" };
    await verify("999999");
    await verify("123456");
    expect(logged.join("\n")).not.toMatch(/999999|123456|a@example\.com/);
  });
});
