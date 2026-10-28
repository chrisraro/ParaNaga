import type { ReactNode } from "react";
import { adminNavFor } from "@/domain/admin/access";
import type { Role } from "@/domain/auth/permissions";
import { AdminNav } from "./admin-nav";

// The admin console frame (N5a, redesigned N8): a persistent left rail on desktop, a drawer under
// 1024px. English only (owner decision; not in src/i18n). The nav lists only what the roles allow;
// the footer names the real roles.
export function AdminShell({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const staffRoles = roles.filter((r) => r !== "commuter");
  return (
    <div lang="en" className="min-h-screen bg-canvas text-navy lg:flex dark:bg-navy-deep dark:text-white" data-testid="admin-shell">
      <AdminNav items={adminNavFor(roles)}>
        <p className="px-3 text-xs text-slate-300" data-testid="admin-roles">
          Signed in as {staffRoles.join(" · ")}
        </p>
      </AdminNav>
      <main className="min-w-0 flex-1 px-4 pb-16 pt-20 sm:px-6 lg:px-10 lg:pt-8" id="admin-main">
        <div className="mx-auto max-w-[88rem]">{children}</div>
      </main>
    </div>
  );
}
