import { submitAppeal } from "@/server/community/handlers-index";

// The author appeals a decision not to publish, once per item (N6, C10).
export function POST(request: Request) {
  return submitAppeal(request);
}
