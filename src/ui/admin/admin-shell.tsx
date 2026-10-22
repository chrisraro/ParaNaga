import type { ReactNode } from "react";
import { adminNavFor } from "@/domain/admin/access";
import type { Role } from "@/domain/auth/permissions";
import { AdminNav } from "./admin-nav";

// The admin console frame (N5a): desktop-first, English only (owner decision; not in src/i18n).
// The left nav lists only what the roles allow; the footer names the real roles.
export function AdminShell({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const staffRoles = roles.filter((r) => r !== "commuter");
  return (
    <div lang="en" className="flex min-h-screen bg-canvas text-navy dark:bg-navy-deep dark:text-white" data-testid="admin-shell">
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-fill bg-white p-4 dark:border-navy-raised dark:bg-navy">
        <p className="px-3 text-base font-semibold">ParaNaga admin</p>
        <AdminNav items={adminNavFor(roles)} />
        <p className="mt-auto px-3 text-xs text-ink-2 dark:text-slate-300" data-testid="admin-roles">
          Signed in as {staffRoles.join(" · ")}
        </p>
      </aside>
      <main className="min-w-0 flex-1 p-8" id="admin-main">
        {children}
      </main>
    </div>
  );
}
