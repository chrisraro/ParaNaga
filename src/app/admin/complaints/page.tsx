import { requireStaffAction } from "@/server/admin/access";
import { ComplaintsScreen } from "@/ui/admin/complaints";

// No metadata (see src/app/admin/page.tsx). Complaint reviewers only: everyone else, admins
// included, gets the not-found page; the API and the database check again (and require step-up).
export default async function AdminComplaintsPage() {
  await requireStaffAction("complaint.review");
  return <ComplaintsScreen />;
}
