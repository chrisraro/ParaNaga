import { getCommunityMe } from "@/server/community/handlers-index";

export function GET(request: Request) {
  return getCommunityMe(request);
}
