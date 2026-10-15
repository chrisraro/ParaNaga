// Vehicle classes per route (C1–C8, D3 and the user decisions of 2026-10-16): the route label,
// the option chip, the line colour key and the per-class evidence text. Pure.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classLabel,
  colourKey,
  cooperativeLabel,
  fleetChip,
  fleetLabel,
  fleetSummary,
  monthYear,
  operatingStatusLabel,
  VEHICLE_CLASSES,
  type FleetRecord,
} from "@/domain/modes/fleet";

const rec = (over: Partial<FleetRecord>): FleetRecord => ({
  code: "FL-X",
  vehicleClass: "traditional_puj",
  evidenceLevels: ["legal_plan"],
  status: "planned",
  firstReportedOn: null,
  lastReportedOn: null,
  unitsNote: null,
  aircon: null,
  airconSourceCodes: [],
  cooperatives: [],
  sourceCodes: ["N30"],
  ...over,
});

// The published records (data/source/research/naga-modes-seed-2026-10-16.json, user decisions).
const TRAD_OPERATING = rec({
  code: "FL-R1-TRAD", evidenceLevels: ["legal_plan", "owner_confirmation"], status: "operating",
  lastReportedOn: "2026-10-16", sourceCodes: ["N30", "U01"],
});
const R4_MOD = rec({
  code: "FL-R4-MOD", vehicleClass: "modern_puj", evidenceLevels: ["official_report", "news_report", "owner_confirmation"],
  status: "operating", firstReportedOn: "2023-04-17", lastReportedOn: "2026-10-16", aircon: true,
  airconSourceCodes: ["N14", "U01"], sourceCodes: ["N14", "N38", "N39", "N41", "U01"],
});
const R7_MOD = rec({ ...R4_MOD, code: "FL-R7-MOD", firstReportedOn: "2024-01-16", airconSourceCodes: ["U01"] });
const TRICYCLE = rec({
  code: "FL-TRI-VISTODA", vehicleClass: "tricycle", firstReportedOn: "2025-09-09", lastReportedOn: "2025-09-09",
  unitsNote: "33 special trimobile units authorized", sourceCodes: ["N06"],
});

describe("fleetLabel", () => {
  it("R4 and R7: traditional and modern jeepneys, operating now (no 2024 caveat)", () => {
    expect(fleetLabel([TRAD_OPERATING, R4_MOD])).toBe("Traditional and modern jeepneys");
    expect(fleetLabel([R7_MOD, TRAD_OPERATING])).toBe("Traditional and modern jeepneys");
  });

  it("every other LPTRP route: traditional jeepneys (owner-confirmed service)", () => {
    expect(fleetLabel([TRAD_OPERATING])).toBe("Traditional jeepneys");
  });

  it("modern units only reported (not operating): month and year of the last report", () => {
    const reported = rec({ ...R4_MOD, evidenceLevels: ["official_report", "news_report"], status: "reported", lastReportedOn: "2024-05-20" });
    expect(fleetLabel([TRAD_OPERATING, reported])).toBe("Traditional and modern jeepneys · modern units last reported May 2024");
    const june = rec({ ...reported, lastReportedOn: "2024-06-24" });
    expect(fleetLabel([TRAD_OPERATING, june])).toBe("Traditional and modern jeepneys · modern units last reported June 2024");
  });

  it("modern units reported, not confirmed: text only", () => {
    const claim = rec({ vehicleClass: "modern_puj", evidenceLevels: ["secondary_claim", "user_report"], status: "reported_not_confirmed" });
    expect(fleetLabel([TRAD_OPERATING, claim])).toBe("Traditional jeepneys · modern units reported, not confirmed");
  });

  it("a route-plan record only: the planned class, vehicles not confirmed", () => {
    expect(fleetLabel([rec({})])).toBe("Traditional jeepneys (2025 route plan) · vehicles on the street not confirmed");
  });

  it("tricycle feeders: authorized, operation not verified", () => {
    expect(fleetLabel([TRICYCLE])).toBe("Tricycle (special trimobile) · authorized 2025 · operation not verified");
  });

  it("no record: vehicle type not confirmed", () => {
    expect(fleetLabel([])).toBe("Vehicle type not confirmed");
  });

  it("a modern unit that is only reported is never 'operating'", () => {
    const reported = rec({ vehicleClass: "modern_puj", evidenceLevels: ["news_report"], status: "reported", lastReportedOn: "2024-05-01" });
    expect(fleetLabel([reported])).toBe("Modern jeepneys · last reported May 2024");
  });
});

describe("fleetChip (C7)", () => {
  it("mixed, traditional, reported and unconfirmed chips", () => {
    expect(fleetChip([TRAD_OPERATING, R4_MOD], "jeepney")).toBe("Jeepney · traditional + modern");
    expect(fleetChip([TRAD_OPERATING], "jeepney")).toBe("Jeepney · traditional");
    const claim = rec({ vehicleClass: "modern_puj", evidenceLevels: ["user_report"], status: "reported_not_confirmed" });
    expect(fleetChip([TRAD_OPERATING, claim], "jeepney")).toBe("Jeepney · modern units reported");
    expect(fleetChip([], "jeepney")).toBe("Jeepney · type not confirmed");
    expect(fleetChip([TRICYCLE], "tricycle")).toBe("Tricycle · special trimobile");
    expect(fleetChip([], "tricycle")).toBe("Tricycle · type not confirmed");
  });
});

describe("colourKey (D3)", () => {
  it("R4/R7 two-tone, traditional, tricycle, unconfirmed", () => {
    expect(colourKey([TRAD_OPERATING, R4_MOD])).toBe("mixed_trad_modern");
    expect(colourKey([TRAD_OPERATING])).toBe("traditional_puj");
    expect(colourKey([rec({})])).toBe("traditional_puj"); // an LPTRP record gives the traditional colour
    expect(colourKey([TRICYCLE])).toBe("tricycle");
    expect(colourKey([])).toBe("unconfirmed");
  });

  it("reported-not-confirmed classes never change the colour", () => {
    const claim = rec({ vehicleClass: "modern_puj", evidenceLevels: ["secondary_claim"], status: "reported_not_confirmed" });
    expect(colourKey([TRAD_OPERATING, claim])).toBe("traditional_puj");
    expect(colourKey([claim])).toBe("unconfirmed");
  });

  it("a 'reported' class counts only with an official or news report", () => {
    const registry = rec({ vehicleClass: "modern_puj", evidenceLevels: ["registry"], status: "reported" });
    expect(colourKey([TRAD_OPERATING, registry])).toBe("traditional_puj");
    const news = rec({ vehicleClass: "modern_puj", evidenceLevels: ["news_report"], status: "reported" });
    expect(colourKey([TRAD_OPERATING, news])).toBe("mixed_trad_modern");
  });

  it("never returns an e-jeepney key, whatever the records (property)", () => {
    const record = fc.record({
      vehicleClass: fc.constantFrom(...VEHICLE_CLASSES),
      status: fc.constantFrom("planned", "reported", "reported_not_confirmed", "operating" as const),
      evidenceLevels: fc.subarray(["legal_plan", "official_report", "news_report", "registry", "secondary_claim", "user_report",
        "owner_confirmation"] as const, { minLength: 1 }),
    });
    fc.assert(fc.property(fc.array(record, { maxLength: 5 }), (list) => {
      const records = list.map((r) => rec(r as Partial<FleetRecord>));
      expect(colourKey(records)).not.toMatch(/e_jeep/);
      expect(fleetLabel(records)).not.toMatch(/e-jeep/i);
      expect(fleetChip(records, "jeepney")).not.toMatch(/e-jeep/i);
    }));
  });
});

describe("classLabel and dates", () => {
  it("evidence text per class, with the aircon source", () => {
    expect(classLabel(TRAD_OPERATING)).toBe("Traditional jeepney · operating (owner-confirmed October 2026)");
    expect(classLabel(R4_MOD)).toBe("Modern jeepney · air-conditioned · operating (owner-confirmed October 2026)");
    expect(classLabel(rec({}))).toBe("Traditional jeepney · 2025 route plan · not confirmed on the street");
    expect(classLabel(TRICYCLE)).toBe("Tricycle (special trimobile) · authorized 2025 · operation not verified");
    expect(classLabel(rec({ vehicleClass: "modern_puj", evidenceLevels: ["news_report"], status: "reported", lastReportedOn: "2024-05-01" })))
      .toBe("Modern jeepney · last reported May 2024");
    expect(classLabel(rec({ vehicleClass: "modern_puj", evidenceLevels: ["user_report"], status: "reported_not_confirmed" })))
      .toBe("Modern jeepney · reported, not confirmed");
  });

  it("monthYear is month + year of an ISO date (no time zone shift)", () => {
    expect(monthYear("2024-05-01")).toBe("May 2024");
    expect(monthYear("2024-06-30")).toBe("June 2024");
    expect(monthYear("2023-07")).toBe("July 2023");
    expect(monthYear(null)).toBeNull();
  });

  it("fleetSummary bundles label, chip, colour key and the classes with their labels", () => {
    const s = fleetSummary([R4_MOD, TRAD_OPERATING], "jeepney");
    expect(s.label).toBe("Traditional and modern jeepneys");
    expect(s.chip).toBe("Jeepney · traditional + modern");
    expect(s.colourKey).toBe("mixed_trad_modern");
    // Stable order: traditional first.
    expect(s.classes.map((c) => c.vehicleClass)).toEqual(["traditional_puj", "modern_puj"]);
    expect(s.classes[1]).toMatchObject({ aircon: true, airconSourceCodes: ["N14", "U01"], label: classLabel(R4_MOD) });
  });
});

describe("operating status and cooperatives", () => {
  it("operating status names the owner confirmation, never verified stops or paths", () => {
    expect(operatingStatusLabel("2026-10-16")).toBe("Operating (owner-confirmed 2026-10-16)");
  });

  it("cooperative basis text (C8)", () => {
    expect(cooperativeLabel("name_matches_corridor", "2023-07")).toBe(
      "Registered cooperative whose name matches this corridor (OTC masterlist, July 2023) · route not confirmed");
    expect(cooperativeLabel("corridor_reported", "2024-01-16")).toBe("Reported on this corridor (January 2024)");
    expect(cooperativeLabel("corridor_reported", null)).toBe("Reported on this corridor");
  });
});
