import { getComplaint, postComplaintAction } from "@/server/admin/complaint-handlers";

// One driver report for its reviewer (audited open), and its status changes / legal hold (N7, C11).
export function GET(request: Request, ctx: RouteContext<"/api/v1/admin/complaints/[id]">) {
  return getComplaint(request, ctx.params);
}

export function POST(request: Request, ctx: RouteContext<"/api/v1/admin/complaints/[id]">) {
  return postComplaintAction(request, ctx.params);
}
