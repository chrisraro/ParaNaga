import { createHash } from "node:crypto";
import { parseUuidParam } from "@/domain/api/schemas";
import { walkGraphPayloadSchema } from "@/domain/walk/format";
import { badRequest, CACHE, notFound, publicText, unavailable } from "@/server/api/http";
import { getWalkGraph } from "@/server/repos/network-repo";

// The on-device walk graph of the currently published revision (J2, D7, D18): the stored payload
// (Task 6 format v1) served verbatim as application/json with ETag = its sha256, immutable. It is
// checked before it is sent: the stored size and sha256 must describe the text and the text must
// parse as format v1, else 503 (never cached). 404 for a revision that is not the published one,
// or one published without a walk graph.
export function GET(request: Request, ctx: RouteContext<"/api/v1/network/walk-graph/[revisionId]">) {
  return publicText(request, "network/walk-graph", async ({ withDb }) => {
    const id = parseUuidParam((await ctx.params).revisionId, "revisionId");
    if (!id.ok) throw badRequest(id.message);
    const read = await withDb((db) => getWalkGraph(db, id.value));
    if (read.status === "not_published") throw notFound("This revision is not the published network.");
    if (read.status === "none") throw notFound("This revision has no walk graph.");
    if (!isIntact(read.payload, read.sha256, read.bytes)) throw unavailable("The walk graph could not be read completely. Try again.");
    return { text: read.payload, contentType: "application/json", cacheControl: CACHE.immutable, etag: read.sha256 };
  });
}

function isIntact(payload: string, sha256: string, bytes: number): boolean {
  if (Buffer.byteLength(payload, "utf8") !== bytes) return false;
  if (createHash("sha256").update(payload, "utf8").digest("hex") !== sha256) return false;
  try {
    return walkGraphPayloadSchema.safeParse(JSON.parse(payload)).success;
  } catch {
    return false;
  }
}
