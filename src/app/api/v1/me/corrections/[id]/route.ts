import { getMyCorrection } from "@/server/reports/handlers";

// One of the caller's own corrections, in full. Private, never cached.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/me/corrections/[id]">) {
  const { id } = await ctx.params;
  return getMyCorrection(request, id);
}
