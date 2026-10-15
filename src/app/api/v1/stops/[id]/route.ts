import { parseUuidParam, stopDetailSchema } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision, getStopDetail } from "@/server/repos/network-repo";

export function GET(request: Request, ctx: RouteContext<"/api/v1/stops/[id]">) {
  return publicGet(request, "stops/:id", stopDetailSchema, async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).id, "id");
    if (!id.ok) throw badRequest(id.message);
    return withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const detail = await getStopDetail(db, revision.revisionId, id.value);
      if (!detail) throw notFound("No published stop has this id.");
      return { body: { revision, ...detail }, cacheControl: CACHE.list };
    });
  });
}
