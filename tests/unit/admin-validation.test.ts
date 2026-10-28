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

// IC1 (Task 6): the intercity facts of 0029. TODAY is fixed so the 180-day staleness check is stable.
const TODAY = "2026-10-28";
type Svc = NonNullable<ValidationFacts["regionalServices"]>[number];
const svc = (over: Partial<Svc> = {}): Svc => ({
  code: "RS-NAGA-LEGAZPI-VAN",
  status: "operating",
  mode: "uv_express",
  terminalCode: "T01",
  asOf: "2026-10-01",
  reviewBy: "2027-01-01",
  statusNoteCode: null,
  destinationCodes: ["LEGAZPI"],
  sourceEvidenceTypes: ["official"],
  departureCount: 0,
  observationCount: 0,
  observationsWithoutMonth: 0,
  ...over,
});
const regional = (services: Svc[], destinations = [{ code: "LEGAZPI", serviceCount: 1 }]) =>
  facts({ regionalServices: services, regionalDestinations: destinations });
const regionalFound = (f: ValidationFacts) =>
  validateRevision(f, TODAY).issues.filter((i) => i.rule.startsWith("regional_")).map((i) => [i.rule, i.severity, i.ref]);

describe("validateRevision: intercity (IC1)", () => {
  it("passes a clean regional service and destination", () => {
    const r = validateRevision(regional([svc()]), TODAY);
    expect(r).toMatchObject({ ok: true, errorCount: 0, warningCount: 0, issues: [] });
  });

  it("errors on a suspended or discontinued service that still has departures or fares", () => {
    const f = regional([
      svc({ code: "RS-A", status: "suspended", departureCount: 2 }),
      svc({ code: "RS-B", status: "discontinued_reported", observationCount: 1 }),
      svc({ code: "RS-C", status: "suspended" }),
    ]);
    expect(regionalFound(f)).toEqual([
      ["regional_not_running_with_facts", "error", "regional service RS-A"],
      ["regional_not_running_with_facts", "error", "regional service RS-B"],
    ]);
  });

  it("errors on an operating service with no official or news source", () => {
    const f = regional([
      svc({ code: "RS-A", sourceEvidenceTypes: ["community", "booking_site"] }),
      svc({ code: "RS-B", status: "operating_limited", sourceEvidenceTypes: [] }),
      svc({ code: "RS-C", sourceEvidenceTypes: ["news"] }),
      svc({ code: "RS-D", status: "unconfirmed", sourceEvidenceTypes: ["community"] }),
    ]);
    expect(regionalFound(f)).toEqual([
      ["regional_operating_without_official_or_news", "error", "regional service RS-A"],
      ["regional_operating_without_official_or_news", "error", "regional service RS-B"],
    ]);
  });

  it("errors on a fare observation with no month", () => {
    const f = regional([svc({ observationCount: 3, observationsWithoutMonth: 2 })]);
    expect(regionalFound(f)).toEqual([["regional_observation_without_month", "error", "regional service RS-NAGA-LEGAZPI-VAN"]]);
    expect(validateRevision(f, TODAY).issues[0]!.message).toContain("2");
  });

  it("errors when the review date is before the as-of date", () => {
    const f = regional([svc({ asOf: "2026-10-01", reviewBy: "2026-09-30" })]);
    expect(regionalFound(f)).toEqual([["regional_review_before_as_of", "error", "regional service RS-NAGA-LEGAZPI-VAN"]]);
  });

  it("errors on a destination code that is not a member destination", () => {
    const f = regional([svc({ destinationCodes: ["LEGAZPI", "SORSOGON"] })]);
    expect(regionalFound(f)).toEqual([["regional_unknown_destination", "error", "regional service RS-NAGA-LEGAZPI-VAN"]]);
    expect(validateRevision(f, TODAY).issues[0]!.message).toContain("SORSOGON");
  });

  it("warns when an operating service's as-of date is more than 180 days old", () => {
    // 2026-10-28 minus 180 days is 2026-05-01: that day is not stale, the day before is.
    expect(regionalFound(regional([svc({ asOf: "2026-05-01" })]))).toEqual([]);
    const f = regional([
      svc({ code: "RS-A", asOf: "2026-04-30" }),
      svc({ code: "RS-B", status: "suspended", asOf: "2025-01-01", reviewBy: "2025-02-01" }),
    ]);
    const r = validateRevision(f, TODAY);
    expect(regionalFound(f)).toEqual([["regional_operating_stale", "warning", "regional service RS-A"]]);
    expect(r.ok).toBe(true);
  });

  it("defaults today to the Manila date", () => {
    const old = svc({ asOf: "2000-01-01", reviewBy: "2000-02-01" });
    expect(validateRevision(regional([old])).issues.map((i) => i.rule)).toEqual(["regional_operating_stale"]);
  });

  it("warns on a member destination no member service reaches", () => {
    const f = regional([svc()], [{ code: "LEGAZPI", serviceCount: 1 }, { code: "IRIGA", serviceCount: 0 }]);
    expect(regionalFound(f)).toEqual([["regional_destination_without_service", "warning", "regional destination IRIGA"]]);
  });

  it("warns on a service whose terminal has no coordinate in this revision", () => {
    const f = regional([svc({ terminalCode: "T77" }), svc({ code: "RS-NO-TERMINAL", terminalCode: null })]);
    expect(regionalFound(f)).toEqual([["regional_terminal_without_coordinate", "warning", "regional service RS-NAGA-LEGAZPI-VAN"]]);
  });
});

describe("validationFactsSchema", () => {
  it("reads the jsonb the database builds (numeric distances as text included)", () => {
    const parsed = validationFactsSchema.parse({ ...facts(), routeStops: [{ variantRef: "v", seq: 1, distAlongM: "12.5" }] });
    expect(parsed.routeStops[0]!.distAlongM).toBe(12.5);
  });

  it("defaults the intercity facts to empty on a database before 0029", () => {
    const parsed = validationFactsSchema.parse(facts());
    expect(parsed.regionalServices).toEqual([]);
    expect(parsed.regionalDestinations).toEqual([]);
  });

  it("reads the intercity facts (counts as numbers, dates as text)", () => {
    const parsed = validationFactsSchema.parse({
      ...facts(),
      regionalServices: [svc({ asOf: "2026-10-01", reviewBy: null, terminalCode: null })],
      regionalDestinations: [{ code: "LEGAZPI", serviceCount: 1 }],
    });
    expect(parsed.regionalServices[0]).toMatchObject({ code: "RS-NAGA-LEGAZPI-VAN", reviewBy: null, departureCount: 0 });
    expect(parsed.regionalDestinations).toEqual([{ code: "LEGAZPI", serviceCount: 1 }]);
  });
});
