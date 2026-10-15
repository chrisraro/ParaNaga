import { parseRouteCodeParam, routeDetailSchema } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision, getRouteDetail } from "@/server/repos/network-repo";

export function GET(request: Request, ctx: RouteContext<"/api/v1/routes/[code]">) {
  return publicGet(request, "routes/:code", routeDetailSchema, async ({ withDb }) => {
    const code = parseRouteCodeParam((await ctx.params).code);
    if (!code.ok) throw badRequest(code.message);
    return withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const detail = await getRouteDetail(db, revision.revisionId, code.value);
      if (!detail) throw notFound("No published route has this code.");
      return { body: { revision, ...detail }, cacheControl: CACHE.list };
    });
  });
}
