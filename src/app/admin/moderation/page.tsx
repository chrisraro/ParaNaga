import { requireStaffAction } from "@/server/admin/access";
import { ModerationScreen } from "@/ui/admin/moderation";

// No metadata (see src/app/admin/page.tsx). Staff without this screen's action get the not-found
// page (N6: moderators and transport reviewers see different screens); the API checks again.
export default async function AdminModerationPage() {
  await requireStaffAction("community.moderate");
  return <ModerationScreen />;
}
