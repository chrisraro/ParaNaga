import { requireStaffAction } from "@/server/admin/access";
import { UsersScreen } from "@/ui/admin/users";

// No metadata (see src/app/admin/page.tsx). Admins only; the API and the database check again.
export default async function AdminUsersPage() {
  await requireStaffAction("roles.grant");
  return <UsersScreen />;
}
