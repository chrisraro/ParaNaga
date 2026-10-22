// Publication validation (F-E11, spec 02 "Publication validation must flag …", screen A12). Pure.
// Input: the facts transit.admin_validation_facts (migration 0023) reads for one revision, including
// a rolled-back dry run of transit.publish_revision. Output: the report the A12 screen shows and the
// database stores; publishing is refused while it has any error (transit.admin_publish_revision).
// The synthetic guard is src/domain/network/publication.ts (N4) and runs first.
import { publicationBlockers, type PublishableRow } from "@/domain/network/publication";

/**
 * The service area: the same envelope as the database CHECK stop_point_version_in_city (0001),
 * 123.05 to 123.40 E, 13.45 to 13.80 N. Terminals have no such CHECK, so this is where they are held to it.
 */
export const SERVICE_BBOX = { west: 123.05, south: 13.45, east: 123.4, north: 13.8 } as const;

export type RevisionKind = "provisional" | "verified";

export type ValidationFacts = {
  revision: { id: string; label: string; kind: RevisionKind; status: string; isSynthetic: boolean };
  membershipHash: string;
  /** transit.publish_revision's own checks (dry run, rolled back). */
  dbCheck: { ok: true } | { ok: false; code: string; message: string };
  /** isSynthetic null: the member's row does not exist. */
  members: { kind: string; code: string; isSynthetic: boolean | null }[];
  /**
   * Since 0024 (N5b) each stop also carries its status, curb side, the evidence claims linked to
   * its version, the metres it moved since the parent revision's version (null: same version or
   * new), and whether a member variant's stop order uses it.
   */
  stops: {
    stopPointId: string;
    layer: string | null;
    code: string | null;
    name: string;
    lat: number;
    lng: number;
    status: string;
    curbSide: string | null;
    evidenceClaims: string[];
    movedM: number | null;
    inSequence: boolean;
  }[];
  terminals: { code: string; lat: number; lng: number }[];
  variants: {
    ref: string;
    kind: string;
    trialStatus: string | null;
    effectiveFrom: string | null;
    trialDurationDays: number | null;
    evidenceLevel: string;
    hasFareEvidence: boolean;
  }[];
  routeStops: { variantRef: string; seq: number; distAlongM: number }[];
  shapes: { variantRef: string; traceStatus: string; untracedReason: string | null; measures: { seq: unknown; measureM: unknown }[] }[];
};

export type Severity = "error" | "warning";

/**
 * A stop that moved farther than this between the parent revision and this one is flagged: its
 * approximate path's stop measure is stale and riders' saved trips point at the old spot.
 */
export const STOP_MOVED_FLAG_M = 50;

export const RULES = {
  synthetic: { title: "Synthetic (test) rows", severity: "error" },
  missing_member: { title: "Members whose row is missing", severity: "error" },
  database_checks: {
    title: "Database publish checks (stop order from 1, member routes and stop versions, shapes, time parameters)",
    severity: "error",
  },
  outside_service_area: { title: "Coordinates outside the service area", severity: "error" },
  trial_without_status: { title: "Trial variant without a status and a review date", severity: "error" },
  stop_order_not_monotonic: { title: "Stop order not increasing along the route", severity: "error" },
  shape_measure_order: { title: "Stop measures not increasing along the approximate path", severity: "warning" },
  source_code_collision: { title: "Two stops with the same source layer and code", severity: "kind" },
  missing_fare_evidence: { title: "Variant with no fare evidence for its route", severity: "kind" },
  disconnected_shape: { title: "Disconnected path (trace not continuous)", severity: "kind" },
  // N5b (C3): the stop review data of migration 0024.
  promoted_without_evidence: { title: "Stop promoted beyond candidate with no evidence linked", severity: "kind" },
  curb_without_evidence: { title: "Curb side recorded without curb position evidence", severity: "kind" },
  retired_stop_in_sequence: { title: "Retired stop still in a route's stop order", severity: "error" },
  stop_moved_far: { title: `Stop moved more than ${STOP_MOVED_FLAG_M} m since the published revision`, severity: "warning" },
} as const satisfies Record<string, { title: string; severity: Severity | "kind" }>;

export type RuleId = keyof typeof RULES;

/** Spec rules that cannot be checked with the data on file yet. */
export const DEFERRED_RULES = [
  {
    id: "opposite_direction_boarding",
    title: "Opposite-direction boarding",
    reason: "Needs reviewed directed shapes (C4); curb sides can be recorded now (C3) but no shape is reviewed yet.",
  },
  {
    id: "disruption_without_expiry",
    title: "Disruption without expiry",
    reason: "There are no disruptions yet (C7); the table will require an end time.",
  },
] as const;

export type ValidationIssue = { rule: RuleId; severity: Severity; ref: string; message: string };

export type ValidationReport = {
  revisionId: string;
  label: string;
  kind: RevisionKind;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  /** At most ISSUES_PER_RULE per rule; the counts above are complete. */
  issues: ValidationIssue[];
  rules: { id: RuleId; title: string; severity: Severity; count: number }[];
  deferred: { id: string; title: string; reason: string }[];
};

export const ISSUES_PER_RULE = 25;

/** "kind" rules are errors on a verified revision and warnings on a provisional one (estimates only). */
export function severityOf(rule: RuleId, kind: RevisionKind): Severity {
  const s = RULES[rule].severity;
  return s === "kind" ? (kind === "verified" ? "error" : "warning") : s;
}

const inBbox = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lng >= SERVICE_BBOX.west && lng <= SERVICE_BBOX.east && lat >= SERVICE_BBOX.south && lat <= SERVICE_BBOX.north;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

type Found = { rule: RuleId; ref: string; message: string };

/** Statuses that claim more than a source pin (spec 04 §4.6). */
const PROMOTED = new Set(["documentary", "installed", "field_verified", "published"]);

function findings(facts: ValidationFacts): Found[] {
  const out: Found[] = [];

  // N4's synthetic guard over every member that exists.
  const rows: PublishableRow[] = facts.members
    .filter((m) => m.isSynthetic !== null)
    .map((m) => ({ kind: m.kind, code: m.code, isSynthetic: m.isSynthetic === true }));
  if (facts.revision.isSynthetic) rows.push({ kind: "revision", code: facts.revision.label, isSynthetic: true });
  for (const b of publicationBlockers(rows)) out.push({ rule: "synthetic", ref: `${b.kind} ${b.code}`, message: "Synthetic test data is never published." });

  for (const m of facts.members.filter((x) => x.isSynthetic === null)) {
    out.push({ rule: "missing_member", ref: `${m.kind} ${m.code}`, message: "The member points at a row that does not exist." });
  }

  if (!facts.dbCheck.ok) out.push({ rule: "database_checks", ref: facts.dbCheck.code, message: facts.dbCheck.message });

  for (const s of facts.stops) {
    if (!inBbox(s.lat, s.lng)) {
      out.push({ rule: "outside_service_area", ref: `stop ${s.layer ?? ""} ${s.code ?? s.name}`.replace(/\s+/g, " "), message: `${s.lat}, ${s.lng} is outside the service area.` });
    }
  }
  for (const t of facts.terminals) {
    if (!inBbox(t.lat, t.lng)) out.push({ rule: "outside_service_area", ref: `terminal ${t.code}`, message: `${t.lat}, ${t.lng} is outside the service area.` });
  }

  for (const v of facts.variants) {
    if (v.kind !== "trial") continue;
    const missing = [!v.trialStatus && "a status", !(v.effectiveFrom && v.trialDurationDays) && "a start date and duration (review date)"].filter(Boolean);
    if (missing.length > 0) out.push({ rule: "trial_without_status", ref: v.ref, message: `The trial has no ${missing.join(" and no ")}.` });
  }

  const byVariant = new Map<string, { seq: number; m: number }[]>();
  for (const r of facts.routeStops) byVariant.set(r.variantRef, [...(byVariant.get(r.variantRef) ?? []), { seq: r.seq, m: r.distAlongM }]);
  for (const [ref, list] of byVariant) {
    const sorted = [...list].sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.m < sorted[i - 1]!.m) {
        out.push({ rule: "stop_order_not_monotonic", ref, message: `Stop ${sorted[i]!.seq} comes before stop ${sorted[i - 1]!.seq} along the route.` });
        break;
      }
    }
  }

  for (const s of facts.shapes) {
    if (s.traceStatus === "untraced" && s.untracedReason === "not_continuous") {
      out.push({ rule: "disconnected_shape", ref: s.variantRef, message: "The path could not be traced as one continuous line." });
    }
    const measures = s.measures
      .map((x) => ({ seq: num(x.seq), m: num(x.measureM) }))
      .filter((x): x is { seq: number; m: number } => x.seq !== null && x.m !== null)
      .sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < measures.length; i++) {
      if (measures[i]!.m < measures[i - 1]!.m) {
        out.push({ rule: "shape_measure_order", ref: s.variantRef, message: `Stop ${measures[i]!.seq} is measured before stop ${measures[i - 1]!.seq}.` });
        break;
      }
    }
  }

  const byCode = new Map<string, Set<string>>();
  for (const s of facts.stops) {
    if (!s.layer || !s.code) continue;
    const key = `${s.layer} ${s.code}`;
    byCode.set(key, (byCode.get(key) ?? new Set()).add(s.stopPointId));
  }
  for (const [key, ids] of byCode) {
    if (ids.size > 1) out.push({ rule: "source_code_collision", ref: key, message: `${ids.size} different stops use this code.` });
  }

  for (const v of facts.variants) {
    if (!v.hasFareEvidence) out.push({ rule: "missing_fare_evidence", ref: v.ref, message: "No fare rule for the route's mode and no reported fare for the route." });
  }

  for (const s of facts.stops) {
    const ref = `stop ${s.layer ?? ""} ${s.code ?? s.name}`.replace(/\s+/g, " ").trim();
    if (PROMOTED.has(s.status) && s.evidenceClaims.length === 0) {
      out.push({ rule: "promoted_without_evidence", ref, message: `The stop is ${s.status.replace(/_/g, " ")} but no evidence is linked to it.` });
    }
    if (s.curbSide && s.curbSide !== "unknown" && !s.evidenceClaims.includes("curb_position")) {
      out.push({ rule: "curb_without_evidence", ref, message: `Curb side ${s.curbSide.replace(/_/g, " ")} has no curb position evidence.` });
    }
    if (s.status === "retired" && s.inSequence) {
      out.push({ rule: "retired_stop_in_sequence", ref, message: "A route's stop order still uses this retired stop." });
    }
    if (s.movedM !== null && s.movedM > STOP_MOVED_FLAG_M) {
      out.push({ rule: "stop_moved_far", ref, message: `Moved ${Math.round(s.movedM)} m; check its route's approximate path and the reason given.` });
    }
  }
  return out;
}

export function validateRevision(facts: ValidationFacts): ValidationReport {
  const kind = facts.revision.kind;
  const all = findings(facts).map((f) => ({ ...f, severity: severityOf(f.rule, kind) }));
  const ids = Object.keys(RULES) as RuleId[];
  const rules = ids.map((id) => ({ id, title: RULES[id].title, severity: severityOf(id, kind), count: all.filter((f) => f.rule === id).length }));
  const issues = ids.flatMap((id) => all.filter((f) => f.rule === id).slice(0, ISSUES_PER_RULE));
  const errorCount = all.filter((f) => f.severity === "error").length;
  return {
    revisionId: facts.revision.id,
    label: facts.revision.label,
    kind,
    ok: errorCount === 0,
    errorCount,
    warningCount: all.length - errorCount,
    issues,
    rules,
    deferred: DEFERRED_RULES.map((d) => ({ ...d })),
  };
}
