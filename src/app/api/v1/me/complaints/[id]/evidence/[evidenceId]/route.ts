import { getMyEvidenceUrl } from "@/server/complaints/handlers";

// A 60 s signed link to one of the caller's own evidence files. Private, never cached, audited.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/me/complaints/[id]/evidence/[evidenceId]">) {
  const { id, evidenceId } = await ctx.params;
  return getMyEvidenceUrl(request, id, evidenceId);
}
