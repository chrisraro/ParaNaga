import { postStopAction } from "@/server/admin/handlers";

// One stop action in the open draft (N5b): promote, evidence, retire, relocate, edit.
export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/stops/[id]">) {
  return postStopAction(request, ctx.params);
}
