import { getStaff } from "@/server/admin/system-handlers";

// Everyone holding a staff role (N7, C12 A18): admins only.
export function GET(request: Request) {
  return getStaff(request);
}
