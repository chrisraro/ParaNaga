import "server-only";
import { sql } from "drizzle-orm";
import type { ImportBaseline } from "@/domain/admin/imports";
import { pinMismatches, similarPairNames } from "@/domain/admin/reconcile";
import {
  importCommitResultSchema,
  importListSchema,
  reconciliationSchema,
  stopListSchema,
  type ImportCommitResult,
  type ImportList,
  type ReconcilePayload,
  type Reconciliation,
  type StopAction,
  type StopList,
} from "@/domain/admin/stops";
import type { Db } from "@/server/db/context";
import { toIso } from "./repo";

// The database calls of candidate review, stops and curbs, reconciliation and imports (N5b). Each
// goes through a SECURITY DEFINER function of migration 0024, which checks the caller's role and,
// for writes, the open draft and the stop version the page saw.

type Obj = Record<string, unknown>;

async function scalar(db: Db, query: ReturnType<typeof sql>): Promise<unknown> {
  const r = (await db.execute(query)).rows[0] as Obj | undefined;
  return r ? Object.values(r)[0] : undefined;
}

const num = (v: unknown) => (v === null || v === undefined ? v : Number(v));
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

function revisionOf(r: Obj | null | undefined) {
  return r ? { id: r.id, label: r.label, kind: r.kind, status: r.status } : null;
}

export async function readStops(db: Db): Promise<StopList> {
  const d = ((await scalar(db, sql`select transit.admin_stops(null) as d`)) ?? {}) as Obj;
  const revision = revisionOf(d.revision as Obj | null);
  return stopListSchema.parse({
    revision,
    editable: revision?.status === "draft",
    stops: list(d.stops).map((s) => ({
      ...s,
      lat: num(s.lat),
      lng: num(s.lng),
      pins: list(s.pins).map((p) => ({ ...p, lat: num(p.lat), lng: num(p.lng) })),
      evidence: list(s.evidence).map((e) => ({ ...e, createdAt: toIso(e.createdAt) })),
    })),
  });
}

/** One stop action; returns the stop's new member version in the draft. */
export async function runStopAction(db: Db, stopPointId: string, a: StopAction): Promise<string> {
  const id = sql`${stopPointId}::uuid`;
  const expected = sql`${a.expectedVersionId}::uuid`;
  let query: ReturnType<typeof sql>;
  switch (a.action) {
    case "promote":
      query = sql`select transit.admin_promote_stop(${id}, ${expected}, ${a.status}, ${a.note ?? null}) as v`;
      break;
    case "evidence":
      query = sql`select transit.admin_attach_stop_evidence(${id}, ${expected}, ${a.kind}, ${a.claim}, ${a.note ?? null},
        ${a.observedOn ?? null}::date, ${a.sourceCode ?? null}, ${a.mediaObjectId ?? null}::uuid) as v`;
      break;
    case "retire":
      query = sql`select transit.admin_retire_stop(${id}, ${expected}, ${a.reason}) as v`;
      break;
    case "relocate":
      query = sql`select transit.admin_relocate_stop(${id}, ${expected}, ${a.lat}::float8, ${a.lng}::float8, ${a.reason}) as v`;
      break;
    case "edit":
      query = sql`select transit.admin_edit_stop(${id}, ${expected}, ${JSON.stringify(a.changes)}::jsonb) as v`;
      break;
  }
  const v = await scalar(db, query);
  if (typeof v !== "string") throw new Error("the stop action returned no version");
  return v;
}

export async function readReconciliation(db: Db): Promise<Reconciliation> {
  const d = ((await scalar(db, sql`select transit.admin_reconciliation() as d`)) ?? {}) as Obj;
  const revision = revisionOf(d.revision as Obj | null);
  const stop = (s: Obj): Obj => ({ ...s, lat: num(s.lat), lng: num(s.lng) });
  return reconciliationSchema.parse({
    revision,
    editable: revision?.status === "draft",
    pairs: list(d.pairs).map((p) => {
      const a = stop(p.a as Obj);
      const b = stop(p.b as Obj);
      return { a, b, distanceM: num(p.distanceM), similarNames: similarPairNames(String(a.name), String(b.name)) };
    }),
    mismatches: pinMismatches(
      list(d.pins).map((p) => ({
        stopPointId: String(p.stopPointId),
        name: String(p.name),
        status: String(p.status),
        pinLayer: String(p.pinLayer),
        pinCode: (p.pinCode as string | null) ?? null,
        pinLabel: String(p.pinLabel),
        distanceM: Number(p.distanceM),
      })),
    ),
    decisions: list(d.decisions).map((x) => ({ ...x, distanceM: num(x.distanceM), decidedAt: toIso(x.decidedAt) })),
  });
}

export type ReconcileOutcome = { decision: ReconcilePayload["decision"]; keptVersionId: string | null; retiredVersionId: string | null };

export async function reconcile(db: Db, p: ReconcilePayload): Promise<ReconcileOutcome> {
  const r = ((await scalar(
    db,
    sql`select transit.admin_reconcile(${p.a.stopPointId}::uuid, ${p.a.expectedVersionId}::uuid, ${p.b.stopPointId}::uuid,
      ${p.b.expectedVersionId}::uuid, ${p.decision}, ${p.keepStopPointId ?? null}::uuid, ${p.note ?? null}) as r`,
  )) ?? {}) as Obj;
  const id = (v: unknown) => (typeof v === "string" ? v : null);
  return { decision: p.decision, keptVersionId: id(r.keptVersionId), retiredVersionId: id(r.retiredVersionId) };
}

export async function readImports(db: Db): Promise<ImportList> {
  const baseline = (await scalar(db, sql`select ingest.admin_import_baseline() as b`)) as Obj | null;
  const batches = list(await scalar(db, sql`select ingest.admin_import_batches(20) as b`));
  return importListSchema.parse({
    baseline: baseline
      ? { batchId: baseline.batchId, snapshotVersion: baseline.snapshotVersion, mapId: baseline.mapId, finishedAt: toIso(baseline.finishedAt) }
      : null,
    batches: batches.map((b) => {
      const c = (b.changes ?? {}) as Obj;
      return {
        id: b.id,
        snapshotVersion: b.snapshotVersion,
        mode: b.mode,
        status: b.status,
        startedBy: b.startedBy,
        startedAt: toIso(b.startedAt),
        finishedAt: toIso(b.finishedAt),
        fileName: b.fileName ?? null,
        changes: { added: Number(c.added ?? 0), changed: Number(c.changed ?? 0), unchanged: Number(c.unchanged ?? 0), missing: Number(c.missing ?? 0) },
        conflicts: Number(b.conflicts ?? 0),
      };
    }),
  });
}

export async function readImportBaseline(db: Db): Promise<ImportBaseline | null> {
  const b = (await scalar(db, sql`select ingest.admin_import_baseline() as b`)) as Obj | null;
  if (!b) return null;
  return {
    batchId: String(b.batchId),
    snapshotVersion: String(b.snapshotVersion),
    mapId: String(b.mapId),
    features: list(b.features).map((f) => ({
      sourceIdentity: String(f.sourceIdentity),
      contentHash: String(f.contentHash),
      layer: String(f.layer),
      code: (f.code as string | null) ?? null,
      label: String(f.label),
      lat: Number(f.lat),
      lng: Number(f.lng),
    })),
  };
}

export async function commitImport(db: Db, plan: Record<string, unknown>): Promise<ImportCommitResult> {
  const r = ((await scalar(db, sql`select ingest.admin_import_commit(${JSON.stringify(plan)}::jsonb) as r`)) ?? {}) as Obj;
  return importCommitResultSchema.parse({ ...r, revisionId: r.revisionId ?? null });
}
