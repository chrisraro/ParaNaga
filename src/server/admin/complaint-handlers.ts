import "server-only";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  COMPLAINT_SCOPES,
  complaintActionResultSchema,
  complaintActionSchema,
  complaintDetailSchema,
  complaintListSchema,
  EVIDENCE_LINK_TTL_S,
  evidenceLinkSchema,
  type ComplaintScope,
} from "@/domain/admin/complaints";
import { parseUuidParam } from "@/domain/api/schemas";
import { badRequest, notFound, readJsonBody, stepUpRequired, tooManyRequests } from "@/server/api/http";
import { applyStepUp, currentStepUpKey } from "@/server/auth/step-up";
import type { Db } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { getStorage } from "@/server/storage/adapter";
import { adminRoute, firstIssue, json, limited, type Ctx } from "./handlers";
import { toIso } from "./repo";

// /api/v1/admin/complaints/** (N7, C11, A17). Driver reports are private: the walls, each on its own,
//  1. adminRoute: the session's roles; anyone without complaint.review (commuters, moderators,
//     transport reviewers, admins) gets 404 before any database call;
//  2. a fresh step-up, applied as the first statement of the same transaction (applyStepUp);
//     without it, 403 step_up_required and no report data;
//  3. the definer functions (0018, 0026) check the role and the step-up again, hide the reviewer's
//     own reports, and audit every read (queue, open, evidence link) and change.
// Evidence: list and detail carry metadata only (no previews); a file is a 60-second signed GET
// with Content-Disposition attachment, issued after priv.reviewer_evidence_download recorded it in
// priv.evidence_access. The URL is in the JSON body only (private, no-store, no-referrer), never
// logged and never in page HTML. Not gated by DRIVER_REPORTS_ENABLED: reports filed while it was
// on still need review.

const ACTION_MAX_BYTES = 4096;
const BODY_MAX_BYTES = 256;
const NO_REPORT = "No such report.";

type Obj = Record<string, unknown>;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
function iso<T extends Obj>(o: T, keys: readonly string[]): T {
  const out: Obj = { ...o };
  for (const k of keys) if (k in out) out[k] = toIso(out[k]);
  return out as T;
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function scalar(db: Db, query: ReturnType<typeof sql>): Promise<unknown> {
  const r = (await db.execute(query)).rows[0] as Obj | undefined;
  return r ? Object.values(r)[0] : undefined;
}

/** Runs `fn` in one transaction that starts with this session's step-up (N3). */
async function withStepUp<T>(ctx: Ctx, request: Request, fn: (db: Db) => Promise<T>, opts: { limit?: "mutation" | "evidence" } = {}): Promise<T> {
  const key = await currentStepUpKey(ctx.user.id);
  const out = await ctx.db(async (d) => {
    if (opts.limit === "mutation" && (await limited(d, request, ctx.user.id))) return { kind: "rate" as const };
    if (opts.limit === "evidence" && !(await checkRateLimit(d, request, RATE_LIMITS.evidenceUrlPerHour, ctx.user.id))) return { kind: "rate" as const };
    if (!(await applyStepUp(d, key))) return { kind: "step_up" as const };
    return { kind: "ok" as const, value: await fn(d) };
  });
  if (out.kind === "rate") throw tooManyRequests();
  if (out.kind === "step_up") throw stepUpRequired();
  return out.value;
}

async function idParam(params: Promise<Record<string, string>>, name: string): Promise<string> {
  const id = parseUuidParam((await params)[name] ?? "", name);
  if (!id.ok) throw notFound(NO_REPORT);
  return id.value;
}

/** GET /api/v1/admin/complaints?scope=open|closed: the queue, without text, evidence or reporter. */
export function getComplaints(request: Request): Promise<Response> {
  return adminRoute(request, "admin/complaints", "complaint.review", async (ctx) => {
    const raw = new URL(request.url).searchParams.get("scope") ?? "open";
    if (!(COMPLAINT_SCOPES as readonly string[]).includes(raw)) throw badRequest("scope is open or closed.");
    const scope = raw as ComplaintScope;
    const rows = await withStepUp(ctx, request, async (d) => list(await scalar(d, sql`select priv.review_list(${scope}, 100) as d`)));
    return json(
      complaintListSchema,
      {
        scope,
        complaints: rows.map((r) => ({ ...iso(r, ["submittedAt", "incidentAt", "updatedAt", "closedAt"]), evidenceCount: Number(r.evidenceCount ?? 0) })),
      } as z.input<typeof complaintListSchema>,
      ctx.requestId,
    );
  });
}

/** GET /api/v1/admin/complaints/:id: one report in full (audited open). */
export function getComplaint(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/complaints/open", "complaint.review", async (ctx) => {
    const id = await idParam(params, "id");
    const d = (await withStepUp(ctx, request, (db) => scalar(db, sql`select priv.review_complaint(${id}::uuid) as d`))) as Obj | null | undefined;
    if (!d) throw notFound(NO_REPORT);
    const loc = (d.location ?? {}) as Obj;
    return json(
      complaintDetailSchema,
      {
        ...iso(d, ["incidentAt", "retentionUntil", "submittedAt", "closedAt"]),
        location: { ...loc, accuracyM: num(loc.accuracyM), lat: num(loc.lat), lng: num(loc.lng) },
        evidence: list(d.evidence).map((e) => ({ ...iso(e, ["capturedAt", "receivedAt"]), bytes: num(e.bytes) })),
        events: list(d.events).map((e) => iso(e, ["at"])),
        access: list(d.access).map((a) => iso(a, ["issuedAt"])),
      } as z.input<typeof complaintDetailSchema>,
      ctx.requestId,
    );
  });
}

/**
 * POST /api/v1/admin/complaints/:id {action: "status", to, outcomeCode?, note?, visibility} or
 * {action: "legal_hold", hold, note}. Step-up required; the database checks the transition.
 */
export function postComplaintAction(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  return adminRoute(request, "admin/complaints/action", "complaint.review", async (ctx) => {
    const id = await idParam(params, "id");
    const parsed = complaintActionSchema.safeParse(await readJsonBody(request, ACTION_MAX_BYTES));
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const p = parsed.data;
    const ok = await withStepUp(
      ctx,
      request,
      async (d) =>
        p.action === "status"
          ? scalar(d, sql`select priv.set_complaint_status(${id}::uuid, ${p.to}, ${p.outcomeCode ?? null}, ${p.note || null}, ${p.visibility}) as ok`)
          : scalar(d, sql`select priv.set_complaint_legal_hold(${id}::uuid, ${p.hold}, ${p.note}) as ok`),
      { limit: "mutation" },
    );
    if (ok !== true) throw notFound(NO_REPORT);
    return json(complaintActionResultSchema, { ok: true }, ctx.requestId);
  });
}

/**
 * POST /api/v1/admin/complaints/:id/evidence/:evidenceId {}: a 60-second signed download link
 * (attachment). A POST because issuing one is a recorded action: the database writes
 * priv.evidence_access and an audit row before the server signs.
 */
export function postComplaintEvidence(request: Request, params: Promise<{ id: string; evidenceId: string }>): Promise<Response> {
  return adminRoute(request, "admin/complaints/evidence", "complaint.evidence.read", async (ctx) => {
    const id = await idParam(params, "id");
    const evidenceId = await idParam(params, "evidenceId");
    await readJsonBody(request, BODY_MAX_BYTES);
    const row = await withStepUp(
      ctx,
      request,
      async (d) => (await d.execute(sql`select bucket, object_key from priv.reviewer_evidence_download(${id}::uuid, ${evidenceId}::uuid)`)).rows[0] as Obj | undefined,
      { limit: "evidence" },
    );
    if (!row) throw notFound("No such file; it may have been removed.");
    const url = await getStorage().createPresignedDownload(String(row.bucket), String(row.object_key), EVIDENCE_LINK_TTL_S, { attachment: true });
    return json(evidenceLinkSchema, { url, expiresInSeconds: EVIDENCE_LINK_TTL_S }, ctx.requestId);
  });
}
