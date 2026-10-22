import { getDashboard } from "@/server/admin/handlers";

// Admin dashboard counts (N5a, C1). Staff only (404 otherwise); private, no-store.
export function GET(request: Request) {
  return getDashboard(request);
}
