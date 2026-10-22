// Pure role → action matrix from docs/spec/05-security.md §5.3.
// The database repeats these checks with RLS; this is the first wall.

export const ROLES = [
  "commuter",
  "contributor",
  "transport_reviewer",
  "community_moderator",
  "complaint_reviewer",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "account.preferences.write",
  "account.saved.sync",
  "media.upload",
  "correction.submit",
  "community.post",
  "complaint.submit",
  "community.moderate",
  "community.appeal.resolve",
  "correction.review",
  "transit.revision.edit",
  "transit.revision.publish",
  "complaint.review",
  "complaint.evidence.read",
  "roles.grant",
  "ops.jev.diagnose",
  // N7: jobs list and the live Jev diagnostic (admin only; moderators read provider status).
  "ops.manage",
  "audit.read",
] as const;

export type Action = (typeof ACTIONS)[number];

const SIGNED_IN: readonly Action[] = ["account.preferences.write", "account.saved.sync", "media.upload", "correction.submit", "community.post", "complaint.submit"];

const GRANTS: Record<Role, readonly Action[]> = {
  commuter: SIGNED_IN,
  contributor: [...SIGNED_IN, "correction.submit"],
  transport_reviewer: [
    ...SIGNED_IN,
    "correction.submit",
    "correction.review",
    "transit.revision.edit",
    "transit.revision.publish",
  ],
  community_moderator: [
    ...SIGNED_IN,
    "correction.submit",
    "community.moderate",
    "community.appeal.resolve",
    "ops.jev.diagnose",
  ],
  complaint_reviewer: [...SIGNED_IN, "correction.submit", "complaint.review", "complaint.evidence.read"],
  // Admin evidence access is break-glass only (separate audited flow), so it is not granted here.
  admin: [
    ...SIGNED_IN,
    "correction.submit",
    "correction.review",
    "transit.revision.edit",
    "transit.revision.publish",
    "community.moderate",
    "community.appeal.resolve",
    "roles.grant",
    "ops.jev.diagnose",
    "ops.manage",
    "audit.read",
  ],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(roles: readonly Role[], action: Action): boolean {
  return roles.some((role) => GRANTS[role].includes(action));
}

export type Resource = { ownerId?: string | null };

// Nobody reviews, moderates or approves their own submission (spec §5.3).
const SELF_REVIEW_FORBIDDEN: readonly Action[] = [
  "community.moderate",
  "community.appeal.resolve",
  "correction.review",
  "complaint.review",
  "complaint.evidence.read",
];

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: "unauthenticated" | "forbidden" | "self_review" };

export function decide(
  user: { id: string; roles: readonly Role[] } | null,
  action: Action,
  resource?: Resource,
): Decision {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  if (!can(user.roles, action)) return { allowed: false, reason: "forbidden" };
  if (resource?.ownerId && resource.ownerId === user.id && SELF_REVIEW_FORBIDDEN.includes(action)) {
    return { allowed: false, reason: "self_review" };
  }
  return { allowed: true };
}
