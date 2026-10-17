import { createPost, listPosts } from "@/server/community/handlers-index";

// Feed (public, short cache unless ?me=1 or a personal scope) and create (signed in, never cached).
export function GET(request: Request) {
  return listPosts(request);
}
export function POST(request: Request) {
  return createPost(request);
}
