import { reportContent } from "@/server/community/handlers-index";

export function POST(request: Request) {
  return reportContent(request);
}
