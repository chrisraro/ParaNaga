import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { canEnterAdmin } from "@/domain/admin/access";
import { isRole } from "@/domain/auth/permissions";
import { E2E_ADMIN_ROLES_COOKIE, e2eAdminShellEnabled } from "@/domain/pwa/build-guard";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";

// Who may see /admin (N5a). Roles come from core.user_role (getCurrentUser, per request); a
// suspended account has none. Everyone else gets the not-found page, never a hint that the area exists. The
// data behind every admin screen comes from /api/v1/admin/**, which checks again per request
// (src/server/admin/handlers.ts), and the database checks a third time (transit.admin_assert_staff).

/** Test-only (PARANAGA_E2E_ADMIN_SHELL, see src/domain/pwa/build-guard.ts): the e2e suite's roles cookie. */
async function e2eShellUser(): Promise<CurrentUser | null> {
  const raw = (await cookies()).get(E2E_ADMIN_ROLES_COOKIE)?.value ?? "";
  const roles = raw.split(",").filter(isRole);
  return roles.length > 0 ? { id: "e2e-shell", name: "E2E", roles } : null;
}

/** The signed-in staff user of this request, or null. */
export async function getStaffUser(): Promise<CurrentUser | null> {
  const user = e2eAdminShellEnabled(process.env) ? await e2eShellUser() : await getCurrentUser();
  return user && canEnterAdmin(user.roles) ? user : null;
}

/** For the /admin layout: the staff user, or the not-found page (notFound()). */
export async function requireStaffPage(): Promise<CurrentUser> {
  const user = await getStaffUser();
  if (!user) notFound();
  return user;
}
