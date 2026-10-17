import { buildPlanResponse, parsePlanRequest, planResponseSchema, PLAN_BODY_MAX_BYTES } from "@/domain/api/plan";
import { isCompleteSnapshot } from "@/domain/api/schemas";
import { planTrip } from "@/domain/planner/plan";
import { badRequest, CACHE, notFound, publicPost, readJsonBody, tooManyRequests, unavailable } from "@/server/api/http";
import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { NetworkIncomplete, planNetwork } from "@/server/repos/network-cache";
import { getPublishedRevision, getSnapshot } from "@/server/repos/network-repo";

// Provisional trip planning over the published network. The body is two points inside Naga City;
// it is validated before the database is touched. The snapshot is read in one read-only
// transaction (with the revision's Lines and street graph, kept in memory per revision) and
// planned in memory. Coordinates are personal data: the response is never cached (no-store) and nothing here logs the body or the points.
export function POST(request: Request) {
  return publicPost(request, "plan", planResponseSchema, async ({ requestId, withDb }) => {
    const parsed = parsePlanRequest(await readJsonBody(request, PLAN_BODY_MAX_BYTES));
    if (!parsed.ok) throw badRequest(parsed.message);

    // Spec §7.8 follow-up: rate limit planning requests (30/min, 600/day). Taking a token writes a counter
    // row, and withDb is a READ ONLY transaction, so it runs in its own short read-write transaction.
    const limited = await withRequestContext({ userId: null, requestId }, async (db) => {
      if (!(await checkRateLimit(db, request, RATE_LIMITS.planPerMinute))) return "minute" as const;
      if (!(await checkRateLimit(db, request, RATE_LIMITS.planPerDay))) return "day" as const;
      return null;
    });
    if (limited === "minute") throw tooManyRequests("Plan rate limit exceeded (max 30 requests per minute).");
    if (limited === "day") throw tooManyRequests("Daily plan rate limit exceeded (max 600 requests per day).");

    const { snapshot, network } = await withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      const snapshot = revision ? await getSnapshot(db, revision.revisionId) : null;
      if (!snapshot) return { snapshot: null, network: null };
      if (!isCompleteSnapshot(snapshot)) return { snapshot, network: null };
      return { snapshot, network: await planNetwork(db, snapshot.revision.revisionId).catch((e: unknown) => (e instanceof NetworkIncomplete ? null : Promise.reject(e))) };
    });
    if (!snapshot) throw notFound("No network revision is published.");
    if (!network) throw unavailable("The published network could not be read completely. Try again.");

    const plan = planTrip(snapshot, network, parsed.value.origin, parsed.value.destination, { now: new Date() });
    return { body: buildPlanResponse(snapshot, plan, network.lines), cacheControl: CACHE.none };
  });
}
