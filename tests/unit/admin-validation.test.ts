// Publication validation (N5a, F-E11): one fixture per rule, severities by revision kind, the N4
// synthetic guard first, caps and counts. Pure; the facts mirror transit.admin_validation_facts (0023).
import { describe, expect, it } from "vitest";
import { validationFactsSchema, validationReportSchema } from "@/domain/admin/schemas";
import { DEFERRED_RULES, ISSUES_PER_RULE, RULES, severityOf, validateRevision, type ValidationFacts } from "@/domain/admin/validation";

const REV = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const STOP_A = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const STOP_B = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
// The stop fields 0024 (N5b) added, at their neutral values.
const S = { status: "candidate", curbSide: null, evidenceClaims: [] as string[], movedM: null, inSequence: false };

function facts(over: Partial<ValidationFacts> = {}, kind: "provisional" | "verified" = "provisional"): ValidationFacts {
  return {
    revision: { id: REV, label: "draft-x", kind, status: "draft", isSynthetic: false },
    membershipHash: "a".repeat(64),
    dbCheck: { ok: true },
    members: [
      { kind: "route", code: "R8-A", isSynthetic: false },
      { kind: "stop_point", code: "Loop Service A A1", isSynthetic: false },
    ],
    stops: [{ ...S, stopPointId: STOP_A, layer: "Loop Service A", code: "A1", name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726 }],
    terminals: [{ code: "T01", lat: 13.62, lng: 123.19 }],
    variants: [
      { ref: "R8-A clockwise", kind: "permanent", trialStatus: null, effectiveFrom: null, trialDurationDays: null, evidenceLevel: "provisional", hasFareEvidence: true },
    ],
    routeStops: [],
    shapes: [],
    ...over,
  };
}

const rules = (f: ValidationFacts) => validateRevision(f).issues.map((i) => i.rule);

describe("validateRevision", () => {
  it("passes a clean revision and lists every rule plus the deferred ones", () => {
    const r = validateRevision(facts());
    expect(r).toMatchObject({ ok: true, errorCount: 0, warningCount: 0, issues: [] });
    expect(r.rules.map((x) => x.id)).toEqual(Object.keys(RULES));
    expect(r.deferred.map((d) => d.id)).toEqual(DEFERRED_RULES.map((d) => d.id));
    expect(validationReportSchema.parse({ ...r, validatedAt: "2026-10-22T02:00:00.000Z" })).toBeTruthy();
  });

  it("runs N4's synthetic guard over the members (and the revision itself)", () => {
    const r = validateRevision(facts({ members: [{ kind: "route", code: "FX-1", isSynthetic: true }], revision: { id: REV, label: "fx", kind: "provisional", status: "draft", isSynthetic: true } }));
    expect(r.ok).toBe(false);
    expect(r.issues.filter((i) => i.rule === "synthetic").map((i) => i.ref)).toEqual(["route FX-1", "revision fx"]);
  });

  it("flags a member whose row is missing", () => {
    expect(rules(facts({ members: [{ kind: "variant", code: "x", isSynthetic: null }] }))).toEqual(["missing_member"]);
  });

  it("carries the database's own publish checks (dry run) as an error", () => {
    const r = validateRevision(facts({ dbCheck: { ok: false, code: "23514", message: "revision x has stop seq not contiguous from 1" } }));
    expect(r.issues).toEqual([{ rule: "database_checks", severity: "error", ref: "23514", message: "revision x has stop seq not contiguous from 1" }]);
    expect(r.ok).toBe(false);
  });

  it("flags stops and terminals outside the service area", () => {
    const f = facts({
      stops: [{ ...S, stopPointId: STOP_A, layer: "L", code: "A1", name: "n", lat: 14.6, lng: 121.0 }],
      terminals: [{ code: "T99", lat: 13.1, lng: 123.7 }],
    });
    expect(validateRevision(f).issues.map((i) => [i.rule, i.ref])).toEqual([
      ["outside_service_area", "stop L A1"],
      ["outside_service_area", "terminal T99"],
    ]);
  });

  it("needs a status and a review date on a trial variant", () => {
    const trial = { ref: "R2 clockwise (trial)", kind: "trial", evidenceLevel: "documentary", hasFareEvidence: true };
    expect(rules(facts({ variants: [{ ...trial, trialStatus: "permanence_unconfirmed", effectiveFrom: "2025-06-01", trialDurationDays: 90 }] }))).toEqual([]);
    const r = validateRevision(facts({ variants: [{ ...trial, trialStatus: null, effectiveFrom: "2025-06-01", trialDurationDays: null }] }));
    expect(r.issues[0]).toMatchObject({ rule: "trial_without_status", severity: "error" });
    expect(r.issues[0]!.message).toContain("a status");
    expect(r.issues[0]!.message).toContain("review date");
  });

  it("flags stops whose distance along the route goes backwards", () => {
    const f = facts({ routeStops: [{ variantRef: "R8-A clockwise", seq: 1, distAlongM: 0 }, { variantRef: "R8-A clockwise", seq: 3, distAlongM: 100 }, { variantRef: "R8-A clockwise", seq: 2, distAlongM: 400 }] });
    expect(validateRevision(f).issues).toMatchObject([{ rule: "stop_order_not_monotonic", severity: "error", ref: "R8-A clockwise" }]);
  });

  it("warns on approximate-path measures out of order and on a disconnected trace", () => {
    const f = facts({
      shapes: [
        { variantRef: "R8-A clockwise", traceStatus: "ok", untracedReason: null, measures: [{ seq: 1, measureM: 50 }, { seq: 2, measureM: 10 }] },
        { variantRef: "R3 inbound", traceStatus: "untraced", untracedReason: "not_continuous", measures: [] },
      ],
    });
    const r = validateRevision(f);
    expect(r.issues.map((i) => [i.rule, i.severity])).toEqual([
      ["shape_measure_order", "warning"],
      ["disconnected_shape", "warning"],
    ]);
    expect(r.ok).toBe(true);
  });

  it("source-code collisions, missing fare evidence and disconnected paths: warnings when provisional, errors when verified", () => {
    const over: Partial<ValidationFacts> = {
      stops: [
        { ...S, stopPointId: STOP_A, layer: "Loop Service C", code: "C12", name: "a", lat: 13.62, lng: 123.18 },
        { ...S, stopPointId: STOP_B, layer: "Loop Service C", code: "C12", name: "b", lat: 13.63, lng: 123.18 },
      ],
      variants: [{ ref: "R5 inbound", kind: "permanent", trialStatus: null, effectiveFrom: null, trialDurationDays: null, evidenceLevel: "provisional", hasFareEvidence: false }],
    };
    const prov = validateRevision(facts(over, "provisional"));
    expect(prov.issues.map((i) => [i.rule, i.severity])).toEqual([
      ["source_code_collision", "warning"],
      ["missing_fare_evidence", "warning"],
    ]);
    expect(prov.ok).toBe(true);
    const ver = validateRevision(facts(over, "verified"));
    expect(ver.issues.every((i) => i.severity === "error")).toBe(true);
    expect(ver.ok).toBe(false);
    expect(severityOf("disconnected_shape", "verified")).toBe("error");
  });

  it("the same stop version listed twice is not a collision", () => {
    const s = { ...S, stopPointId: STOP_A, layer: "L", code: "A1", name: "a", lat: 13.62, lng: 123.18 };
    expect(rules(facts({ stops: [s, { ...s }] }))).toEqual([]);
  });

  it("caps the issues per rule but keeps the counts complete", () => {
    const stops = Array.from({ length: ISSUES_PER_RULE + 5 }, (_, i) => ({ ...S, stopPointId: STOP_A, layer: "L", code: `X${i}`, name: "n", lat: 0, lng: 0 }));
    const r = validateRevision(facts({ stops }));
    expect(r.issues).toHaveLength(ISSUES_PER_RULE);
    expect(r.errorCount).toBe(ISSUES_PER_RULE + 5);
    expect(r.rules.find((x) => x.id === "outside_service_area")!.count).toBe(ISSUES_PER_RULE + 5);
  });
});

describe("validationFactsSchema", () => {
  it("reads the jsonb the database builds (numeric distances as text included)", () => {
    const parsed = validationFactsSchema.parse({ ...facts(), routeStops: [{ variantRef: "v", seq: 1, distAlongM: "12.5" }] });
    expect(parsed.routeStops[0]!.distAlongM).toBe(12.5);
  });
});
