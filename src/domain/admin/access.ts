// Who may enter /admin and what the left nav shows (N5a). Pure. The server checks this on every
// request (src/server/admin/access.ts) and the database repeats it in every admin definer function
// (transit.admin_assert_staff, migration 0023); this file is never the only wall.
import { can, type Action, type Role } from "@/domain/auth/permissions";

/**
 * Roles that may open the admin console today: the transport screens (N5), corrections review
 * and community moderation (N6). Complaint reviewers are not let in until their queue is built
 * (N7): no dead links.
 */
export const ADMIN_ENTRY_ROLES: readonly Role[] = ["admin", "transport_reviewer", "community_moderator"];

export function canEnterAdmin(roles: readonly Role[]): boolean {
  return roles.some((r) => ADMIN_ENTRY_ROLES.includes(r));
}

export type AdminNavItem = { href: string; label: string; action: Action | null };

/** Built screens only. `action` null = any role that may enter. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", action: null },
  // N5b (C2, C3): edits go into the open draft revision.
  { href: "/admin/imports", label: "Imports", action: "transit.revision.edit" },
  { href: "/admin/candidates", label: "Candidate review", action: "transit.revision.edit" },
  { href: "/admin/stops", label: "Stops & curbs", action: "transit.revision.edit" },
  { href: "/admin/reconciliation", label: "Reconciliation", action: "transit.revision.edit" },
  { href: "/admin/revisions", label: "Revisions & publication", action: "transit.revision.publish" },
  { href: "/admin/coverage", label: "Coverage audit", action: "transit.revision.edit" },
  // N6 (C9, C10).
  { href: "/admin/corrections", label: "Corrections review", action: "correction.review" },
  { href: "/admin/moderation", label: "Moderation & appeals", action: "community.moderate" },
];

export function adminNavFor(roles: readonly Role[]): AdminNavItem[] {
  if (!canEnterAdmin(roles)) return [];
  return ADMIN_NAV.filter((item) => item.action === null || can(roles, item.action));
}
