import "server-only";
import { sql } from "drizzle-orm";
import { AI_DISCLOSURE_KIND, AI_DISCLOSURE_VERSION } from "@/domain/corrections/disclosure";
import {
  correctionSummarySchema,
  createCorrectionPayloadSchema,
  createCorrectionResponseSchema,
  myCorrectionsResponseSchema,
  type CorrectionSummary,
} from "@/domain/corrections/schemas";
import { decideModeration, type JevOutcome } from "@/domain/moderation/policy";
import { maskForAi } from "@/domain/moderation/mask";
import { createJevClient } from "@/server/adapters/jev/client";
import { badRequest, authedRoute, CACHE, readJsonBody, tooManyRequests, ApiProblem } from "@/server/api/http";
import { authorize } from "@/server/auth/authorize";
import { withRequestContext } from "@/server/db/context";
import { serverEnv } from "@/server/env";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";

const BODY_MAX_BYTES = 8192;
const LIST_LIMIT = 50;

type SummaryRow = {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  status: string;
  submitted_at: string | Date | null;
};

const toSummary = (r: SummaryRow): CorrectionSummary =>
  correctionSummarySchema.parse({
    id: r.id,
    category: r.kind,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    status: r.status,
    submittedAt: new Date(r.submitted_at ?? Date.now()).toISOString(),
  });

const noStore = (requestId: string) => ({ "Cache-Control": CACHE.none, "X-Request-Id": requestId });

/** Postgres error code, whether the driver error is wrapped or not. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Jev is advisory only: any failure keeps the report pending and never blocks the commuter. */
async function moderate(description: string): Promise<{ reason: string }> {
  let jev: JevOutcome = null;
  try {
    const env = serverEnv();
    const flags = { autoPublishEnabled: env.AUTO_PUBLISH_ENABLED, complaintsEnabled: false, complaintsLegalClearance: false };
    jev = await createJevClient().classify({ kind: "community", text: maskForAi(description), flags });
    return { reason: decideModeration({ kind: "community", jev, flags }).reason };
  } catch {
    return { reason: "jev_unavailable" };
  }
}

/**
 * POST /api/v1/corrections: create and submit in one call. Order: authorize, validate, rate limit,
 * disclosure, Jev (advisory), then the definer function. A correction only ever lands as
 * 'submitted' for a human reviewer; it never touches published transit data.
 */
export function createCorrection(request: Request): Promise<Response> {
  return authedRoute(request, "corrections", async (requestId) => {
    const user = await authorize("correction.submit");
    const parsed = createCorrectionPayloadSchema.safeParse(await readJsonBody(request, BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the report and try again.");
    const input = parsed.data;

    const gate = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      if (!(await checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id))) return "rate_limited" as const;
      if (!(await checkRateLimit(db, request, RATE_LIMITS.mutationPerHour, user.id))) return "rate_limited" as const;

      const seen = await db.execute<{ one: number }>(sql`
        select 1 as one from core.ack
         where user_id = ${user.id} and kind = ${AI_DISCLOSURE_KIND} and version = ${AI_DISCLOSURE_VERSION}
      `);
      if (seen.rows.length > 0) return "ok" as const;
      if (!input.aiDisclosureAccepted) return "disclosure_required" as const;
      await db.execute(sql`
        insert into core.ack (user_id, kind, version)
        values (${user.id}, ${AI_DISCLOSURE_KIND}, ${AI_DISCLOSURE_VERSION})
        on conflict (user_id, kind, version) do nothing
      `);
      return "ok" as const;
    });
    if (gate === "rate_limited") throw tooManyRequests("You are sending reports too quickly. Please wait a moment.");
    if (gate === "disclosure_required") throw badRequest("Accept the note about how reports are checked before sending.");

    const { reason } = await moderate(input.description);

    let row: SummaryRow | undefined;
    try {
      row = await withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<SummaryRow>(sql`
          select * from community.submit_correction(
            ${input.clientRequestId}::uuid, ${input.category}, ${input.entityType}, ${input.entityId},
            ${input.entityLabel ?? null}, ${input.description},
            ${input.location?.lat ?? null}::double precision, ${input.location?.lng ?? null}::double precision,
            ${input.location?.accuracyM ?? null}::numeric,
            ${`{${input.mediaIds.join(",")}}`}::uuid[], ${reason}
          )
        `);
        return res.rows[0];
      });
    } catch (error) {
      if (pgCode(error) === "22023") throw badRequest("A photo could not be attached. Remove it and try again.");
      throw error;
    }
    if (!row) throw new ApiProblem(503, "unavailable", "The report could not be saved. Try again.");

    const body = createCorrectionResponseSchema.parse({ correction: toSummary(row) });
    return Response.json(body, { status: 201, headers: noStore(requestId) });
  });
}

/** GET /api/v1/me/corrections: the signed-in commuter's own reports, newest first (RLS repeats it). */
export function listMyCorrections(request: Request): Promise<Response> {
  return authedRoute(request, "me-corrections", async (requestId) => {
    const user = await authorize("correction.submit");
    const rows = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      const res = await db.execute<SummaryRow>(sql`
        select id, kind, entity_type, entity_id, entity_label, status, coalesce(submitted_at, created_at) as submitted_at
          from community.correction
         where author_id = ${user.id}
         order by created_at desc
         limit ${LIST_LIMIT}
      `);
      return res.rows;
    });
    const body = myCorrectionsResponseSchema.parse({ corrections: rows.map(toSummary) });
    return Response.json(body, { headers: noStore(requestId) });
  });
}
