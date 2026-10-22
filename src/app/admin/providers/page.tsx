import { requireStaffAction } from "@/server/admin/access";
import { ProvidersScreen } from "@/ui/admin/providers";

// No metadata (see src/app/admin/page.tsx). Moderators and admins read it; the API checks again.
export default async function AdminProvidersPage() {
  await requireStaffAction("ops.jev.diagnose");
  return <ProvidersScreen />;
}
