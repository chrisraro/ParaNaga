import "server-only";
import { cronAuthorized } from "@/server/cron-auth";
import { serverEnv } from "@/server/env";
import { safeRequestId } from "@/server/request-id";
import { withRequestContext } from "@/server/db/context";
import { enqueueJob, runJobBatch } from "@/server/jobs/worker";
import { registerDefaultJobHandlers } from "@/server/jobs/handlers";

/** Queued by every run; the fixed key (the kind) keeps one open at a time, and a finished one recurs. */
const RECURRING = ["sweep_orphan_media", "retention_purge", "photo_removal"] as const;

/**
 * Background job runner endpoint called by Vercel Cron once a day (vercel.json).
 * Protected by CRON_SECRET (Bearer token in Authorization header).
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  const headers = { "X-Request-Id": requestId, "Cache-Control": "private, no-store" };

  if (!cronAuthorized(request, serverEnv().CRON_SECRET)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Invalid or missing cron secret.", requestId } },
      { status: 401, headers },
    );
  }

  // Ensure standard handlers are registered
  registerDefaultJobHandlers();

  try {
    // The orphan media sweep (spec 05 §5.8), the rate-limit purge (spec 04 §4.4) and photos of removed posts (0036).
    await withRequestContext({ userId: null, requestId }, async (db) => {
      for (const kind of RECURRING) await enqueueJob(db, kind, {}, { idempotencyKey: kind });
    });
    const summary = await runJobBatch({ batchSize: 20 });
    return Response.json(
      { ok: true, summary, requestId },
      { status: 200, headers },
    );
  } catch (err: unknown) {
    const error = err instanceof Error ? err.name : "unknown";
    console.error(JSON.stringify({ event: "cron_jobs_error", requestId, error }));
    return Response.json(
      { error: { code: "internal", message: "Failed to run job batch.", requestId } },
      { status: 500, headers },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return GET(request);
}
