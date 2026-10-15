import { networkHeadSchema } from "@/domain/api/schemas";
import { CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision } from "@/server/repos/network-repo";

// The published revision clients compare against their cached snapshot.
export function GET(request: Request) {
  return publicGet(request, "network/head", networkHeadSchema, async ({ withDb }) => {
    const revision = await withDb(getPublishedRevision);
    if (!revision) throw notFound("No network revision is published.");
    return { body: revision, cacheControl: CACHE.head };
  });
}
