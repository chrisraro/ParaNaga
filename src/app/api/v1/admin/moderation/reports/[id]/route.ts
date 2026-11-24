import { postReportResolution } from "@/server/admin/review-handlers";

// Close the open content reports on one post or comment (migration 0032); community_moderator or admin.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/moderation/reports/[id]">) {
  return postReportResolution(request, ctx.params);
}
