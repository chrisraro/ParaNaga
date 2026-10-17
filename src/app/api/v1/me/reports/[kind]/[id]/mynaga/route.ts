import { setMyNagaHandoff } from "@/server/reports/handlers";

// The reporter's own note that they submitted the report in MyNaga (self-reported). Private.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/me/reports/[kind]/[id]/mynaga">) {
  const { kind, id } = await ctx.params;
  return setMyNagaHandoff(request, kind, id);
}
