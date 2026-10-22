import { getPhoto } from "@/server/community/handlers-index";

// An approved community photo, from the public bucket only (N6, C10).
export async function GET(request: Request, ctx: RouteContext<"/api/v1/community/photos/[id]">) {
  return getPhoto(request, (await ctx.params).id);
}
