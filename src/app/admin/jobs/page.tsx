import { requireStaffAction } from "@/server/admin/access";
import { JobsScreen } from "@/ui/admin/jobs";

// No metadata (see src/app/admin/page.tsx). Admins only; the API checks again.
export default async function AdminJobsPage() {
  await requireStaffAction("ops.manage");
  return <JobsScreen />;
}
