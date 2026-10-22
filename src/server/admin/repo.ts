import "server-only";
import { sql } from "drizzle-orm";
import {
  adminDashboardSchema,
  coverageSchema,
  revisionListSchema,
  validationFactsSchema,
  type AdminDashboard,
  type Coverage,
  type RevisionList,
} from "@/domain/admin/schemas";
import type { ValidationFacts, ValidationReport } from "@/domain/admin/validation";
import type { Db } from "@/server/db/context";

// The admin console's database calls (N5a). Every one goes through a SECURITY DEFINER function of
// migration 0023, which checks the caller's role itself; paranaga_app has no other way to these rows.

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}

/** Timestamps arrive as Date (columns) or as Postgres text with an offset (jsonb): always ISO UTC. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const int = (v: unknown) => Number(v ?? 0);

export async function readDashboard(db: Db): Promise<AdminDashboard> {
  const [r] = await rows(db, sql`select transit.admin_dashboard() as d`);
  const d = (r?.d ?? {}) as Record<string, unknown>;
  const pub = d.published as Record<string, unknown> | null;
  const draft = d.latestDraft as Record<string, unknown> | null;
  const imp = d.lastImport as Record<string, unknown> | null;
  return adminDashboardSchema.parse({
    published: pub ? { id: pub.id, seq: int(pub.seq), label: pub.label, kind: pub.kind, publishedAt: toIso(pub.publishedAt) } : null,
    drafts: int(d.drafts),
    latestDraft: draft
      ? {
          id: draft.id,
          label: draft.label,
          createdAt: toIso(draft.createdAt),
          validationOk: typeof draft.validationOk === "boolean" ? draft.validationOk : null,
          validatedAt: toIso(draft.validatedAt),
          validationCurrent: typeof draft.validationCurrent === "boolean" ? draft.validationCurrent : null,
        }
      : null,
    stopsTotal: int(d.stopsTotal),
    stopCandidates: int(d.stopCandidates),
    openCorrections: int(d.openCorrections),
    lastImport: imp
      ? { snapshotVersion: imp.snapshotVersion, mode: imp.mode, status: imp.status, startedAt: toIso(imp.startedAt), finishedAt: toIso(imp.finishedAt) }
      : null,
  });
}

export async function listRevisions(db: Db): Promise<RevisionList> {
  const list = await rows(db, sql`select * from transit.admin_revisions(100)`);
  const revisions = list.map((r) => {
    const validatedAt = toIso(r.validated_at);
    return {
      id: r.id,
      seq: int(r.seq),
      label: r.label,
      kind: r.kind,
      status: r.status,
      createdAt: toIso(r.created_at),
      publishedAt: toIso(r.published_at),
      parentId: r.parent_revision_id ?? null,
      isSynthetic: r.is_synthetic === true,
      memberCount: int(r.member_count),
      isPublished: r.is_published === true,
      validation:
        typeof r.validation_ok === "boolean" && validatedAt
          ? {
              ok: r.validation_ok,
              validatedAt,
              errorCount: int(r.validation_errors),
              warningCount: int(r.validation_warnings),
              current: r.validation_current === true,
            }
          : null,
    };
  });
  return revisionListSchema.parse({ publishedId: revisions.find((r) => r.isPublished)?.id ?? null, revisions });
}

export async function createDraft(db: Db): Promise<string> {
  const [r] = await rows(db, sql`select transit.admin_create_draft() as id`);
  return String(r?.id);
}

export async function readValidationFacts(db: Db, revisionId: string): Promise<ValidationFacts> {
  const [r] = await rows(db, sql`select transit.admin_validation_facts(${revisionId}::uuid) as f`);
  return validationFactsSchema.parse(r?.f);
}

/** Stores the report (bound to the membership hash it was computed on); returns the validation time. */
export async function recordValidation(db: Db, revisionId: string, membershipHash: string, report: ValidationReport): Promise<string> {
  const [r] = await rows(
    db,
    sql`select transit.admin_record_validation(${revisionId}::uuid, ${membershipHash}, ${JSON.stringify(report)}::jsonb) ->> 'validatedAt' as at`,
  );
  const at = toIso(r?.at);
  if (!at) throw new Error("validation was not recorded");
  return at;
}

export async function publishRevision(
  db: Db,
  revisionId: string,
  expectedPublishedId: string | null,
  mode: "publish" | "rollback",
): Promise<{ previousRevisionId: string | null }> {
  const [r] = await rows(
    db,
    sql`select transit.admin_publish_revision(${revisionId}::uuid, ${expectedPublishedId}::uuid, ${mode}) as p`,
  );
  const p = (r?.p ?? {}) as Record<string, unknown>;
  return { previousRevisionId: typeof p.previousRevisionId === "string" ? p.previousRevisionId : null };
}

export async function readCoverage(db: Db, revisionId: string | null): Promise<Coverage> {
  const target =
    revisionId ?? (((await rows(db, sql`select revision_id from transit.published_pointer where singleton`))[0]?.revision_id as string | undefined) ?? null);
  if (!target) return coverageSchema.parse({ revisionId: null, label: null, rows: [] });
  const list = await rows(db, sql`select * from transit.admin_coverage(${target}::uuid)`);
  const [label] = await rows(db, sql`select label from transit.revision where id = ${target}::uuid`);
  return coverageSchema.parse({
    revisionId: target,
    label: (label?.label as string | undefined) ?? null,
    rows: list.map((r) => {
      const dims = (r.dimensions ?? {}) as Record<string, unknown>;
      const v = dims.exact_boarding_points_verified;
      return { barangay: r.barangay, surveyStatus: r.survey_status, exactBoardingPointsVerified: typeof v === "boolean" ? v : null };
    }),
  });
}
