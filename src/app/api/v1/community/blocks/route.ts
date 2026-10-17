import { blockAuthor } from "@/server/community/handlers-index";

export function POST(request: Request) {
  return blockAuthor(request);
}
