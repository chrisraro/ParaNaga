import { postRollback } from "@/server/admin/handlers";

// Roll back to an earlier published revision (N5a, F-E11). Needs a fresh step-up.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/revisions/[id]/rollback">) {
  return postRollback(request, ctx.params);
}
