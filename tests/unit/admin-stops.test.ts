// Candidate review, stops and reconciliation (N5b, C3): the promotion rules the screens show (the
// database repeats them, 0024), the strict action bodies, the pin checks, and the four validation
// rules this data enables.
import { describe, expect, it } from "vitest";
import { validationFactsSchema } from "@/domain/admin/schemas";
import { pinMismatches } from "@/domain/admin/reconcile";
import { compareCodes, promotionOptions, reconcilePayloadSchema, stopActionSchema, statusRank, STOP_STATUSES } from "@/domain/admin/stops";
import { severityOf, STOP_MOVED_FLAG_M, validateRevision, type ValidationFacts } from "@/domain/admin/validation";

const A = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const B = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const V = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a03";

describe("promotionOptions", () => {
  it("moves forward one claim at a time: documentary needs legal designation, installed a sign, field verified an observation or curb", () => {
    const none = promotionOptions({ status: "candidate", evidence: [] });
    expect(none.map((o) => [o.status, o.allowed])).toEqual([["documentary", false], ["installed", false], ["field_verified", false]]);
    expect(none[0]!.reason).toBe("Needs evidence for legal designation.");
    expect(none[2]!.reason).toBe("Needs evidence for operating observed or curb position.");

    const legal = promotionOptions({ status: "candidate", evidence: [{ claim: "legal_designation" }] });
    expect(legal.filter((o) => o.allowed).map((o) => o.status)).toEqual(["documentary"]);

    const curb = promotionOptions({ status: "documentary", evidence: [{ claim: "curb_position" }] });
    expect(curb.map((o) => [o.status, o.allowed])).toEqual([["documentary", false], ["installed", false], ["field_verified", true]]);
    expect(curb[0]!.reason).toBe("Already documentary.");
  });

  it("never promotes a retired stop; temporary and relocated restart at the bottom", () => {
    expect(promotionOptions({ status: "retired", evidence: [{ claim: "legal_designation" }] }).every((o) => !o.allowed)).toBe(true);
    expect(statusRank("relocated")).toBe(0);
    expect(statusRank("retired")).toBeNull();
    expect(STOP_STATUSES).toHaveLength(8);
  });

  it("sorts codes in reading order", () => {
    expect(["A10", "A2", "A1", null].sort(compareCodes)).toEqual([null, "A1", "A2", "A10"]);
  });
});

describe("stopActionSchema", () => {
  const ok = (body: unknown) => stopActionSchema.safeParse(body).success;
  it("accepts each action with the expected version", () => {
    expect(ok({ action: "promote", expectedVersionId: V, status: "documentary" })).toBe(true);
    expect(ok({ action: "evidence", expectedVersionId: V, kind: "document", claim: "legal_designation", sourceCode: "S12", observedOn: "2026-10-20" })).toBe(true);
    expect(ok({ action: "retire", expectedVersionId: V, reason: "Not a stop: private driveway." })).toBe(true);
    expect(ok({ action: "relocate", expectedVersionId: V, lat: 13.6244, lng: 123.1862, reason: "Pin was on the wrong corner." })).toBe(true);
    expect(ok({ action: "edit", expectedVersionId: V, changes: { name: "Plaza Rizal", aliases: ["Plaza"], curbSide: "left_of_travel" } })).toBe(true);
  });

  it("refuses missing versions, unknown fields, published promotion, outside coordinates, short reasons and half curb points", () => {
    expect(ok({ action: "promote", status: "documentary" })).toBe(false);
    expect(ok({ action: "promote", expectedVersionId: V, status: "published" })).toBe(false);
    expect(ok({ action: "promote", expectedVersionId: V, status: "installed", force: true })).toBe(false);
    expect(ok({ action: "relocate", expectedVersionId: V, lat: 14.6, lng: 121.0, reason: "Manila" })).toBe(false);
    expect(ok({ action: "retire", expectedVersionId: V, reason: "x" })).toBe(false);
    expect(ok({ action: "edit", expectedVersionId: V, changes: { curbLat: 13.62 } })).toBe(false);
    expect(ok({ action: "edit", expectedVersionId: V, changes: {} })).toBe(false);
    expect(ok({ action: "edit", expectedVersionId: V, changes: { status: "published" } })).toBe(false);
    expect(ok({ action: "evidence", expectedVersionId: V, kind: "photo", claim: "fare" })).toBe(false);
    expect(ok({ action: "delete", expectedVersionId: V })).toBe(false);
  });
});

describe("reconcilePayloadSchema", () => {
  const side = (id: string) => ({ stopPointId: id, expectedVersionId: V });
  it("needs two different stops and, to link, which one is kept", () => {
    expect(reconcilePayloadSchema.safeParse({ a: side(A), b: side(B), decision: "keep_separate" }).success).toBe(true);
    expect(reconcilePayloadSchema.safeParse({ a: side(A), b: side(B), decision: "link", keepStopPointId: B }).success).toBe(true);
    expect(reconcilePayloadSchema.safeParse({ a: side(A), b: side(B), decision: "link" }).success).toBe(false);
    expect(reconcilePayloadSchema.safeParse({ a: side(A), b: side(B), decision: "link", keepStopPointId: V }).success).toBe(false);
    expect(reconcilePayloadSchema.safeParse({ a: side(A), b: side(A), decision: "keep_separate" }).success).toBe(false);
  });
});

describe("pinMismatches", () => {
  const row = (over: Partial<Parameters<typeof pinMismatches>[0][number]>) => ({
    stopPointId: A, name: "Plaza Rizal", status: "candidate", pinLayer: "Loop Service A", pinCode: "A1", pinLabel: "Plaza Rizal", distanceM: 0, ...over,
  });
  it("lists pins far from their stop or named unlike it; similar names and empty labels pass", () => {
    const out = pinMismatches([
      row({}),
      row({ distanceM: 42.5 }),
      row({ pinLabel: "Naga Cathedral" }),
      row({ pinLabel: "plaza  rizal (front)" }),
      row({ pinLabel: "" }),
    ]);
    expect(out.map((m) => [m.distanceM, m.far, m.nameDiffers])).toEqual([[42.5, true, false], [0, false, true]]);
  });
});

const S = { status: "candidate", curbSide: null, evidenceClaims: [] as string[], movedM: null, inSequence: false };
function facts(stops: Partial<ValidationFacts["stops"][number]>[], kind: "provisional" | "verified" = "provisional"): ValidationFacts {
  return {
    revision: { id: V, label: "draft-x", kind, status: "draft", isSynthetic: false },
    membershipHash: "a".repeat(64),
    dbCheck: { ok: true },
    members: [],
    stops: stops.map((s, i) => ({ ...S, stopPointId: A, layer: "Loop Service C", code: `C${i + 1}`, name: "Stop", lat: 13.62, lng: 123.18, ...s })),
    terminals: [],
    variants: [],
    routeStops: [],
    shapes: [],
  };
}
const found = (f: ValidationFacts) => validateRevision(f).issues.map((i) => [i.rule, i.severity]);

describe("validation rules enabled by stop review (N5b)", () => {
  it("promoted stop without evidence: warning on provisional, error on verified", () => {
    expect(found(facts([{ status: "documentary" }]))).toEqual([["promoted_without_evidence", "warning"]]);
    expect(found(facts([{ status: "installed" }], "verified"))).toEqual([["promoted_without_evidence", "error"]]);
    expect(found(facts([{ status: "installed", evidenceClaims: ["sign_installed"] }], "verified"))).toEqual([]);
    expect(found(facts([{ status: "candidate" }], "verified"))).toEqual([]);
  });

  it("curb side without curb evidence follows the revision kind; unknown is not a claim", () => {
    expect(found(facts([{ curbSide: "left_of_travel" }]))).toEqual([["curb_without_evidence", "warning"]]);
    expect(found(facts([{ curbSide: "unknown" }]))).toEqual([]);
    expect(found(facts([{ curbSide: "terminal_bay", evidenceClaims: ["curb_position"] }], "verified"))).toEqual([]);
  });

  it("a retired stop in a stop order is always an error", () => {
    expect(found(facts([{ status: "retired", inSequence: true }]))).toEqual([["retired_stop_in_sequence", "error"]]);
    expect(found(facts([{ status: "retired", inSequence: false }]))).toEqual([]);
  });

  it(`a stop moved more than ${STOP_MOVED_FLAG_M} m since the parent revision is a warning`, () => {
    expect(found(facts([{ movedM: STOP_MOVED_FLAG_M + 0.1 }]))).toEqual([["stop_moved_far", "warning"]]);
    expect(found(facts([{ movedM: STOP_MOVED_FLAG_M }], "verified"))).toEqual([]);
    expect(severityOf("stop_moved_far", "verified")).toBe("warning");
  });

  it("facts from a database still on 0023 parse with neutral stop fields", () => {
    const parsed = validationFactsSchema.parse({
      ...facts([]),
      stops: [{ stopPointId: A, layer: "L", code: "A1", name: "n", lat: 13.62, lng: 123.18 }],
    });
    expect(parsed.stops[0]).toMatchObject(S);
    expect(validationFactsSchema.parse({ ...facts([{ movedM: "61.5" as unknown as number }]) }).stops[0]!.movedM).toBe(61.5);
  });
});
