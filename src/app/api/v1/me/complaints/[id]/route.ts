import { getMyComplaint } from "@/server/reports/handlers";

// One of the caller's own driver reports, in full. Private, never cached.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/me/complaints/[id]">) {
  const { id } = await ctx.params;
  return getMyComplaint(request, id);
}
