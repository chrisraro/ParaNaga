import "server-only";
import { runEvidenceRetention } from "@/server/complaints/retention";
import { cronAuthorized } from "@/server/cron-auth";
import { withRequestContext } from "@/server/db/context";
import { serverEnv } from "@/server/env";
import { safeRequestId } from "@/server/request-id";
import { getStorage, MemoryStorageAdapter } from "@/server/storage/adapter";

/**
 * Driver-evidence retention purge (N7; spec 04 §4.8). Called by a scheduler with
 * `Authorization: Bearer $CRON_SECRET` (never a query-string secret) and an explicit mode:
 *   /api/cron/retention?mode=dry-run   lists and counts what is due, deletes nothing
 *   /api/cron/retention?mode=commit    deletes objects and rows together
 * No default mode, so a misconfigured call does nothing. Vercel Cron calls commit once a day
 * (vercel.json, docs/setup.md). Without a configured object store a commit is refused: the in-memory
 * stand-in would report every object deleted and the rows would go without their files. Runs as the system (no user), which the database functions require.
 * The answer carries counts only, never ids, keys or report text.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  const headers = { "X-Request-Id": requestId, "Cache-Control": "private, no-store" };
  if (!cronAuthorized(request, serverEnv().CRON_SECRET)) {
    return Response.json({ error: { code: "unauthorized", message: "Invalid or missing cron secret.", requestId } }, { status: 401, headers });
  }
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== "dry-run" && mode !== "commit") {
    return Response.json({ error: { code: "bad_request", message: "mode must be dry-run or commit.", requestId } }, { status: 400, headers });
  }
  const storage = getStorage();
  if (mode === "commit" && storage instanceof MemoryStorageAdapter) {
    return Response.json({ error: { code: "unavailable", message: "Object storage is not configured.", requestId } }, { status: 503, headers });
  }
  try {
    const summary = await runEvidenceRetention({
      dryRun: mode === "dry-run",
      storage,
      asSystem: (fn) => withRequestContext({ userId: null, requestId }, fn),
    });
    return Response.json({ ok: true, summary, requestId }, { status: 200, headers });
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: "cron_retention_error", requestId, error: err instanceof Error ? err.name : "unknown" }));
    return Response.json({ error: { code: "internal", message: "The retention run failed.", requestId } }, { status: 500, headers });
  }
}

export function POST(request: Request): Promise<Response> {
  return GET(request);
}
