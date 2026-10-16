import { linesSchema, parseUuidParam } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet, unavailable } from "@/server/api/http";
import { getLines } from "@/server/repos/network-repo";

// The approximate ride paths of the currently published revision (J1, D18): a separate immutable
// resource next to the snapshot. Every path says "Approximate path, not a verified route shape",
// names its road snapshot (OSMR-…) and carries the ODbL attribution; untraced variants are listed
// with their reason. 404 for a revision that is not the published one, or one published without
// paths; an incomplete read (a member variant without its shape row) is never cached: 503.
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/lines/[revisionId]">) {
  return publicGet(request, "network/lines", linesSchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const read = await withDb((db) => getLines(db, id.value));
    if (read.status === "not_published") throw notFound("This revision is not the published network.");
    if (read.status === "none") throw notFound("This revision has no approximate paths.");
    if (read.status === "incomplete") throw unavailable("The approximate paths could not be read completely. Try again.");
    return { body: read.body, cacheControl: CACHE.immutable };
  });
}
