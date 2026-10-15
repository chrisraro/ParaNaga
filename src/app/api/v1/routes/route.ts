import { routeListSchema } from "@/domain/api/schemas";
import { CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision, listRoutes } from "@/server/repos/network-repo";

export function GET(request: Request) {
  return publicGet(request, "routes", routeListSchema, async ({ withDb }) =>
    withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const groups = await listRoutes(db, revision.revisionId);
      return { body: { revision, groups }, cacheControl: CACHE.list };
    }),
  );
}
