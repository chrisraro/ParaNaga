import { answerReport } from "@/server/reports/handlers";

// The reporter answers a reviewer who asked for more about their own report. Private.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/me/reports/[kind]/[id]/answer">) {
  const { kind, id } = await ctx.params;
  return answerReport(request, kind, id);
}
