import { parseBbox, stopsInBboxSchema } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision, getStopsInBbox } from "@/server/repos/network-repo";

// Candidate pins inside ?bbox=w,s,e,n (within the Naga map bounds). The bbox is never logged.
export function GET(request: Request) {
  return publicGet(request, "stops", stopsInBboxSchema, async ({ withDb }) => {
    const bbox = parseBbox(new URL(request.url).searchParams.get("bbox"));
    if (!bbox.ok) throw badRequest(bbox.message);
    return withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const stops = await getStopsInBbox(db, revision.revisionId, bbox.value);
      return { body: { revision, stops }, cacheControl: CACHE.list };
    });
  });
}
