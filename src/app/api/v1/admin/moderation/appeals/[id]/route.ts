import { postAppealResolution } from "@/server/admin/review-handlers";

// Resolve an appeal; never by the moderator who made the decision (N6, C10 A16).
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/moderation/appeals/[id]">) {
  return postAppealResolution(request, ctx.params);
}
