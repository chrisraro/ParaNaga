import { deleteComment } from "@/server/community/handlers-index";

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/community/comments/[id]">) {
  return deleteComment(request, (await ctx.params).id);
}
