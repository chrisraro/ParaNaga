import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isStepUpFresh } from "@/domain/auth/step-up";
import type { Db } from "@/server/db/context";
import { getAuthSession } from "./session";

// Step-up verification, server side (spec 05 §5.4, N3, migration 0022). The record lives in
// core.step_up, one row per (user, Neon Auth session). Protected handlers call applyStepUp() as the
// first statement of the SAME transaction as the protected query: it sets app.step_up_at from that
// record (transaction-local), and the definer function then calls priv.require_step_up(), which
// fails closed. Nothing here trusts a client claim: the session comes from Neon Auth's validated
// getSession(), and the time from the database.

/** The session id is not stored as is: core.step_up keys rows by its SHA-256. */
export function sessionKey(sessionId: string): string {
  return createHash("sha256").update(`paranaga-step-up|${sessionId}`).digest("hex");
}

/** The step-up key of this request's session, or null (no session id: step-up can never pass). */
export async function currentStepUpKey(userId: string): Promise<string | null> {
  const session = await getAuthSession();
  if (!session || session.userId !== userId || !session.sessionId) return null;
  return sessionKey(session.sessionId);
}

/**
 * Sets app.step_up_at for the rest of this transaction from the session's last verification.
 * True when it is fresh; the database gate (priv.require_step_up) decides again on its own.
 */
export async function applyStepUp(db: Db, key: string | null, now: Date = new Date()): Promise<boolean> {
  if (!key) {
    await db.execute(sql`select set_config('app.step_up_at', '', true)`);
    return false;
  }
  const res = await db.execute<{ at: Date | string | null }>(sql`select core.step_up_apply(${key}) as at`);
  const raw = res.rows[0]?.at;
  return raw != null && isStepUpFresh(new Date(raw), now);
}

/** The database refused for lack of step-up (priv.require_step_up raised 42501 'step-up required'). */
export function isStepUpError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  const message = String(e?.cause?.message ?? e?.message ?? "");
  return code === "42501" && message.includes("step-up required");
}
