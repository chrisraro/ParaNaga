import { getModeration } from "@/server/admin/review-handlers";

// Community moderation queue and appeals (N6, C10 A15/A16).
export function GET(request: Request) {
  return getModeration(request);
}
