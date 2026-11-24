import { postTakeDown } from "@/server/admin/review-handlers";

// Unpublish a published post, comment or photo (migration 0032); community_moderator or admin.
export function POST(request: Request) {
  return postTakeDown(request);
}
