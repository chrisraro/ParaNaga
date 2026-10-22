import { can } from "@/domain/auth/permissions";
import { requireStaffPage } from "@/server/admin/access";
import { AdminDashboard } from "@/ui/admin/dashboard";

// No metadata on admin pages: Next resolves it even when the layout answers not-found, and a
// non-staff visitor must see an ordinary not-found page. The title is set in the browser (AdminNav).
// The cards follow the roles (N6): transport staff see the data counts, moderators the moderation link.
export default async function AdminDashboardPage() {
  const user = await requireStaffPage();
  return (
    <AdminDashboard
      transit={can(user.roles, "transit.revision.edit")}
      corrections={can(user.roles, "correction.review")}
      moderation={can(user.roles, "community.moderate")}
      complaints={can(user.roles, "complaint.review")}
    />
  );
}
