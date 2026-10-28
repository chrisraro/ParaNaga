import { intercitySchema, parseUuidParam } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getIntercity } from "@/server/repos/intercity-repo";

// The Leaving Naga guide of the currently published revision (IC1, design §7): a separate
// immutable resource next to the snapshot, cached CacheFirst by the service worker. Destinations,
// services with their departure and fare facts, the regional fare rules they cite and the
// intercity_* dataset notes; status, staleness and estimates are computed on the device, so the
// body never depends on the time it was read. 404 for a revision that is not the published one.
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/intercity/[revisionId]">) {
  return publicGet(request, "network/intercity", intercitySchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const read = await withDb((db) => getIntercity(db, id.value));
    if (read.status === "not_published") throw notFound("This revision is not the published network.");
    return { body: read.body, cacheControl: CACHE.immutable };
  });
}
