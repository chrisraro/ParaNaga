import { listMyComplaints } from "@/server/complaints/handlers";

// The signed-in commuter's own driver reports. Private, never cached.
export function GET(request: Request) {
  return listMyComplaints(request);
}
