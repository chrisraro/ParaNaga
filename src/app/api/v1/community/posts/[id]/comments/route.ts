import { createComment } from "@/server/community/handlers-index";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/community/posts/[id]/comments">) {
  return createComment(request, (await ctx.params).id);
}
