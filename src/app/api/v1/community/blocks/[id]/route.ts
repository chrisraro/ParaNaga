import { unblock } from "@/server/community/handlers-index";

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/community/blocks/[id]">) {
  return unblock(request, (await ctx.params).id);
}
