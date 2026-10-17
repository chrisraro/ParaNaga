import "server-only";
import { serverEnv } from "@/server/env";
import { safeRequestId } from "@/server/request-id";
import { runJobBatch } from "@/server/jobs/worker";
import { registerDefaultJobHandlers } from "@/server/jobs/handlers";

export const dynamic = "force-dynamic";

/**
 * Background job runner endpoint called by Vercel Cron or Neon scheduled trigger.
 * Protected by CRON_SECRET (Bearer token in Authorization header).
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  const env = serverEnv();

  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : new URL(request.url).searchParams.get("secret");

  if (!env.CRON_SECRET || providedSecret !== env.CRON_SECRET) {
    return Response.json(
      { error: { code: "unauthorized", message: "Invalid or missing cron secret.", requestId } },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  // Ensure standard handlers are registered
  registerDefaultJobHandlers();

  try {
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
