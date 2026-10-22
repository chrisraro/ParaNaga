import { getAudit } from "@/server/admin/system-handlers";

// The audit log, read-only and paginated (N7, C12 A21): admins read all rows, other staff their own.
export function GET(request: Request) {
  return getAudit(request);
}
