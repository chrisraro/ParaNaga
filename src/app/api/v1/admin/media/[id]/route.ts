import { getReviewMedia } from "@/server/admin/review-handlers";

// A private photo the reviewer is reviewing, streamed from the private bucket; each read audited (N6).
export function GET(request: Request, ctx: RouteContext<"/api/v1/admin/media/[id]">) {
  return getReviewMedia(request, ctx.params);
}
