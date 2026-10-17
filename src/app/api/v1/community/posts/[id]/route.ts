import { deletePost, editPost, getPost } from "@/server/community/handlers-index";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/community/posts/[id]">) {
  return getPost(request, (await ctx.params).id);
}
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/community/posts/[id]">) {
  return editPost(request, (await ctx.params).id);
}
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/community/posts/[id]">) {
  return deletePost(request, (await ctx.params).id);
}
