import "server-only";
import { sql } from "drizzle-orm";
import { isReviewReason, type ReviewReason } from "@/domain/corrections/review-reasons";
import { correctionSummarySchema } from "@/domain/corrections/schemas";
import {
  complaintAnswerSchema,
  complaintDetailResponseSchema,
  correctionAnswerSchema,
  correctionDetailResponseSchema,
  myNagaHandoffResponseSchema,
  myNagaSelfReportSchema,
  REPORT_KINDS,
  reportActionResponseSchema,
} from "@/domain/reports/schemas";
import { authedRoute, badRequest, CACHE, conflict, notFound, readJsonBody, tooManyRequests } from "@/server/api/http";
import { authorize } from "@/server/auth/authorize";
import { withRequestContext } from "@/server/db/context";
import { pgCode } from "@/server/db/pg-error";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";

// My reports detail and the MyNaga self-report (S19, S20, F-D5, task B9). Same rules as the
// driver report handlers: authorize() first; the database repeats ownership with forced RLS and a
// definer function; every response (errors included) is `private, no-store` with Referrer-Policy
// no-referrer; nothing from a report (text, plate, location, the MyNaga reference) is logged,
// because authedRoute logs only the route, request id and error class; never sent to Jev.

const BODY_MAX_BYTES = 1024;
const ANSWER_MAX_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function privateRoute(request: Request, route: string, run: (requestId: string) => Promise<Response>): Promise<Response> {
  const res = await authedRoute(request, route, run);
  res.headers.set("Cache-Control", CACHE.private);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

const json = (body: unknown, requestId: string) =>
  Response.json(body, { headers: { "Cache-Control": CACHE.private, "X-Request-Id": requestId } });

const iso = (v: string | Date | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

type ComplaintRow = {
  id: string;
  public_ref: string;
  category: string;
  status: string;
  submitted_at: string | Date;
  incident_at: string | Date;
  description: string;
  location_text: string | null;
  operator_text: string | null;
  plate_text: string | null;
  body_number_text: string | null;
  outcome_code: string | null;
};

/** GET /api/v1/me/complaints/[id]: the owner's own report in full. Someone else's and a bad id answer the same 404. */
export function getMyComplaint(request: Request, id: string): Promise<Response> {
  return privateRoute(request, "me-complaint", async (requestId) => {
    const user = await authorize("complaint.submit");
    if (!UUID_RE.test(id)) throw notFound("Not found.");
    const found = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      const main = await db.execute<ComplaintRow>(sql`
        select c.id, c.public_ref, c.category, c.status, c.submitted_at, c.incident_at, c.description,
               c.location_text, c.operator_text, c.plate_text, c.body_number_text, c.outcome_code
          from priv.complaint c
         where c.id = ${id}::uuid and c.reporter_id = ${user.id}
      `);
      const row = main.rows[0];
      if (!row) return null;
      const media = await db.execute<{ id: string; capture_kind: string }>(sql`
        select m.id, m.capture_kind from priv.complaint_media m
         where m.complaint_id = ${id}::uuid order by m.received_at_server
      `);
      const events = await db.execute<{ to_status: string; at: string | Date; note: string | null; own: boolean }>(sql`
        select e.to_status, e.at, e.note, e.actor_role = 'reporter' as own from priv.complaint_event e
         where e.complaint_id = ${id}::uuid and e.visibility = 'reporter' order by e.at
      `);
      const handoff = await db.execute<{ submitted_externally_at: string | Date | null; self_reported_reference: string | null }>(sql`
        select h.submitted_externally_at, h.self_reported_reference from priv.external_handoff h
         where h.complaint_id = ${id}::uuid
      `);
      return { row, media: media.rows, events: events.rows, handoff: handoff.rows[0] };
    });
    if (!found) throw notFound("Not found.");
    const { row, handoff } = found;
    const body = complaintDetailResponseSchema.parse({
      complaint: {
        id: row.id,
        reference: row.public_ref,
        category: row.category,
        status: row.status,
        submittedAt: iso(row.submitted_at),
        incidentAt: iso(row.incident_at),
        description: row.description,
        locationText: row.location_text,
        operator: row.operator_text,
        plate: row.plate_text,
        bodyNumber: row.body_number_text,
        outcomeCode: row.outcome_code,
        evidence: found.media.map((m) => ({ id: m.id, captureKind: m.capture_kind })),
        events: found.events.map((e) => ({ status: e.to_status, at: iso(e.at), note: e.note, own: e.own === true })),
        handoff: {
          submitted: Boolean(handoff?.submitted_externally_at),
          submittedAt: iso(handoff?.submitted_externally_at),
          reference: handoff?.self_reported_reference ?? null,
        },
      },
    });
    return json(body, requestId);
  });
}

type CorrectionRow = {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  status: string;
  submitted_at: string | Date;
  description: string;
  photos: number;
};

/** A templated reason from a reviewer's event, or null (any other code is never shown). */
function reviewerReason(actorRole: string | null, code: string | null): ReviewReason | null {
  return (actorRole === "transport_reviewer" || actorRole === "admin") && isReviewReason(code) ? code : null;
}

/** GET /api/v1/me/corrections/[id]: the author's own correction in full. */
export function getMyCorrection(request: Request, id: string): Promise<Response> {
  return privateRoute(request, "me-correction", async (requestId) => {
    const user = await authorize("correction.submit");
    if (!UUID_RE.test(id)) throw notFound("Not found.");
    const found = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      const main = await db.execute<CorrectionRow>(sql`
        select c.id, c.kind, c.entity_type, c.entity_id, c.entity_label, c.status,
               coalesce(c.submitted_at, c.created_at) as submitted_at, c.description, cardinality(c.media_ids) as photos
          from community.correction c
         where c.id = ${id}::uuid and c.author_id = ${user.id}
      `);
      const row = main.rows[0];
      if (!row) return null;
      // Reviewer events carry a templated reason the reporter may see (N6); a reviewer's note never
      // comes back, nor the advisory moderation reason stored on the submission event. The author's own
      // answer (0038) is the note of their own event.
      const events = await db.execute<{ to_status: string; at: string | Date; reason_code: string | null; actor_role: string | null; answer: string | null }>(sql`
        select e.to_status, e.at, e.reason_code, e.actor_role, case when e.actor_role = 'commuter' then e.note end as answer from community.correction_event e
         where e.correction_id = ${id}::uuid order by e.at
      `);
      return { row, events: events.rows };
    });
    if (!found) throw notFound("Not found.");
    const { row } = found;
    const summary = correctionSummarySchema.parse({
      id: row.id,
      category: row.kind,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityLabel: row.entity_label,
      status: row.status,
      submittedAt: iso(row.submitted_at),
    });
    const body = correctionDetailResponseSchema.parse({
      correction: { ...summary, description: row.description, photoCount: row.photos, events: found.events.map((e) => ({ status: e.to_status, at: iso(e.at), reason: reviewerReason(e.actor_role, e.reason_code), answer: e.answer ?? null })) },
    });
    return json(body, requestId);
  });
}

type HandoffRow = { submitted: boolean; submitted_at: string | Date | null; reference: string | null };

/**
 * POST /api/v1/me/reports/[kind]/[id]/mynaga: the reporter's own statement that they submitted
 * the report in MyNaga, with an optional reference. Lunad sends nothing to MyNaga or City Hall
 * and cannot confirm receipt; this is stored and shown back as self-reported, never as a status.
 * authorize -> strict zod -> rate limit -> priv.set_mynaga_handoff (definer, owner only).
 */
export function setMyNagaHandoff(request: Request, kind: string, id: string): Promise<Response> {
  return privateRoute(request, "me-report-mynaga", async (requestId) => {
    const user = await authorize("complaint.submit");
    if (!(REPORT_KINDS as readonly string[]).includes(kind) || !UUID_RE.test(id)) throw notFound("Not found.");
    const parsed = myNagaSelfReportSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the reference and try again. It can be up to 64 characters.");
    const input = parsed.data;
    const result = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      if (!(await checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id))) return "rate_limited" as const;
      const res = await db.execute<HandoffRow>(sql`
        select * from priv.set_mynaga_handoff(${id}::uuid, ${input.submitted}, ${input.reference ?? null})
      `);
      return res.rows[0] ?? null;
    });
    if (result === "rate_limited") throw tooManyRequests();
    if (!result) throw notFound("Not found.");
    return json(
      myNagaHandoffResponseSchema.parse({
        handoff: { submitted: result.submitted, submittedAt: iso(result.submitted_at), reference: result.reference },
      }),
      requestId,
    );
  });
}

/** Runs one reporter function (0038): null is 404, 55000 is 409 (the report moved on), 22023 is 400. */
async function reporterAction(request: Request, userId: string, requestId: string, query: ReturnType<typeof sql>, invalid: string): Promise<Response> {
  // In its own transaction, so a refused action still counts.
  const allowed = await withRequestContext({ userId, requestId }, (db) => checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, userId));
  if (!allowed) throw tooManyRequests();
  let done: boolean | null;
  try {
    done = await withRequestContext({ userId, requestId }, async (db) => (await db.execute<{ done: boolean | null }>(query)).rows[0]?.done ?? null);
  } catch (error) {
    const code = pgCode(error);
    if (code === "55000") throw conflict("This report changed. Reload it to see where it stands.");
    // 23505: the same file sent twice at the same moment.
    if (code === "22023" || code === "23505") throw badRequest(invalid);
    throw error;
  }
  if (!done) throw notFound("Not found.");
  return json(reportActionResponseSchema.parse({ ok: true }), requestId);
}

/** POST /api/v1/me/reports/complaint/[id]/withdraw: the reporter takes back their own driver report; deleted 30 days later. */
export function withdrawReport(request: Request, kind: string, id: string): Promise<Response> {
  return privateRoute(request, "me-report-withdraw", async (requestId) => {
    const user = await authorize("complaint.submit");
    if (kind !== "complaint" || !UUID_RE.test(id)) throw notFound("Not found.");
    return reporterAction(request, user.id, requestId, sql`select priv.withdraw_complaint(${id}::uuid) as done`, "Not found.");
  });
}

/** POST /api/v1/me/reports/[kind]/[id]/answer: the reporter answers a reviewer who asked for more. Never sent to Jev. */
export function answerReport(request: Request, kind: string, id: string): Promise<Response> {
  return privateRoute(request, "me-report-answer", async (requestId) => {
    const user = await authorize(kind === "correction" ? "correction.submit" : "complaint.submit");
    if ((kind !== "complaint" && kind !== "correction") || !UUID_RE.test(id)) throw notFound("Not found.");
    const raw = await readJsonBody(request, ANSWER_MAX_BYTES);
    const invalid = "Check your answer and the files, then try again.";
    if (kind === "complaint") {
      const p = complaintAnswerSchema.safeParse(raw);
      if (!p.success) throw badRequest(invalid);
      return reporterAction(request, user.id, requestId, sql`select priv.answer_complaint(${id}::uuid, ${p.data.text}, ${JSON.stringify(p.data.evidence)}::jsonb) as done`, invalid);
    }
    const p = correctionAnswerSchema.safeParse(raw);
    if (!p.success) throw badRequest(invalid);
    return reporterAction(request, user.id, requestId, sql`select community.answer_correction(${id}::uuid, ${p.data.text}, ${`{${p.data.mediaIds.join(",")}}`}::uuid[]) as done`, invalid);
  });
}
