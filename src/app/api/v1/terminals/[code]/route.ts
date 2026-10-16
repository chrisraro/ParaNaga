import { parseTerminalCodeParam, terminalDetailSchema } from "@/domain/api/schemas";
import { badRequest, CACHE, notFound, publicGet } from "@/server/api/http";
import { getPublishedRevision } from "@/server/repos/network-repo";
import { getTerminalDetail } from "@/server/repos/reference-repo";

// A terminal of the published revision: its fields (an OpenStreetMap coordinate with its provenance
// when one is on file), the routes whose legal street list or trial circuit names it, the regional
// services leaving from it with fare ESTIMATES (the only place regional fare rules appear), its
// destination categories and their sources.
export function GET(request: Request, ctx: RouteContext<"/api/v1/terminals/[code]">) {
  return publicGet(request, "terminals/:code", terminalDetailSchema, async ({ withDb }) => {
    const code = parseTerminalCodeParam((await ctx.params).code);
    if (!code.ok) throw badRequest(code.message);
    return withDb(async (db) => {
      const revision = await getPublishedRevision(db);
      if (!revision) throw notFound("No network revision is published.");
      const detail = await getTerminalDetail(db, revision.revisionId, code.value);
      if (!detail) throw notFound("No published terminal has this code.");
      return { body: { revision, ...detail }, cacheControl: CACHE.reference };
    });
  });
}
