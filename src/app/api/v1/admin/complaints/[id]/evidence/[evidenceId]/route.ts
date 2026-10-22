import { postComplaintEvidence } from "@/server/admin/complaint-handlers";

// A 60-second signed link to one evidence file (N7, C11); each issuance is recorded and audited.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/complaints/[id]/evidence/[evidenceId]">) {
  return postComplaintEvidence(request, ctx.params);
}
