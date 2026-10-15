import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectConflicts } from "@/domain/import/conflicts";
import { buildSnapshot, withIdentities } from "@/domain/import/mapped-stops";
import {
  crossCheckDesignatedCsv,
  crossCheckSeedMappedStops,
  normalizeSeed,
  pesosToCentavos,
  surveyTemplateNote,
  type NormalizedSeed,
} from "@/domain/import/seed";
import { parseSurveyTemplate } from "@/domain/import/survey-template";

const read = (f: string) => readFileSync(`Data_Sets/${f}`, "utf8");
const seedJson: unknown = JSON.parse(read("naga_transport_seed.json"));
const seed: NormalizedSeed = normalizeSeed(seedJson);

describe("normalizeSeed counts", () => {
  it("maps every collection", () => {
    expect(seed.sources).toHaveLength(42);
    expect(seed.routes).toHaveLength(11);
    expect(seed.trialChanges).toHaveLength(2);
    expect(seed.fareRules).toHaveLength(4);
    expect(seed.terminals).toHaveLength(6);
    expect(seed.externalDestinationCategories).toHaveLength(5);
    expect(seed.feederCandidates).toHaveLength(5);
    expect(seed.providers).toHaveLength(3);
    expect(seed.barangays).toHaveLength(27);
    expect(seed.designatedCandidates).toHaveLength(32);
    expect(seed.railStatus.map((r) => r.key).sort()).toEqual(
      ["current_fares", "current_timetable", "naga_legazpi", "naga_lupi_viejo"],
    );
    expect(seed.datasetNotes.map((n) => n.key).sort()).toEqual([
      "coverage_claim",
      "dataset_version",
      "designated_stop_program",
      "geography",
      "navigation_ready",
      "public_stop_map",
      "researched_on",
      "stop_inventory_gaps",
      "timezone",
    ]);
  });

  it("has no integrity issues", () => {
    expect(seed.integrityIssues).toEqual([]);
  });
});

describe("sources", () => {
  it("keeps codes, evidence type and verbatim dates; unknown dates stay null", () => {
    const s01 = seed.sources.find((s) => s.code === "S01")!;
    expect(s01).toMatchObject({ evidenceType: "official", checkedOn: "2026-10-15" });
    expect(s01.title).toBe("Naga approved LPTRP, Ordinance 2025-070");
    const s09 = seed.sources.find((s) => s.code === "S09")!;
    expect(s09.publishedOrEnacted).toBeNull();
    expect(new Set(seed.sources.map((s) => s.code)).size).toBe(42);
    expect(seed.sources.every((s) => /^S[0-9]{2,3}$/.test(s.code))).toBe(true);
  });
});

describe("routes", () => {
  it("keeps R1…R8-D with legal street lists verbatim", () => {
    expect(seed.routes.map((r) => r.publicCode)).toEqual([
      "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D",
    ]);
    const r1 = seed.routes[0]!;
    expect(r1).toMatchObject({
      name: "Centro–San Isidro via Cararayan",
      modeCode: "PUJ_Class_2_plan",
      legalStatus: "approved_plan",
      operatingStatus: "unverified",
      allocatedUnits: 20,
      allocationIsActiveFleetCount: false,
      officialGroupNumber: 1,
    });
    expect(r1.legalStreets.inbound).toEqual([
      "Cararayan–San Isidro Rd", "Balatas Rd", "Magsaysay Ave", "Peñafrancia Ave", "Diaz St", "Elias Angeles St", "Caceres St",
    ]);
    expect(r1.legalStreets.circuit).toBeNull();
    const r8d = seed.routes.at(-1)!;
    expect(r8d.legalStreets.circuit?.[0]).toBe("Gen. Luna St");
    expect(r8d.allocatedUnits).toBeNull();
    expect(r8d.direction).toBe("counterclockwise");
  });

  it("preserves non-standard route fields instead of dropping them", () => {
    const r3 = seed.routes.find((r) => r.publicCode === "R3")!;
    expect(r3.extra).toHaveProperty("normalization_note");
    expect(r3.extra).toHaveProperty("additional_source_structure");
    expect(seed.routes.find((r) => r.publicCode === "R8-A")!.extra).toMatchObject({ group_allocated_units: 71, pending_change_source: "S03" });
  });

  it("never invents geometry, stops, hours, operator or fare link", () => {
    for (const r of seed.routes) {
      expect(r.geometry).toBeNull();
      expect(r.serviceHours).toBeNull();
      expect(r.operator).toBeNull();
      expect(r.fareRuleCode).toBeNull();
    }
  });

  it("reads the two trial changes", () => {
    expect(seed.trialChanges.map((t) => t.routeCode)).toEqual(["R8-A", "R8-B"]);
    expect(seed.trialChanges[0]).toMatchObject({ sourceCode: "S03", adopted: "2025-11-11", durationDays: 30, permanentStatus: "unconfirmed" });
    expect(seed.trialChanges[0]!.simplifiedCircuit.length).toBeGreaterThan(5);
  });
});

describe("fares in centavos", () => {
  const rule = (code: string) => seed.fareRules.find((f) => f.code === code)!;

  it("F01 traditional jeepney: 1400 base, +200/km after 4 km", () => {
    expect(rule("F01")).toMatchObject({
      modeCode: "traditional_jeepney", baseCentavos: 1400, baseKm: 4, incrementCentavosPerKm: 200,
      effectiveFrom: "2026-09-28", publishExact: false,
    });
  });
  it("F02 modern jeepney: 1700 base, +240/km", () => {
    expect(rule("F02")).toMatchObject({ baseCentavos: 1700, baseKm: 4, incrementCentavosPerKm: 240 });
  });
  it("F03 trimobile: 1500 base, 20 % discount; the seed's calculated 1200 is NOT stored as a rule value", () => {
    const f03 = rule("F03");
    expect(f03).toMatchObject({ baseCentavos: 1500, discountPercent: 20, discountedBaseCentavos: null, baseKm: null, incrementCentavosPerKm: null, effectiveFrom: null, enactedOn: "2024-01-16" });
    expect(f03.discountGroups).toEqual(["senior", "student", "PWD", "solo_parent_with_valid_ID"]);
  });
  it("F04 padyak: 1000 base, 800 discounted", () => {
    expect(rule("F04")).toMatchObject({ baseCentavos: 1000, discountedBaseCentavos: 800, incrementCentavosPerKm: null, effectiveFrom: "2022-10-01" });
  });
  it("no fare rule is publishable as exact and every amount is an integer", () => {
    for (const f of seed.fareRules) {
      expect(f.publishExact).toBe(false);
      for (const v of [f.baseCentavos, f.incrementCentavosPerKm, f.discountedBaseCentavos]) {
        if (v !== null) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
  it("F05 becomes a student observation of 1300 plus a conflict against F03, not a rule", () => {
    expect(seed.fareRules.some((f) => f.code === "F05")).toBe(false);
    expect(seed.fareObservations).toHaveLength(1);
    expect(seed.fareObservations[0]).toMatchObject({
      code: "F05", ruleCode: null, category: "student", amountCentavos: 1300, kind: "reported_practice", observedAt: "2026-06-22",
    });
    expect(seed.fareObservations[0]!.details).toMatchObject({ reportedBaseCentavos: 1500, calculatedDiscountedBaseCentavos: 1200 });
    expect(seed.fareObservations[0]!.details).toMatchObject({ calculatedDiscountedBaseCentavos: 1200 });
    expect(seed.fareConflicts).toEqual([
      expect.objectContaining({ ruleCode: "F03", observationCode: "F05", observationCategory: "student", status: "open" }),
    ]);
  });
});

describe("other collections", () => {
  it("terminals T01–T06 have no coordinates", () => {
    expect(seed.terminals.map((t) => t.code)).toEqual(["T01", "T02", "T03", "T04", "T05", "T06"]);
    expect(seed.terminals.every((t) => t.lat === null && t.lng === null)).toBe(true);
    expect(seed.terminals[0]).toMatchObject({ name: "Bicol Central Station", modes: ["bus"] });
  });

  it("external destination categories keep destinations and unknown fares as null", () => {
    expect(seed.externalDestinationCategories).toHaveLength(5);
    const north = seed.externalDestinationCategories.find((c) => c.category === "northbound")!;
    expect(north.destinations).toContain("Canaman");
    expect(north.candidateTerminalCode).toBe("T04");
    expect(north.details).toMatchObject({ farePhp: null, serviceHours: null, geometry: null });
  });

  it("feeders SF01–SF05 and ride-hailing presence have null fares and quotes", () => {
    expect(seed.feederCandidates.map((f) => f.code)).toEqual(["SF01", "SF02", "SF03", "SF04", "SF05"]);
    expect(seed.feederCandidates.every((f) => f.fareCentavos === null && f.operatingStatus === "unverified")).toBe(true);
    expect(seed.providers.map((p) => p.name)).toEqual(["Grab", "JoyRide", "Maxim"]);
    expect(seed.providers.every((p) => p.quoteCentavos === null && p.products === null)).toBe(true);
  });

  it("27 barangays are not_surveyed with zero verified boarding points recorded", () => {
    expect(seed.barangays.every((b) => b.surveyStatus === "not_surveyed")).toBe(true);
    expect(seed.barangays.every((b) => b.exactBoardingPointsVerified === 0)).toBe(true);
    expect(seed.barangays.map((b) => b.name)).toContain("Concepcion Pequeña");
  });

  it("rail status values stay as reported; fares and timetable are unknown", () => {
    const rail = Object.fromEntries(seed.railStatus.map((r) => [r.key, r.value]));
    expect(rail).toEqual({
      naga_lupi_viejo: "community_reports_operational;verify_PNR",
      naga_legazpi: "community_reports_suspended;verify_PNR",
      current_fares: null,
      current_timetable: null,
    });
    expect(seed.railStatus[0]!.sourceCodes).toEqual(["S19", "S20", "S21"]);
  });

  it("dataset notes carry verbatim JSON values", () => {
    const note = (k: string) => seed.datasetNotes.find((n) => n.key === k)!.value;
    expect(note("dataset_version")).toBe("0.3-research-public-map-pins");
    expect(note("coverage_claim")).toBe("Broad web inventory; not exhaustive verified operational data");
    expect(note("public_stop_map")).toMatchObject({ public_owner_display_name: "Tan Gumba", owner_identity_or_official_role_verified: false, record_count: 128 });
    expect(note("designated_stop_program")).toMatchObject({ trial_routes: ["R8-A", "R8-B", "R8-C", "R8-D"] });
    expect(note("stop_inventory_gaps")).toHaveLength(9);
  });

  it("rejects malformed input", () => {
    expect(() => normalizeSeed(null)).toThrow();
    expect(() => normalizeSeed({ ...(seedJson as object), sources: "nope" })).toThrow(/sources/);
  });
});

describe("designated stop candidates", () => {
  it("are 32 label-only records with no coordinates and no navigation", () => {
    expect(seed.designatedCandidates).toHaveLength(32);
    expect(seed.designatedCandidates[0]).toMatchObject({
      code: "DSC-A-01",
      labelRaw: "Penafrancia - Magsaysay",
      labelType: "junction",
      routeCode: "R8-A",
      direction: "clockwise",
      sourceIds: ["S33", "S34"],
    });
    expect(seed.designatedCandidates.every((c) => c.properties.latitude === null && c.properties.longitude === null)).toBe(true);
    expect(seed.designatedCandidates.every((c) => c.properties.navigation_ready === false)).toBe(true);
    // two waiting-area records have no label_type, direction or context in the seed
    expect(seed.designatedCandidates.filter((c) => c.labelType === null)).toHaveLength(2);
  });

  it("agree with designated_stop_candidates.csv", () => {
    expect(crossCheckDesignatedCsv(seed.designatedCandidates, read("designated_stop_candidates.csv"))).toEqual([]);
  });

  it("report a disagreement", () => {
    const csv = read("designated_stop_candidates.csv").replace("UMA Residences", "Changed");
    expect(crossCheckDesignatedCsv(seed.designatedCandidates, csv).join("\n")).toMatch(/DSC-A-02/);
    const fewer = read("designated_stop_candidates.csv").trimEnd().split(/\r?\n/).slice(0, -1).join("\n");
    expect(crossCheckDesignatedCsv(seed.designatedCandidates, fewer).join("\n")).toMatch(/count/i);
  });
});

function withFare(patch: Record<string, unknown>) {
  const base = JSON.parse(JSON.stringify(seedJson)) as { fare_rules: Record<string, unknown>[] };
  const f05 = base.fare_rules.find((f) => f.id === "F05")!;
  Object.assign(f05, patch);
  return base;
}

describe("trust boundary (Zod)", () => {
  it("rejects a null, string or negative reported_student_php instead of coercing it to a fare", () => {
    expect(() => normalizeSeed(withFare({ reported_student_php: null }))).toThrow(/reported_student_php/);
    expect(() => normalizeSeed(withFare({ reported_student_php: "13" }))).toThrow(/reported_student_php/);
    expect(() => normalizeSeed(withFare({ reported_student_php: -13 }))).toThrow(/reported_student_php/);
  });

  it("rejects a non-numeric base fare", () => {
    const bad = JSON.parse(JSON.stringify(seedJson)) as { fare_rules: Record<string, unknown>[] };
    bad.fare_rules[0]!.base_php = "14";
    expect(() => normalizeSeed(bad)).toThrow(/base_php/);
  });

  it("pesosToCentavos rejects non-finite, negative, non-number and fractional-centavo input", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -1, null, "13", 0.005]) {
      expect(() => pesosToCentavos(v as number)).toThrow();
    }
    expect(pesosToCentavos(2.4)).toBe(240);
    expect(pesosToCentavos(0)).toBe(0);
  });

  it("reports (not defaults) a missing operating_status or allocation flag", () => {
    const bad = JSON.parse(JSON.stringify(seedJson)) as { routes: Record<string, unknown>[] };
    delete bad.routes[0]!.operating_status;
    delete bad.routes[1]!.allocation_is_active_fleet_count;
    const out = normalizeSeed(bad);
    expect(out.routes[0]!.operatingStatus).toBeNull();
    expect(out.routes[1]!.allocationIsActiveFleetCount).toBeNull();
    expect(out.integrityIssues.join("\n")).toMatch(/R1: operating_status is missing/);
    expect(out.integrityIssues.join("\n")).toMatch(/R2: allocation_is_active_fleet_count is missing/);
  });

  it("reports an unknown top-level key", () => {
    const out = normalizeSeed({ ...(seedJson as object), surprise: 1 });
    expect(out.integrityIssues).toEqual(['Unknown top-level seed key "surprise" is not mapped']);
  });
});

describe("seed mapped_stop_records and survey note", () => {
  const read2 = (f: string) => readFileSync(`Data_Sets/${f}`, "utf8");
  const snap = buildSnapshot(read2("naga_mapped_stops_source.kml"), read2("naga_mapped_stops.geojson"), read2("naga_mapped_stops.csv"));
  const identified = withIdentities(snap.records, snap.metadata.mapId);
  const conflicts = detectConflicts(identified);

  it("agrees with the snapshot and with detectConflicts on the code-prefix mismatches", () => {
    expect(seed.mappedStopRecords).toHaveLength(128);
    expect(seed.mappedStopRecords.filter((m) => m.codePrefixMatchesLayer === false)).toHaveLength(53);
    expect(crossCheckSeedMappedStops(seed.mappedStopRecords, identified, conflicts)).toEqual([]);
  });

  it("reports a disagreement", () => {
    const changed = seed.mappedStopRecords.map((m, i) => (i === 0 ? { ...m, codePrefixMatchesLayer: false } : m));
    expect(crossCheckSeedMappedStops(changed, identified, conflicts).join("\n")).toMatch(/MYM-A-001/);
    expect(crossCheckSeedMappedStops(seed.mappedStopRecords.slice(1), identified, conflicts).join("\n")).toMatch(/count/);
  });

  it("surveyTemplateNote builds a dataset_note row with the 45 columns", () => {
    const cols = parseSurveyTemplate(read2("field_survey_template.csv"));
    const note = surveyTemplateNote(cols);
    expect(note.key).toBe("survey_template_columns");
    expect(note.value).toEqual({ columns: cols, count: 45 });
  });
});
