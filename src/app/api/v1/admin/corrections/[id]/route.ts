import { postCorrectionReview } from "@/server/admin/review-handlers";

// One reviewer action on a correction (N6, C9): start review, ask for information, reject, duplicate, accept into the draft.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/corrections/[id]">) {
  return postCorrectionReview(request, ctx.params);
}
