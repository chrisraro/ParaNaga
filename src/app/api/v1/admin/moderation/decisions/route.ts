import { postModerationDecision } from "@/server/admin/review-handlers";

// A moderator's decision on a pending post, comment or photo (N6, C10).
export function POST(request: Request) {
  return postModerationDecision(request);
}
