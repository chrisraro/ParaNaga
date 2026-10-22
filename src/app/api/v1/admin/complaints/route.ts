import { getComplaints } from "@/server/admin/complaint-handlers";

// The complaint review queue (N7, C11): complaint reviewers only, after a fresh step-up; audited.
export function GET(request: Request) {
  return getComplaints(request);
}
