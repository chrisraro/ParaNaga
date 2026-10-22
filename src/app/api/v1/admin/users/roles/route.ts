import { postRoleChange } from "@/server/admin/system-handlers";

// Grant or revoke a role with a reason (N7, C12 A18): admins only, fresh step-up, audited.
export function POST(request: Request) {
  return postRoleChange(request);
}
