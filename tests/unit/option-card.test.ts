// The pure view helpers behind the trip option cards (Increment E Task 10).
import { describe, expect, it } from "vitest";
import type { TricycleLegDto } from "@/domain/api/plan";
import { serviceWindowNote } from "@/domain/eta/service-window";
import { FLAGGED_PATH_NOTE } from "@/domain/planner/notes";
import {
  cardRouteNotes,
  jeepneyReasonText,
  optionsCountText,
  previewIndex,
  recommendedIndex,
  serviceWindowCardLine,
  streetCardView,
} from "@/domain/trip/option-card";
import { optionNotesView } from "@/domain/trip/option-notes";
import { oneRide, streetOnly, walkOnly } from "./guidance-fixtures";

const tricycleLeg = (o = streetOnly("tricycle")) => o.legs[0] as TricycleLegDto;

describe("recommendedIndex", () => {
  it("is the first Recommended option, so exactly one card is primary", () => {
    const a = { ...walkOnly(), labels: [] as never[] };
    const b = { ...streetOnly("tricycle"), labels: ["Recommended" as const] };
    const c = { ...oneRide(), labels: ["Recommended" as const] };
    expect(recommendedIndex([a, b, c])).toBe(1);
  });
  it("is -1 when none is labelled (never guesses)", () => {
    expect(recommendedIndex([{ ...streetOnly("tricycle"), labels: [] }])).toBe(-1);
  });
});

describe("previewIndex and optionsCountText (review I1: nothing Recommended)", () => {
  it("previews the Recommended option; with none, the first non-walk option; with only walks, none", () => {
    const walk = { ...walkOnly(), labels: [] as never[] };
    const tri = { ...streetOnly("tricycle"), labels: [] as never[] };
    expect(previewIndex([walk, { ...tri, labels: ["Recommended" as const] }])).toBe(1);
    expect(previewIndex([walk, tri])).toBe(1);
    expect(previewIndex([walk])).toBe(-1);
  });
  it("counts the options", () => {
    expect(optionsCountText(1)).toBe("1 option");
    expect(optionsCountText(3)).toBe("3 options");
  });
});

describe("jeepneyReasonText", () => {
  it("has one line per reason, none for null, none promising a route", () => {
    expect(jeepneyReasonText(null)).toBeNull();
    expect(jeepneyReasonText("no_path_near_origin")).toBe("No jeepney route passes near your start");
    expect(jeepneyReasonText("no_path_near_destination")).toBe("No jeepney route passes near your destination");
    expect(jeepneyReasonText("walk_shorter")).toBe("Walking is shorter than any jeepney ride");
    expect(jeepneyReasonText("no_route")).toBe("No jeepney route connects these places");
  });
});

describe("streetCardView", () => {
  it("a routed tricycle: distance along streets, minimum fare, no minutes, the restriction line", () => {
    const o = streetOnly("tricycle");
    const leg = { ...tricycleLeg(o), notes: ["Avoids the restricted roads we could locate (Ordinance 2006-005/015; allowed 9 pm–5 am)", ...tricycleLeg(o).notes] } as TricycleLegDto;
    const v = streetCardView(leg);
    expect(v.distanceText).toBe("≈ 1.5 km along streets");
    expect(v.state).toBe("route");
    expect(v.fareText).toBe("Minimum fare ₱15");
    expect(v.timeText).toBe("Time not estimated");
    expect(v.restrictionNote).toBe("Avoids the restricted roads we could locate (Ordinance 2006-005/015; allowed 9 pm–5 am)");
    expect(JSON.stringify(v)).not.toMatch(/\bmin\b|minutes/);
  });
  it("a straight-line tricycle is 'Route not confirmed', approximate, and claims no avoidance", () => {
    const v = streetCardView({ ...tricycleLeg(), basis: "straight_line", path: null, distanceMeters: 900 } as TricycleLegDto);
    expect(v.state).toBe("not_confirmed");
    expect(v.headline).toBe("Route not confirmed");
    expect(v.distanceText).toBe("≈ 900 m straight line · approximate, not a route");
    expect(v.restrictionNote).toBeNull();
  });
  it("an unavailable street route has no distance and no 'offline' wording", () => {
    const v = streetCardView({ ...tricycleLeg(), basis: "unavailable", path: null, distanceMeters: null } as TricycleLegDto);
    expect(v.state).toBe("unavailable");
    expect(v.headline).toBe("Street route not available");
    expect(v.distanceText).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/offline/i);
  });
  it("a padyak: ₱10 per passenger and the area note", () => {
    const leg = { ...streetOnly("padyak").legs[0]!, notes: ["Area per city ordinance · approximate boundary · service not confirmed today", "Padyak time not estimated"] };
    const v = streetCardView(leg as never);
    expect(v.fareText).toBe("₱10 per passenger");
    expect(v.areaNote).toBe("Area per city ordinance · approximate boundary · service not confirmed today");
    expect(v.timeText).toBe("Time not estimated");
  });
});

describe("serviceWindowCardLine", () => {
  const at = (hhmm: string) => serviceWindowNote(new Date(`2026-10-17T${hhmm}:00+08:00`))!;
  it("is short, soft and says unconfirmed", () => {
    expect(serviceWindowCardLine(at("22:00"))).toBe("Outside the usual hours (about 5 am–9 pm) · unconfirmed");
    expect(serviceWindowCardLine(at("04:00"))).toBe("Outside the usual hours (about 5 am–9 pm) · unconfirmed");
    expect(serviceWindowCardLine(at("20:30"))).toBe("Last trips may already have left (unconfirmed).");
  });
});

describe("cardRouteNotes", () => {
  it("is the first note of each ride, never the long flagged-path caveat, owner reports labelled", () => {
    const base = oneRide();
    const ride = base.legs.find((l) => l.kind === "ride")!;
    const option = { ...base, legs: base.legs.map((l) => (l === ride ? { ...l, notes: [FLAGGED_PATH_NOTE, "A local reports drivers may turn into side streets on request. Ask the driver."] } : l)) };
    const view = optionNotesView(option, [{ routeCode: "R01", notes: [{ text: "A local reports drivers may turn into side streets on request. Ask the driver.", evidence: "owner_report_unverified", sourceCodes: ["U02"], near: null }] }], new Date("2026-10-17T04:00:00Z"));
    const notes = cardRouteNotes(view);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ unverified: true, evidenceLabel: "Local report · unverified" });
  });
});
