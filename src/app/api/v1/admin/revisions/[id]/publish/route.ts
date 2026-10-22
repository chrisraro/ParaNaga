import { postPublish } from "@/server/admin/handlers";

// Publish a validated draft (N5a, F-E11). Needs a fresh step-up; one transaction in the database.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/revisions/[id]/publish">) {
  return postPublish(request, ctx.params);
}
