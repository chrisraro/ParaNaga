import { requireStaffPage } from "@/server/admin/access";
import "./admin.css";
import { AdminShell } from "@/ui/admin/admin-shell";

// /admin (N5a): staff only, checked on the server for every request that renders this layout.
// Nothing of the console renders until the check passes; anyone else gets the not-found page
// (signed-out visitors already got a 404 status from src/proxy.ts; for signed-in non-staff the page
// streams under Cache Components, so it carries robots noindex with status 200). instant = false:
// this segment blocks on the session rather than showing a shell first.
// The screens load their data from /api/v1/admin/**, which checks again on every call (real 404s).
// No metadata here or in the pages: a non-staff visitor's not-found page must look like any other
// unknown URL. noindex and no-referrer come as headers (next.config.ts); the title is set in the
// browser (src/ui/admin/admin-nav.tsx).
export const instant = false;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffPage();
  return <AdminShell roles={user.roles}>{children}</AdminShell>;
}
