// Step-up verification (spec 05 §5.4, N3): a fresh email code within the last 15 minutes before
// an action on private originals. The database decides (core.step_up_apply +
// priv.require_step_up, migration 0022); these constants and checks mirror it so the server can
// answer early and tests can pin the window without a database.
import { z } from "zod";

/** A verification counts for this long (priv.require_step_up: interval '15 minutes'). */
export const STEP_UP_WINDOW_MS = 15 * 60_000;
/** Clock skew tolerated for a verification time in the future (interval '1 minute'). */
export const STEP_UP_MAX_SKEW_MS = 60_000;
/** A sent code can be used for this long (core.step_up_pending: interval '10 minutes'). */
export const STEP_UP_CHALLENGE_MS = 10 * 60_000;

/** Error code a protected endpoint answers with (403) when the caller must verify again. */
export const STEP_UP_REQUIRED = "step_up_required" as const;

/** True when `verifiedAt` is a verification inside the window at `now`. */
export function isStepUpFresh(verifiedAt: Date | null | undefined, now: Date): boolean {
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime())) return false;
  const age = now.getTime() - verifiedAt.getTime();
  return age <= STEP_UP_WINDOW_MS && age >= -STEP_UP_MAX_SKEW_MS;
}

/** POST /api/v1/me/step-up body: the code from the email (Neon Auth sends digits). */
export const stepUpVerifyPayloadSchema = z
  .object({ code: z.string().trim().regex(/^[0-9A-Za-z]{4,12}$/) })
  .strict();

export const stepUpVerifyResponseSchema = z.object({ verifiedUntil: z.iso.datetime() });
export const stepUpCodeResponseSchema = z.object({ sent: z.literal(true) });

/** Whether an error body from a protected endpoint asks for step-up. */
export function isStepUpRequiredBody(body: unknown): boolean {
  return (body as { error?: { code?: unknown } } | null)?.error?.code === STEP_UP_REQUIRED;
}
