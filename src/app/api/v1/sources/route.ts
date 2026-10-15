import { sourceListSchema } from "@/domain/api/schemas";
import { INDEX_CODE_SOURCE_CODES } from "@/domain/search/legacy-route-names";
import { CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision } from "@/server/repos/network-repo";
import { listSources } from "@/server/repos/reference-repo";

// The sources register: every source the published revision cites, plus the sources the search
// index cites from code (S28 behind the legacy-name hints), ordered by code.
export function GET(request: Request) {
  return publicGet(request, "sources", sourceListSchema, async ({ withDb }) =>
    withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const sources = await listSources(db, revision.revisionId, INDEX_CODE_SOURCE_CODES);
      return { body: { revision, sources }, cacheControl: CACHE.reference };
    }),
  );
}
