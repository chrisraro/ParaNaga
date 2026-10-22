import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  AUDIT_PAGE_SIZE,
  auditPageSchema,
  auditQuerySchema,
  decodeCursor,
  DIAGNOSTIC_TEXT,
  diagnosticBlocker,
  diagnosticResultSchema,
  encodeCursor,
  findUserPayloadSchema,
  findUserResultSchema,
  jobsSchema,
  manilaDayBound,
  providersSchema,
  roleChangeResultSchema,
  roleChangeSchema,
  staffListSchema,
  type JevStatus,
} from "@/domain/admin/system";
import { can } from "@/domain/auth/permissions";
import { createJevClient, jevBudgetKey } from "@/server/adapters/jev/client";
import { badRequest, forbidden, readJsonBody, stepUpRequired, tooManyRequests } from "@/server/api/http";
import { applyStepUp, currentStepUpKey } from "@/server/auth/step-up";
import type { Db } from "@/server/db/context";
import { serverEnv } from "@/server/env";
import { driverReportsEnabled } from "@/server/flags";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { adminRoute, firstIssue, json, limited } from "./handlers";
import { toIso } from "./repo";

// /api/v1/admin/{users,providers,jobs,audit} (N7, C12). Same walls as the rest of /api/v1/admin:
// the session's roles (404 without the action), the action's permission, and the database:
//   users & roles  admin only; core.grant_role / core.revoke_role (0026) check admin, a fresh
//                  step-up (applied first in the same transaction), a reason, never your own
//                  roles, never the last admin, and audit. Lookup is by full email only.
//   providers      moderators and admins read the configuration as yes/no (never a key, never an
//                  error body); only admins run the live diagnostic (one synthetic Decisions call,
//                  only when the key is set and Jev is on; audited 'ops.jev.diagnose').
//   jobs           admins: ops.job status counts and the latest rows (never the payload).
//   audit          RLS decides: admins read every row; other staff only their own.

const BODY_MAX_BYTES = 2048;

type Obj = Record<string, unknown>;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
async function scalar(db: Db, query: SQL): Promise<unknown> {
  const r = (await db.execute(query)).rows[0] as Obj | undefined;
  return r ? Object.values(r)[0] : undefined;
}
const roleRows = (v: unknown) => list(v).map((r) => ({ ...r, grantedAt: toIso(r.grantedAt), revokedAt: toIso(r.revokedAt) }));

// ---------------------------------------------------------------- users & roles (A18)

export function getStaff(request: Request): Promise<Response> {
  return adminRoute(request, "admin/users", "roles.grant", async ({ requestId, db }) => {
    const staff = list(await db((d) => scalar(d, sql`select core.admin_staff() as d`), true));
    return json(staffListSchema, { staff: staff.map((u) => ({ ...u, roles: roleRows(u.roles) })) } as z.input<typeof staffListSchema>, requestId);
  });
}

/** POST /api/v1/admin/users/lookup {email}: exact address only; no match answers {user: null}. */
export function postUserLookup(request: Request): Promise<Response> {
  return adminRoute(request, "admin/users/lookup", "roles.grant", async ({ user, requestId, db }) => {
    const parsed = findUserPayloadSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const found = await db(async (d) => {
      if (!(await checkRateLimit(d, request, RATE_LIMITS.userLookupPerHour, user.id))) return "rate" as const;
      return ((await scalar(d, sql`select core.admin_find_user(${parsed.data.email}) as d`)) ?? null) as Obj | null;
    });
    if (found === "rate") throw tooManyRequests();
    return json(findUserResultSchema, { user: found ? { ...found, roles: roleRows(found.roles) } : null } as z.input<typeof findUserResultSchema>, requestId);
  });
}

/** POST /api/v1/admin/users/roles {userId, role, change, reason}: fresh step-up required. */
export function postRoleChange(request: Request): Promise<Response> {
  return adminRoute(request, "admin/users/roles", "roles.grant", async ({ user, requestId, db }) => {
    const parsed = roleChangeSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const p = parsed.data;
    // The database refuses this too; answering here keeps the step-up prompt away from a request that cannot pass.
    if (p.userId === user.id) throw forbidden("You cannot change your own roles. Ask another admin.");
    const key = await currentStepUpKey(user.id);
    const out = await db(async (d) => {
      if (await limited(d, request, user.id)) return "rate" as const;
      if (!(await applyStepUp(d, key))) return "step_up" as const;
      if (p.change === "grant") await d.execute(sql`select core.grant_role(${p.userId}, ${p.role}, ${p.reason})`);
      else await d.execute(sql`select core.revoke_role(${p.userId}, ${p.role}, ${p.reason})`);
      return "ok" as const;
    });
    if (out === "rate") throw tooManyRequests();
    if (out === "step_up") throw stepUpRequired();
    return json(roleChangeResultSchema, { ok: true }, requestId);
  });
}

// ---------------------------------------------------------------- Jev & providers (A19)

const DATED_JEV_BUILD = /^typesafe\/jev-\d+\.\d+-\d{8}$/;
const utcDay = (now: Date) => now.toISOString().slice(0, 10);

async function readJevStatus(d: Db, now: Date): Promise<JevStatus> {
  const e = serverEnv();
  const health = (await d.execute(sql`
    select last_ok_at, last_error_code, consecutive_failures, circuit_open_until from ops.provider_health where provider = 'jev'
  `)).rows[0] as Obj | undefined;
  // The daily budget bucket (src/server/adapters/jev/client.ts): one ops.take_token window per UTC day.
  const windowStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000).toISOString();
  const used = (await d.execute(sql`
    select count from ops.rate_limit_bucket where key_hash = ${jevBudgetKey(utcDay(now))} and window_start = ${windowStart}::timestamptz
  `)).rows[0] as Obj | undefined;
  const keyPresent = Boolean(e.OPENROUTER_API_KEY);
  const circuitOpen = health?.circuit_open_until ? new Date(String(health.circuit_open_until)) > now : false;
  const whyDisabled = !keyPresent
    ? "No OPENROUTER_API_KEY on the server: every post stays pending for a person."
    : e.JEV_DAILY_BUDGET_REQUESTS <= 0
      ? "JEV_DAILY_BUDGET_REQUESTS is 0, so no call is made."
      : circuitOpen
        ? "The circuit breaker is open after repeated failures; calls resume when it closes."
        : null;
  let host = "";
  try {
    host = new URL(e.JEV_DECISIONS_URL).host;
  } catch {
    host = "invalid URL";
  }
  return {
    keyPresent,
    enabled: whyDisabled === null,
    modelId: e.JEV_MODEL_ID,
    modelPinned: DATED_JEV_BUILD.test(e.JEV_MODEL_ID),
    decisionsHost: host,
    policyVersion: e.JEV_POLICY_VERSION,
    timeoutMs: e.JEV_TIMEOUT_MS,
    dailyBudget: e.JEV_DAILY_BUDGET_REQUESTS,
    usedToday: used ? Number(used.count ?? 0) : 0,
    autoPublish: e.AUTO_PUBLISH_ENABLED,
    complaints: e.JEV_COMPLAINTS_ENABLED,
    health: health
      ? {
          lastOkAt: toIso(health.last_ok_at),
          lastErrorCode: (health.last_error_code as string | null) ?? null,
          consecutiveFailures: Number(health.consecutive_failures ?? 0),
          circuitOpenUntil: toIso(health.circuit_open_until),
        }
      : null,
    whyDisabled,
  };
}

/** Yes/no per provider; nothing here ever includes a key, a URL with credentials or an error body. */
function providerRows() {
  const e = serverEnv();
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const placesOn = has(e.GOOGLE_PLACES_API_KEY) && e.PLACES_GOOGLE_ENABLED === "true";
  return [
    { id: "database", label: "Database (paranaga_app)", configured: has(e.PARANAGA_DATABASE_URL), enabled: has(e.PARANAGA_DATABASE_URL), detail: "Runtime connection; row-level security applies." },
    { id: "auth", label: "Neon Auth", configured: has(e.NEON_AUTH_BASE_URL) && has(e.NEON_AUTH_COOKIE_SECRET), enabled: has(e.NEON_AUTH_BASE_URL), detail: "Sign-in, email codes and step-up." },
    {
      id: "storage",
      label: "Object storage",
      configured: has(e.STORAGE_ENDPOINT) && has(e.STORAGE_ACCESS_KEY_ID) && has(e.STORAGE_SECRET_ACCESS_KEY),
      enabled: has(e.STORAGE_ENDPOINT),
      detail: "Uploads, private evidence, public photos. Without it the server keeps files in memory (development only).",
    },
    { id: "places", label: "Google Places suggestions", configured: has(e.GOOGLE_PLACES_API_KEY), enabled: placesOn, detail: "On only with the key and PLACES_GOOGLE_ENABLED=true." },
    { id: "cron", label: "Cron secret", configured: has(e.CRON_SECRET), enabled: has(e.CRON_SECRET), detail: "Protects /api/cron/jobs and /api/cron/retention." },
    { id: "driver_reports", label: "Driver reports", configured: true, enabled: driverReportsEnabled(), detail: "DRIVER_REPORTS_ENABLED. Off until a complaint reviewer is named; review works either way." },
  ];
}

export function getProviders(request: Request): Promise<Response> {
  return adminRoute(request, "admin/providers", "ops.jev.diagnose", async ({ user, requestId, db }) => {
    const now = new Date();
    const out = await db(async (d) => {
      const jev = await readJevStatus(d, now);
      const flags = (await d.execute(sql`select key, enabled, updated_at from ops.feature_flag order by key`)).rows as Obj[];
      return { jev, flags: flags.map((f) => ({ key: String(f.key), enabled: f.enabled === true, updatedAt: toIso(f.updated_at) })) };
    }, true);
    return json(providersSchema, { ...out, providers: providerRows(), canRunDiagnostic: can(user.roles, "ops.manage") }, requestId);
  });
}

/**
 * POST /api/v1/admin/providers/jev-diagnostic {}: one synthetic Decisions call (admins). Skipped,
 * with the reason, when the key is missing or Jev is off. The answer is the outcome only.
 */
export function postJevDiagnostic(request: Request): Promise<Response> {
  return adminRoute(request, "admin/providers/jev-diagnostic", "ops.manage", async ({ user, requestId, db }) => {
    await readJsonBody(request, 64);
    const now = new Date();
    const gate = await db(async (d) => {
      if (!(await checkRateLimit(d, request, RATE_LIMITS.jevDiagnosticPerHour, user.id))) return "rate" as const;
      return readJevStatus(d, now);
    });
    if (gate === "rate") throw tooManyRequests("Diagnostics are limited to a few per hour.");
    const blocked = diagnosticBlocker(gate);
    if (blocked) {
      await db((d) => d.execute(sql`select core.audit('ops.jev.diagnose', 'provider', 'jev', ${JSON.stringify({ ran: false })}::jsonb)`));
      return json(diagnosticResultSchema, { ran: false, status: "skipped", reason: blocked, recommendation: null, confidence: null, ms: null }, requestId);
    }
    const started = Date.now();
    const outcome = await createJevClient().classify({
      kind: "community",
      text: DIAGNOSTIC_TEXT,
      flags: { autoPublishEnabled: false, complaintsEnabled: false, complaintsLegalClearance: false },
    });
    const ms = Date.now() - started;
    const ok = outcome?.status === "ok";
    const reason = outcome?.status === "unavailable" ? outcome.reason : outcome ? null : "no_answer";
    await db(async (d) => {
      await d.execute(sql`
        insert into ops.provider_health as h (provider, last_ok_at, last_error_code, consecutive_failures)
        values ('jev', ${ok ? now.toISOString() : null}::timestamptz, ${ok ? null : reason}, ${ok ? 0 : 1})
        on conflict (provider) do update set
          last_ok_at = coalesce(excluded.last_ok_at, h.last_ok_at),
          last_error_code = excluded.last_error_code,
          consecutive_failures = case when ${ok} then 0 else h.consecutive_failures + 1 end
      `);
      await d.execute(sql`select core.audit('ops.jev.diagnose', 'provider', 'jev', ${JSON.stringify({ ran: true, status: ok ? "ok" : "unavailable", reason, ms })}::jsonb)`);
    });
    return json(
      diagnosticResultSchema,
      {
        ran: true,
        status: ok ? "ok" : "unavailable",
        reason,
        recommendation: outcome?.status === "ok" ? outcome.verdict.recommendation : null,
        confidence: outcome?.status === "ok" ? outcome.verdict.confidence : null,
        ms,
      },
      requestId,
    );
  });
}

// ---------------------------------------------------------------- jobs (A20)

export function getJobs(request: Request): Promise<Response> {
  return adminRoute(request, "admin/jobs", "ops.manage", async ({ requestId, db }) => {
    const out = await db(async (d) => {
      const counts = (await d.execute(sql`select status, count(*)::int as count from ops.job group by status order by status`)).rows as Obj[];
      const jobs = (await d.execute(sql`
        select id, kind, status, attempts, max_attempts, run_after, last_error_code, created_at, finished_at
          from ops.job order by created_at desc limit 100
      `)).rows as Obj[];
      const runs = (await d.execute(sql`
        select at, after from core.audit_event where action = 'retention.run' order by at desc limit 10
      `)).rows as Obj[];
      return { counts, jobs, runs };
    }, true);
    return json(
      jobsSchema,
      {
        counts: out.counts.map((c) => ({ status: c.status, count: Number(c.count) })),
        jobs: out.jobs.map((j) => ({
          id: j.id,
          kind: j.kind,
          status: j.status,
          attempts: Number(j.attempts),
          maxAttempts: Number(j.max_attempts),
          runAfter: toIso(j.run_after),
          lastErrorCode: j.last_error_code ?? null,
          createdAt: toIso(j.created_at),
          finishedAt: toIso(j.finished_at),
        })),
        retention: out.runs.map((r) => {
          const a = (r.after ?? {}) as Obj;
          return { at: toIso(r.at), dryRun: a.dryRun !== false, complaints: Number(a.complaints ?? 0), uploads: Number(a.uploads ?? 0), objects: Number(a.objects ?? 0), failed: Number(a.failed ?? 0) };
        }),
      } as z.input<typeof jobsSchema>,
      requestId,
    );
  });
}

// ---------------------------------------------------------------- audit log (A21)

/** GET /api/v1/admin/audit?actor=&action=&from=&to=&before=: newest first, 50 per page, read-only. */
export function getAudit(request: Request): Promise<Response> {
  return adminRoute(request, "admin/audit", null, async ({ user, requestId, db }) => {
    const params = Object.fromEntries([...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== ""));
    const parsed = auditQuerySchema.safeParse(params);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const q = parsed.data;
    const all = can(user.roles, "audit.read");
    const cursor = decodeCursor(q.before);
    if (q.before && !cursor) throw badRequest("The page cursor is not valid. Start again from the first page.");
    // Others read their own rows only; RLS (0026 audit_read_own_staff) enforces it whatever this says.
    const actor = all ? q.actor : user.id;
    const where: SQL[] = [sql`true`];
    if (actor) where.push(sql`a.actor_user_id = ${actor}`);
    if (q.action) where.push(q.action.endsWith("*") ? sql`a.action like ${q.action.slice(0, -1).replace(/_/g, "\\_") + "%"}` : sql`a.action = ${q.action}`);
    if (q.from) where.push(sql`a.at >= ${manilaDayBound(q.from)}::timestamptz`);
    if (q.to) where.push(sql`a.at < ${manilaDayBound(q.to, true)}::timestamptz`);
    if (cursor) where.push(sql`(a.at, a.id) < (timestamptz 'epoch' + ${cursor.atMicros}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`);
    const rows = (await db(
      async (d) =>
        (
          await d.execute(sql`
            select a.id, a.at, (extract(epoch from a.at) * 1000000)::bigint::text as at_us, a.actor_user_id, p.display_name as actor_name, a.actor_role, a.action, a.entity_type, a.entity_id, a.after, a.request_id
              from core.audit_event a left join core.profile p on p.user_id = a.actor_user_id
             where ${sql.join(where, sql` and `)}
             order by a.at desc, a.id desc
             limit ${AUDIT_PAGE_SIZE + 1}
          `)
        ).rows as Obj[],
      true,
    ));
    const kept = rows.slice(0, AUDIT_PAGE_SIZE);
    const page = kept.map((r) => ({
      id: String(r.id),
      at: toIso(r.at) ?? "",
      actorUserId: (r.actor_user_id as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      actorRole: (r.actor_role as string | null) ?? null,
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: (r.entity_id as string | null) ?? null,
      after: r.after ?? null,
      requestId: (r.request_id as string | null) ?? null,
    }));
    const last = kept.at(-1);
    const next = rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(String(last.at_us), String(last.id)) : null;
    return json(auditPageSchema, { scope: all ? "all" : "own", rows: page, next }, requestId);
  });
}
