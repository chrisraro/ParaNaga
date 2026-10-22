import { postValidate } from "@/server/admin/handlers";

// Publication validation of one revision (N5a, F-E11); the report is stored on the revision.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/revisions/[id]/validate">) {
  return postValidate(request, ctx.params);
}
