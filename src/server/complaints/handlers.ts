import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { DRIVER_NOTICE_KIND, DRIVER_NOTICE_VERSION } from "@/domain/complaints/notice";
import { generateReference } from "@/domain/complaints/reference";
import {
  complaintReceiptSchema,
  createComplaintPayloadSchema,
  createComplaintResponseSchema,
  evidenceUrlResponseSchema,
  myComplaintsResponseSchema,
  type ComplaintReceipt,
} from "@/domain/complaints/schemas";
import { routeComplaint } from "@/domain/complaints/status";
import { ApiProblem, authedRoute, badRequest, CACHE, notFound, readJsonBody, stepUpRequired, tooManyRequests } from "@/server/api/http";
import { authorize } from "@/server/auth/authorize";
import { applyStepUp, currentStepUpKey, isStepUpError } from "@/server/auth/step-up";
import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { driverReportsEnabled } from "@/server/flags";
import { getStorage } from "@/server/storage/adapter";

// Private driver reports (S18, F-D4, task B8). Rules that hold for every handler here:
//  - authorize() first; the database repeats ownership with forced RLS and definer functions;
//  - every response (errors included) is `private, no-store` with Referrer-Policy no-referrer;
//  - nothing from the report (text, plate, location, storage keys, signed URLs) is ever logged:
//    authedRoute logs only the route, request id and error class;
//  - report text is never sent to Jev: complaints are human-only while JEV_COMPLAINTS_ENABLED and
//    legal clearance are off (src/domain/moderation/policy.ts), so this file never calls it.

const BODY_MAX_BYTES = 16 * 1024;
const LIST_LIMIT = 50;
const REF_ATTEMPTS = 4;
export const EVIDENCE_URL_TTL_S = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptRow = {
  id: string;
  public_ref: string;
  category: string;
  status: string;
  submitted_at: string | Date;
};

const toReceipt = (r: ReceiptRow): ComplaintReceipt =>
  complaintReceiptSchema.parse({
    id: r.id,
    reference: r.public_ref,
    category: r.category,
    status: r.status,
    submittedAt: new Date(r.submitted_at).toISOString(),
  });

/** Every response from these endpoints, success or error, is private and never stored. */
async function privateRoute(request: Request, route: string, run: (requestId: string) => Promise<Response>): Promise<Response> {
  const res = await authedRoute(request, route, run);
  res.headers.set("Cache-Control", CACHE.private);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

const json = (body: unknown, requestId: string, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": CACHE.private, "X-Request-Id": requestId } });

/** Postgres error code, whether the driver error is wrapped or not. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * POST /api/v1/complaints: authorize, strict body, idempotent replay, rate limit, notice
 * acknowledgment, then priv.submit_complaint (definer). Answers with the receipt reference only.
 */
export function createComplaint(request: Request): Promise<Response> {
  return privateRoute(request, "complaints", async (requestId) => {
    if (!driverReportsEnabled()) throw notFound("Not found.");
    const user = await authorize("complaint.submit");
    const parsed = createComplaintPayloadSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the report and try again.");
    const input = parsed.data;
    const ctx = { userId: user.id, requestId };

    const gate = await withRequestContext(ctx, async (db) => {
      // A retry of a report already stored answers with it and does not count against the limit.
      const existing = await db.execute<ReceiptRow>(sql`
        select id, public_ref, category, status, submitted_at from priv.complaint
         where reporter_id = ${user.id} and client_request_id = ${input.clientRequestId}::uuid
      `);
      if (existing.rows[0]) return { replay: existing.rows[0] };
      if (!(await checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id))) return "rate_limited" as const;
      if (!(await checkRateLimit(db, request, RATE_LIMITS.complaintPerDay, user.id))) return "rate_limited" as const;
      await db.execute(sql`
        insert into core.ack (user_id, kind, version)
        values (${user.id}, ${DRIVER_NOTICE_KIND}, ${DRIVER_NOTICE_VERSION})
        on conflict (user_id, kind, version) do nothing
      `);
      return "ok" as const;
    });
    if (gate === "rate_limited") throw tooManyRequests("You have sent several reports today. Try again tomorrow.");
    if (gate !== "ok") return json(createComplaintResponseSchema.parse({ complaint: toReceipt(gate.replay) }), requestId);

    const queue = routeComplaint({
      category: input.category,
      description: input.description,
      evidenceCount: input.evidence.length,
      hasVehicleId: Boolean(input.plate ?? input.bodyNumber),
    });

    let row: ReceiptRow | undefined;
    for (let attempt = 0; attempt < REF_ATTEMPTS && !row; attempt++) {
      const reference = generateReference((n) => randomBytes(n));
      try {
        row = await withRequestContext(ctx, async (db) => {
          const res = await db.execute<ReceiptRow>(sql`
            select * from priv.submit_complaint(
              ${input.clientRequestId}::uuid, ${reference}, ${input.category}, ${input.description},
              ${input.incidentAt}::timestamptz,
              ${input.gps?.lat ?? null}::double precision, ${input.gps?.lng ?? null}::double precision,
              ${input.gps?.accuracyM ?? null}::numeric,
              ${input.locationText ?? null}, ${input.operator ?? null}, ${input.plate ?? null}, ${input.bodyNumber ?? null},
              ${queue}, ${JSON.stringify(input.evidence)}::jsonb
            )
          `);
          return res.rows[0];
        });
      } catch (error) {
        const code = pgCode(error);
        // A reference clash (or a concurrent retry of the same request): try again; the replay
        // path inside the function returns the stored report.
        if (code === "23505") continue;
        if (code === "22023") throw badRequest("A photo or video could not be attached. Remove it and try again.");
        throw error;
      }
    }
    if (!row) throw new ApiProblem(503, "unavailable", "The report could not be saved. Try again.");
    return json(createComplaintResponseSchema.parse({ complaint: toReceipt(row) }), requestId, 201);
  });
}

type ListRow = ReceiptRow & { incident_at: string | Date; evidence: { id: string; captureKind: string }[] | null };

/** GET /api/v1/me/complaints: the caller's own reports only (RLS repeats it), newest first. */
export function listMyComplaints(request: Request): Promise<Response> {
  return privateRoute(request, "me-complaints", async (requestId) => {
    const user = await authorize("complaint.submit");
    const rows = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      const res = await db.execute<ListRow>(sql`
        select c.id, c.public_ref, c.category, c.status, c.submitted_at, c.incident_at,
               (select coalesce(json_agg(json_build_object('id', m.id, 'captureKind', m.capture_kind) order by m.received_at_server), '[]'::json)
                  from priv.complaint_media m where m.complaint_id = c.id) as evidence
          from priv.complaint c
         where c.reporter_id = ${user.id}
         order by c.created_at desc
         limit ${LIST_LIMIT}
      `);
      return res.rows;
    });
    const body = myComplaintsResponseSchema.parse({
      complaints: rows.map((r) => ({
        ...toReceipt(r),
        incidentAt: new Date(r.incident_at).toISOString(),
        evidence: r.evidence ?? [],
      })),
    });
    return json(body, requestId);
  });
}

/**
 * GET /api/v1/me/complaints/[id]/evidence/[evidenceId]: a 60 s signed link to one of the caller's
 * own evidence files. Someone else's report, a bad id and a missing file all answer the same 404.
 * A fresh step-up is required first (403 step_up_required otherwise), before any lookup.
 * The issuance is recorded in priv.evidence_access by the definer function before signing.
 */
export function getMyEvidenceUrl(request: Request, complaintId: string, evidenceId: string): Promise<Response> {
  return privateRoute(request, "me-complaint-evidence", async (requestId) => {
    const user = await authorize("complaint.submit");
    if (!UUID_RE.test(complaintId) || !UUID_RE.test(evidenceId)) throw notFound("Not found.");
    const stepUpKey = await currentStepUpKey(user.id);
    let found: { bucket: string; object_key: string } | "rate_limited" | "step_up" | null;
    try {
      found = await withRequestContext({ userId: user.id, requestId }, async (db) => {
        if (!(await checkRateLimit(db, request, RATE_LIMITS.evidenceUrlPerHour, user.id))) return "rate_limited" as const;
        // Step-up (spec 05 §5.4/§5.8): set app.step_up_at in this same transaction; the definer
        // function repeats the check (priv.require_step_up) and fails closed.
        if (!(await applyStepUp(db, stepUpKey))) return "step_up" as const;
        const res = await db.execute<{ bucket: string; object_key: string }>(sql`
          select bucket, object_key from priv.my_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)
        `);
        return res.rows[0] ?? null;
      });
    } catch (error) {
      if (isStepUpError(error)) throw stepUpRequired();
      throw error;
    }
    if (found === "rate_limited") throw tooManyRequests();
    if (found === "step_up") throw stepUpRequired();
    if (!found) throw notFound("Not found.");
    const url = await getStorage().createPresignedDownload(found.bucket, found.object_key, EVIDENCE_URL_TTL_S);
    return json(evidenceUrlResponseSchema.parse({ url, expiresInSeconds: EVIDENCE_URL_TTL_S }), requestId);
  });
}
