import { toggleBookmark } from "@/server/community/handlers-index";

export function POST(request: Request) {
  return toggleBookmark(request);
}
