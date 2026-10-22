import { can } from "@/domain/auth/permissions";
import { requireStaffPage } from "@/server/admin/access";
import { AuditScreen } from "@/ui/admin/audit";

// No metadata (see src/app/admin/page.tsx). Any staff: admins read every row, others their own
// (row-level security on core.audit_event decides; this only picks the wording and filters).
export default async function AdminAuditPage() {
  const user = await requireStaffPage();
  return <AuditScreen all={can(user.roles, "audit.read")} />;
}
