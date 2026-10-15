import { isCompleteSnapshot, networkSnapshotSchema, parseUuidParam } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet, unavailable } from "@/server/api/http";
import { getSnapshot } from "@/server/repos/network-repo";

// Served only for the currently published revision; its content never changes, so it is
// cached as immutable. Superseded revisions are not exposed by the published views: 404.
// An incomplete read is never cached: 503 with no-store.
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/snapshot/[revisionId]">) {
  return publicGet(request, "network/snapshot", networkSnapshotSchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const snapshot = await withDb((db) => getSnapshot(db, id.value));
    if (!snapshot) throw notFound("This revision is not the published network.");
    if (!isCompleteSnapshot(snapshot)) throw unavailable("The published network could not be read completely. Try again.");
    return { body: snapshot, cacheControl: CACHE.immutable };
  });
}
