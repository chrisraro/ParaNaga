import "server-only";
import { sql } from "drizzle-orm";
import { STEP_UP_WINDOW_MS, stepUpCodeResponseSchema, stepUpVerifyPayloadSchema, stepUpVerifyResponseSchema } from "@/domain/auth/step-up";
import { authedRoute, badRequest, CACHE, forbidden, readJsonBody, tooManyRequests, unauthorized, unavailable } from "@/server/api/http";
import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { neonAuth } from "./neon";
import { getAuthSession, getCurrentUser } from "./session";
import { sessionKey } from "./step-up";

// Step-up endpoints (N3). The one-time code is Neon Auth's own email OTP (Better Auth email-otp
// plugin, type "sign-in"): Neon Auth generates, emails, stores and checks it; ParaNaga never sees
// it except in transit to the check, never stores or logs it. Flow:
//   POST /api/v1/me/step-up/code  -> rate limit, core.step_up_begin (open a 10 min challenge for this
//                                    session, audited), then Neon Auth sends a fresh code.
//   POST /api/v1/me/step-up {code} -> rate limit, a challenge must be open, Neon Auth checks the code,
//                                    core.step_up_finish records verified_at (or the failure; both
//                                    audited) and closes the challenge, so one email gives one step-up.
// Both answer private, no-store. JSON bodies only (readJsonBody), so a cross-site form cannot post.

const BODY_MAX_BYTES = 256;
const OTP_TYPE = "sign-in";
const BAD_CODE = "That code did not work. Check it, or ask for a new one.";

const json = (body: unknown, requestId: string) =>
  Response.json(body, { headers: { "Cache-Control": CACHE.private, "X-Request-Id": requestId } });

async function privateRoute(request: Request, route: string, run: (requestId: string) => Promise<Response>): Promise<Response> {
  const res = await authedRoute(request, route, run);
  res.headers.set("Cache-Control", CACHE.private);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

/** The signed-in, not suspended caller and their Neon Auth session (id + email). */
async function caller() {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (user.roles.length === 0) throw forbidden();
  const session = await getAuthSession();
  if (!session?.sessionId || session.userId !== user.id) throw unauthorized();
  if (!session.email) throw badRequest("This account has no email address to send a code to.");
  const auth = neonAuth();
  if (!auth) throw unavailable("Verification is not available right now.");
  return { user, email: session.email, key: sessionKey(session.sessionId), auth };
}

export function requestStepUpCode(request: Request): Promise<Response> {
  return privateRoute(request, "step-up-code", async (requestId) => {
    await readJsonBody(request, BODY_MAX_BYTES);
    const { user, email, key, auth } = await caller();
    const allowed = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      for (const limit of [RATE_LIMITS.mutationPerMinute, RATE_LIMITS.stepUpSendPerHour]) {
        if (!(await checkRateLimit(db, request, limit, user.id))) return false;
      }
      await db.execute(sql`select core.step_up_begin(${key})`);
      return true;
    });
    if (!allowed) throw tooManyRequests("Too many codes asked for. Wait a while, then try again.");
    const sent = await auth.emailOtp.sendVerificationOtp({ email, type: OTP_TYPE });
    if (sent.error) throw unavailable("The code could not be sent. Try again in a moment.");
    return json(stepUpCodeResponseSchema.parse({ sent: true }), requestId);
  });
}

export function verifyStepUpCode(request: Request): Promise<Response> {
  return privateRoute(request, "step-up-verify", async (requestId) => {
    const parsed = stepUpVerifyPayloadSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest(BAD_CODE);
    const { user, email, key, auth } = await caller();
    const ctx = { userId: user.id, requestId };

    const gate = await withRequestContext(ctx, async (db) => {
      for (const limit of [RATE_LIMITS.mutationPerMinute, RATE_LIMITS.stepUpVerifyPerHour]) {
        if (!(await checkRateLimit(db, request, limit, user.id))) return "rate_limited" as const;
      }
      const res = await db.execute<{ pending: boolean }>(sql`select core.step_up_pending(${key}) as pending`);
      return res.rows[0]?.pending === true ? ("pending" as const) : ("none" as const);
    });
    if (gate === "rate_limited") throw tooManyRequests("Too many tries. Wait a while, then ask for a new code.");
    // No open challenge for this session: the code was not asked for here, or it is too old.
    if (gate === "none") throw badRequest(BAD_CODE);

    const checked = await auth.emailOtp.checkVerificationOtp({ email, type: OTP_TYPE, otp: parsed.data.code });
    if (checked.error && (checked.error.status ?? 0) >= 500) throw unavailable("The code could not be checked. Try again in a moment.");
    const ok = !checked.error && (checked.data as { success?: unknown } | null)?.success === true;

    const at = await withRequestContext(ctx, async (db) => {
      const res = await db.execute<{ at: Date | string | null }>(sql`select core.step_up_finish(${key}, ${ok}) as at`);
      return res.rows[0]?.at ?? null;
    });
    if (!at) throw badRequest(BAD_CODE);
    const verifiedUntil = new Date(new Date(at).getTime() + STEP_UP_WINDOW_MS).toISOString();
    return json(stepUpVerifyResponseSchema.parse({ verifiedUntil }), requestId);
  });
}
