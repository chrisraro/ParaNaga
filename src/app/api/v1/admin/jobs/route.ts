import { getJobs } from "@/server/admin/system-handlers";

// The job queue's status and recent rows, and the last retention runs (N7, C12 A20): admins only.
export function GET(request: Request) {
  return getJobs(request);
}
