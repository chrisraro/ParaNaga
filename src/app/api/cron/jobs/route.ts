import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/server/env";
import { safeRequestId } from "@/server/request-id";
import { withRequestContext } from "@/server/db/context";
import { enqueueJob, runJobBatch } from "@/server/jobs/worker";
import { registerDefaultJobHandlers } from "@/server/jobs/handlers";

/**
 * Compares two secrets in constant time. A query-string secret is never accepted: URLs end up in logs.
 */
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Background job runner endpoint called by Vercel Cron or Neon scheduled trigger.
 * Protected by CRON_SECRET (Bearer token in Authorization header).
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  const env = serverEnv();

  // Validate CRON_SECRET (Authorization header only)
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!secretMatches(providedSecret, env.CRON_SECRET)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Invalid or missing cron secret.", requestId } },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  // Ensure standard handlers are registered
  registerDefaultJobHandlers();

  try {
    // The orphan media sweep (spec 05 §5.8) recurs with this endpoint; the fixed key keeps one queued.
    await withRequestContext({ userId: null, requestId }, (db) =>
      enqueueJob(db, "sweep_orphan_media", {}, { idempotencyKey: "sweep_orphan_media" }),
    );
    const summary = await runJobBatch({ batchSize: 20 });
    return Response.json(
      { ok: true, summary, requestId },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  } catch (err: unknown) {
    const error = err instanceof Error ? err.name : "unknown";
    console.error(JSON.stringify({ event: "cron_jobs_error", requestId, error }));
    return Response.json(
      { error: { code: "internal", message: "Failed to run job batch.", requestId } },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return GET(request);
}
