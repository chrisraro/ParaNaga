import { toggleReaction } from "@/server/community/handlers-index";

export function POST(request: Request) {
  return toggleReaction(request);
}
