import { withdrawReport } from "@/server/reports/handlers";

// The reporter withdraws their own driver report. Private.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/me/reports/[kind]/[id]/withdraw">) {
  const { kind, id } = await ctx.params;
  return withdrawReport(request, kind, id);
}
