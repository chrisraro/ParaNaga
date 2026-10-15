import { buildPlanResponse, parsePlanRequest, planResponseSchema, PLAN_BODY_MAX_BYTES } from "@/domain/api/plan";
import { isCompleteSnapshot } from "@/domain/api/schemas";
import { planTrip } from "@/domain/planner/plan";
import { badRequest, CACHE, notFound, publicPost, readJsonBody, unavailable } from "@/server/api/http";
import { getPublishedRevision, getSnapshot } from "@/server/repos/network-repo";

// Provisional trip planning over the published network (Loops A and B today). The body is two
// points inside Naga City; it is validated before the database is touched. The snapshot is
// read in one read-only transaction and planned in memory. Coordinates are personal data: the
// response is never cached (no-store) and nothing here logs the body or the points.
export function POST(request: Request) {
  return publicPost(request, "plan", planResponseSchema, async ({ withDb }) => {
    const parsed = parsePlanRequest(await readJsonBody(request, PLAN_BODY_MAX_BYTES));
    if (!parsed.ok) throw badRequest(parsed.message);

    const snapshot = await withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      return revision ? getSnapshot(db, revision.revisionId) : null;
    });
    if (!snapshot) throw notFound("No network revision is published.");
    if (!isCompleteSnapshot(snapshot)) throw unavailable("The published network could not be read completely. Try again.");

    const plan = planTrip(snapshot, parsed.value.origin, parsed.value.destination);
    return { body: buildPlanResponse(snapshot, plan), cacheControl: CACHE.none };
  });
}
