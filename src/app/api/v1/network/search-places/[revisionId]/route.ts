import { parseUuidParam, searchPlacesSchema } from "@/domain/api/schemas";
import { buildSearchPlaces } from "@/domain/search/index-build";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getSearchPlacesSource } from "@/server/repos/reference-repo";

// Task 14: the named OpenStreetMap places outside the D10 categories (restaurants, shops, banks,
// ...) of the published revision, fetched lazily by the browser after the search index. Same rules
// as network/search-index: immutable for the published revision only, 404 once superseded or
// unknown. An empty list is a complete answer (a revision imported before Task 14).
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/search-places/[revisionId]">) {
  return publicGet(request, "network/search-places", searchPlacesSchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const source = await withDb((db) => getSearchPlacesSource(db, id.value));
    if (!source) throw notFound("This revision is not the published network.");
    return { body: buildSearchPlaces(source), cacheControl: CACHE.immutable };
  });
}
