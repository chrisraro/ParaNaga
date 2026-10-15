import { isCompleteSearchIndex, parseUuidParam, searchIndexSchema } from "@/domain/api/schemas";
import { buildSearchIndex } from "@/domain/search/index-build";
import { badRequest, CACHE, notFound, publicGet, unavailable } from "@/server/api/http";
import { getSearchIndexSource } from "@/server/repos/reference-repo";

// The search index of the currently published revision (decision D1: searched in the browser, so
// no query ever reaches the server). Same rules as network/snapshot: immutable for the published
// revision only, 404 once superseded or unknown, and an incomplete read is never cached (503).
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/search-index/[revisionId]">) {
  return publicGet(request, "network/search-index", searchIndexSchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const source = await withDb((db) => getSearchIndexSource(db, id.value));
    if (!source) throw notFound("This revision is not the published network.");
    const index = buildSearchIndex(source);
    if (!isCompleteSearchIndex(index)) throw unavailable("The search index could not be read completely. Try again.");
    return { body: index, cacheControl: CACHE.immutable };
  });
}
