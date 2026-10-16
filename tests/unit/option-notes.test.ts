// The plan option's notes as data (Task 9 → Task 10): route notes with their evidence, owner reports
// never as fact, and the jeepney service-window soft hint.
import { describe, expect, it } from "vitest";
import type { RouteNote } from "@/domain/api/schemas";
import { FLAGGED_PATH_NOTE } from "@/domain/planner/notes";
import { EVIDENCE_LABEL, optionNotesView } from "@/domain/trip/option-notes";
import { manila } from "./eta-fixtures";
import { oneRide, streetOnly } from "./guidance-fixtures";

const RN01: RouteNote = {
  text: "City Hall, BFP and BIR are on J. Miranda Ave. This loop's listed streets skip it (Ord 2025-070); ask the driver.",
  evidence: "community", sourceCodes: ["RL01", "RL03", "RL12", "RL14"], near: { lat: 13.6256, lng: 123.199, radiusM: 450 },
};
const RN03: RouteNote = {
  text: "A local reports drivers may turn into side streets on request (e.g. Magsaysay Ave). Ask the driver.",
  evidence: "owner_report_unverified", sourceCodes: ["U02"], near: null,
};
const ROUTES = [{ routeCode: "R01", notes: [RN01, RN03] }];

const withNotes = (notes: string[]) => {
  const o = oneRide();
  return { ...o, legs: o.legs.map((l) => (l.kind === "ride" ? { ...l, notes } : l)) };
};

describe("optionNotesView", () => {
  it("each ride note carries its evidence; owner reports are flagged unverified", () => {
    const v = optionNotesView(withNotes([RN01.text, RN03.text]), ROUTES, manila("09:00"));
    expect(v.serviceWindow).toBeNull();
    expect(v.rides).toEqual([
      {
        legIndex: 1,
        routeCode: "R01",
        notes: [
          { text: RN01.text, evidence: "community", evidenceLabel: EVIDENCE_LABEL.community, sourceCodes: RN01.sourceCodes, unverified: false },
          { text: RN03.text, evidence: "owner_report_unverified", evidenceLabel: "Local report · unverified", sourceCodes: ["U02"], unverified: true },
        ],
      },
    ]);
  });

  it("a note not in the snapshot (the flagged-path note, or no snapshot) keeps its text with no evidence claimed", () => {
    const v = optionNotesView(withNotes([FLAGGED_PATH_NOTE, RN03.text]), null, manila("09:00"));
    expect(v.rides[0]!.notes).toEqual([
      { text: FLAGGED_PATH_NOTE, evidence: null, evidenceLabel: null, sourceCodes: [], unverified: false },
      { text: RN03.text, evidence: null, evidenceLabel: null, sourceCodes: [], unverified: true },
    ]);
  });

  it("evidence labels never present a report as an official route", () => {
    for (const label of Object.values(EVIDENCE_LABEL)) expect(label).not.toMatch(/official route|verified route|confirmed/i);
    expect(EVIDENCE_LABEL.owner_report_unverified).toMatch(/unverified/);
  });

  it("the service-window hint shows on a jeepney option outside the usual hours, never on a street option", () => {
    expect(optionNotesView(oneRide(), [], manila("22:00")).serviceWindow?.hint).toBe("Usually runs about 5:00-21:00 · unconfirmed");
    expect(optionNotesView(streetOnly("tricycle"), [], manila("22:00"))).toEqual({ serviceWindow: null, rides: [] });
  });
});
