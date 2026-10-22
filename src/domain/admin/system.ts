// A18 Users & roles, A19 Jev & providers, A20 Jobs, A21 Audit log (N7, C12): the shapes shared by
// /api/v1/admin/{users,providers,jobs,audit} and the browser. Pure and browser-safe (zod only).
// The database repeats the role rules (core.grant_role / core.revoke_role, migration 0026: admin,
// fresh step-up, reason, never your own roles, never the last admin) and RLS decides which audit
// rows a caller reads (admins all, other staff their own).
import { z } from "zod";
import { ROLES, type Role } from "@/domain/auth/permissions";

const ts = z.string().min(1);

/** Roles an admin may grant (commuter is everyone's base role and is never granted by hand). */
export const GRANTABLE_ROLES = ["contributor", "transport_reviewer", "community_moderator", "complaint_reviewer", "admin"] as const satisfies readonly Role[];
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  commuter: "Commuter",
  contributor: "Contributor",
  transport_reviewer: "Transport reviewer",
  community_moderator: "Community moderator",
  complaint_reviewer: "Complaint reviewer",
  admin: "Admin",
};

export const roleRowSchema = z.object({
  role: z.enum(ROLES),
  active: z.boolean(),
  grantedAt: ts,
  grantedBy: z.string().nullable(),
  revokedAt: ts.nullable(),
  reason: z.string(),
});

export const userCardSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  self: z.boolean(),
  suspended: z.boolean(),
  roles: z.array(roleRowSchema),
});
export type UserCard = z.infer<typeof userCardSchema>;

export const foundUserSchema = userCardSchema.extend({ emailVerified: z.boolean(), hasProfile: z.boolean() });
export type FoundUser = z.infer<typeof foundUserSchema>;

export const staffListSchema = z.object({ staff: z.array(userCardSchema) });
export type StaffList = z.infer<typeof staffListSchema>;

export const findUserResultSchema = z.object({ user: foundUserSchema.nullable() });
export type FindUserResult = z.infer<typeof findUserResultSchema>;

/** Full address only: no prefix search, no listing (spec: no user enumeration). */
export const findUserPayloadSchema = z
  .object({ email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a full email address.") })
  .strict();

export const roleChangeSchema = z
  .object({
    userId: z.string().trim().min(1).max(200),
    role: z.enum(GRANTABLE_ROLES).or(z.literal("commuter")),
    change: z.enum(["grant", "revoke"]),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500, "A reason is at most 500 characters."),
  })
  .strict()
  .refine((v) => v.change === "revoke" || v.role !== "commuter", { message: "Commuter is everyone's base role; it is not granted by hand." });
export type RoleChange = z.input<typeof roleChangeSchema>;

export const roleChangeResultSchema = z.object({ ok: z.literal(true) });

/** True when no other active admin would remain (the database refuses this too). */
export function wouldRemoveLastAdmin(staff: readonly UserCard[], userId: string, role: Role, change: "grant" | "revoke"): boolean {
  if (change !== "revoke" || role !== "admin") return false;
  return !staff.some((u) => u.userId !== userId && !u.suspended && u.roles.some((r) => r.role === "admin" && r.active));
}

// ---------------------------------------------------------------- Jev & providers

export const providerRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  configured: z.boolean(),
  enabled: z.boolean(),
  detail: z.string(),
});

export const jevStatusSchema = z.object({
  keyPresent: z.boolean(),
  enabled: z.boolean(),
  modelId: z.string(),
  modelPinned: z.boolean(),
  decisionsHost: z.string(),
  policyVersion: z.string(),
  timeoutMs: z.number().int(),
  dailyBudget: z.number().int(),
  usedToday: z.number().int().nullable(),
  autoPublish: z.boolean(),
  complaints: z.boolean(),
  health: z
    .object({ lastOkAt: ts.nullable(), lastErrorCode: z.string().nullable(), consecutiveFailures: z.number().int(), circuitOpenUntil: ts.nullable() })
    .nullable(),
  whyDisabled: z.string().nullable(),
});
export type JevStatus = z.infer<typeof jevStatusSchema>;

export const providersSchema = z.object({
  jev: jevStatusSchema,
  providers: z.array(providerRowSchema),
  flags: z.array(z.object({ key: z.string(), enabled: z.boolean(), updatedAt: ts.nullable() })),
  canRunDiagnostic: z.boolean(),
});
export type Providers = z.infer<typeof providersSchema>;

export const diagnosticResultSchema = z.object({
  ran: z.boolean(),
  status: z.enum(["ok", "unavailable", "skipped"]),
  reason: z.string().nullable(),
  recommendation: z.string().nullable(),
  confidence: z.number().nullable(),
  ms: z.number().int().nullable(),
});
export type DiagnosticResult = z.infer<typeof diagnosticResultSchema>;

/** Synthetic, non-sensitive text (spec 05 §5.7): never a real post. */
export const DIAGNOSTIC_TEXT = "Diagnostic check: the jeepney to Centro left the terminal on time this morning.";

/** Why the diagnostic does not run; null when it may. */
export function diagnosticBlocker(j: Pick<JevStatus, "keyPresent" | "enabled" | "whyDisabled">): string | null {
  if (!j.keyPresent) return "OPENROUTER_API_KEY is not set on the server, so no Decisions call is made; posts stay pending for a person.";
  if (!j.enabled) return j.whyDisabled ?? "Jev is switched off.";
  return null;
}

// ---------------------------------------------------------------- jobs

export const JOB_STATUSES = ["queued", "running", "retry", "done", "dead"] as const;

export const jobsSchema = z.object({
  counts: z.array(z.object({ status: z.enum(JOB_STATUSES), count: z.number().int() })),
  jobs: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      status: z.enum(JOB_STATUSES),
      attempts: z.number().int(),
      maxAttempts: z.number().int(),
      runAfter: ts,
      lastErrorCode: z.string().nullable(),
      createdAt: ts,
      finishedAt: ts.nullable(),
    }),
  ),
  retention: z.array(z.object({ at: ts, dryRun: z.boolean(), complaints: z.number().int(), uploads: z.number().int(), objects: z.number().int(), failed: z.number().int() })),
});
export type Jobs = z.infer<typeof jobsSchema>;

// ---------------------------------------------------------------- audit log

export const AUDIT_PAGE_SIZE = 50;

/** Query string of GET /api/v1/admin/audit. Dates are YYYY-MM-DD in Manila time, inclusive. */
export const auditQuerySchema = z
  .object({
    actor: z.string().trim().min(1).max(200).optional(),
    action: z
      .string()
      .trim()
      .max(80)
      .regex(/^[a-z_.]+\*?$/, "An action is letters, dots and underscores, optionally ending in * for a prefix.")
      .optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    before: z.string().max(120).optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = z.object({
  scope: z.enum(["all", "own"]),
  rows: z.array(
    z.object({
      id: z.uuid(),
      at: ts,
      actorUserId: z.string().nullable(),
      actorName: z.string().nullable(),
      actorRole: z.string().nullable(),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string().nullable(),
      after: z.unknown(),
      requestId: z.string().nullable(),
    }),
  ),
  next: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

/**
 * Keyset cursor: "<microseconds since the epoch>|<uuid>". Microseconds, not an ISO string: the
 * database keeps microseconds, and a millisecond cursor would skip rows within the same millisecond.
 */
export function encodeCursor(atMicros: string, id: string): string {
  return `${atMicros}|${id}`;
}

export function decodeCursor(raw: string | undefined): { atMicros: string; id: string } | null {
  if (!raw) return null;
  const [at, id, ...rest] = raw.split("|");
  if (rest.length || !at || !id || !/^\d{1,17}$/.test(at) || !z.uuid().safeParse(id).success) return null;
  return { atMicros: at, id };
}

/** Manila midnight (UTC+8, no DST) of a YYYY-MM-DD date, as an ISO instant; `end` = the next midnight. */
export function manilaDayBound(date: string, end = false): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  if (end) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
