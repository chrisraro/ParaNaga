import { describe, expect, it } from "vitest";
import { fleetSummary, type FleetRecord } from "@/domain/modes/fleet";
import {
  directionText,
  distanceBasisText,
  rideFleetText,
  fareChipText,
  formatDistance,
  legFareText,
  noCoverageCopy,
  ringDirection,
  routeChipLabel,
  isNegligibleWalk,
  stopDisplayName,
  stopLabel,
  transfersText,
} from "@/domain/trip/present";

const square = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
  { lat: 1, lng: 0 },
];

describe("ringDirection (signed area of the stop ring)", () => {
  it("east → north → west is counterclockwise (north up)", () => {
    expect(ringDirection(square)).toBe("counterclockwise");
  });
  it("the reversed ring is clockwise", () => {
    expect(ringDirection([...square].reverse())).toBe("clockwise");
  });
  it("is null for fewer than 3 points or a degenerate ring", () => {
    expect(ringDirection(square.slice(0, 2))).toBeNull();
    expect(ringDirection([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toBeNull();
  });
});

describe("directionText", () => {
  it("long form always says it comes from pin order", () => {
    expect(directionText("clockwise", "long")).toBe("clockwise (from pin order)");
    expect(directionText("counterclockwise", "short")).toBe("counterclockwise");
    expect(directionText(null, "long")).toBeNull();
  });
});

describe("fare chips (whole pesos, estimates only)", () => {
  it("formats an estimate range", () => {
    expect(fareChipText({ status: "estimate", minCentavos: 1400, maxCentavos: 1700 })).toBe("Estimate ₱14–₱17");
  });
  it("collapses an equal range and rounds outward to whole pesos", () => {
    expect(fareChipText({ status: "estimate", minCentavos: 1400, maxCentavos: 1400 })).toBe("Estimate ₱14");
    expect(fareChipText({ status: "estimate", minCentavos: 1450, maxCentavos: 2150 })).toBe("Estimate ₱14–₱22");
  });
  it("unavailable and walk-only have their own copy, never ₱0", () => {
    expect(fareChipText({ status: "unavailable", minCentavos: null, maxCentavos: null })).toBe("Fare estimate unavailable");
    expect(fareChipText({ status: "no_ride", minCentavos: 0, maxCentavos: 0 })).toBe("No fare (walk)");
    expect(fareChipText({ status: "estimate", minCentavos: null, maxCentavos: 1700 })).toBe("Fare estimate unavailable");
  });
  it("per-leg text carries the reported-minimum caveat", () => {
    expect(legFareText({ status: "estimate", minCentavos: 1400, maxCentavos: 1700 })).toBe(
      "Estimate ₱14–₱17 · from reported fare rules · matrix not verified",
    );
    expect(legFareText({ status: "unavailable", minCentavos: null, maxCentavos: null })).toBe("Fare estimate unavailable");
  });
});

describe("distances and counts", () => {
  it("rounds metres to 10 and switches to km at 1000 m", () => {
    expect(formatDistance(0)).toBe("≈ 0 m");
    expect(formatDistance(234)).toBe("≈ 230 m");
    expect(formatDistance(995)).toBe("≈ 1.0 km");
    expect(formatDistance(5486)).toBe("≈ 5.5 km");
  });
  it("transfers count from rides", () => {
    expect(transfersText(0)).toBe("No transfers");
    expect(transfersText(1)).toBe("No transfers");
    expect(transfersText(2)).toBe("1 transfer");
    expect(transfersText(3)).toBe("2 transfers");
  });
});

describe("labels", () => {
  it("route chip uses the loop letter from the route name, else the code", () => {
    expect(routeChipLabel("R8-A", "Centro–Magsaysay Loop A")).toBe("Loop A");
    expect(routeChipLabel("R8-B", "Loop B")).toBe("Loop B");
    expect(routeChipLabel("R3", "Centro–Pacol")).toBe("R3");
  });
  it("stop label adds the code once", () => {
    expect(stopLabel("Plaza Rizal", "A1")).toBe("Plaza Rizal (A1)");
    // A pin with an empty source label (its name falls back to the code) never borrows a name.
    expect(stopLabel("B18", "B18")).toBe("Unnamed pin B18");
    expect(stopDisplayName("B18", "B18")).toBe("Unnamed pin B18");
    expect(stopDisplayName("Plaza Rizal", "A1")).toBe("Plaza Rizal");
    // Verbatim source typos stay as they are.
    expect(stopLabel("Villla Caceres", "A7")).toBe("Villla Caceres (A7)");
    expect(stopLabel("Somewhere", null)).toBe("Somewhere");
  });
});

describe("noCoverageCopy", () => {
  const ONLY = "Loops A and B are the only routes we can suggest for now.";
  it("says which end has no stop within the 600 m walk, with the direct walk estimate", () => {
    expect(noCoverageCopy("no_stop_near_origin", 1200)).toEqual({
      title: "No mapped stop within 600 m of your start",
      detail: `Walking the whole way: ≈ 1.2 km (straight-line estimate; path not verified). ${ONLY}`,
    });
    expect(noCoverageCopy("no_stop_near_destination", 845)).toEqual({
      title: "No mapped stop within 600 m of your destination",
      detail: `Walking the whole way: ≈ 850 m (straight-line estimate; path not verified). ${ONLY}`,
    });
  });
  it("no_route: stops at both ends, but no provisional ride joins them", () => {
    expect(noCoverageCopy("no_route", 1460)).toEqual({
      title: "No provisional route connects these points yet",
      detail: `Walking the whole way: ≈ 1.5 km (straight-line estimate; path not verified). ${ONLY}`,
    });
  });
  it("same_place asks to move a pin", () => {
    expect(noCoverageCopy("same_place", 10)).toEqual({
      title: "Start and destination are the same place",
      detail: "Move the destination pin away from your start to plan a trip.",
    });
  });
  it("outside_city asks for points inside the city", () => {
    expect(noCoverageCopy("outside_city", null)).toEqual({
      title: "Both points need to be inside Naga City",
      detail: ONLY,
    });
  });
  it("walk_shorter names the direct walk estimate", () => {
    expect(noCoverageCopy("walk_shorter", 845)).toEqual({
      title: "Walking (≈ 850 m) is shorter than any ride we can suggest.",
      detail: `Straight-line estimate; path not verified. ${ONLY}`,
    });
  });
  it("without an estimate it never invents one", () => {
    expect(noCoverageCopy("walk_shorter", null)).toEqual({ title: "No provisional route nearby yet", detail: ONLY });
    expect(noCoverageCopy("no_route", null)).toEqual({ title: "No provisional route connects these points yet", detail: ONLY });
    expect(noCoverageCopy(null, null)).toEqual({ title: "No provisional route nearby yet", detail: ONLY });
  });
});

describe("isNegligibleWalk", () => {
  it("drops only walks whose estimate is under 15 m", () => {
    expect(isNegligibleWalk({ kind: "walk", estimateMeters: 0 })).toBe(true);
    expect(isNegligibleWalk({ kind: "walk", estimateMeters: 14.9 })).toBe(true);
    expect(isNegligibleWalk({ kind: "walk", estimateMeters: 15 })).toBe(false);
    expect(isNegligibleWalk({ kind: "ride" })).toBe(false);
    expect(isNegligibleWalk({ kind: "walk" })).toBe(false);
  });
});

describe("ride leg copy (Task 8: D13 distance basis, mixed fleets)", () => {
  it("names the distance basis and never presents the path as exact", () => {
    expect(distanceBasisText(3420, "approximate_path")).toBe("≈ 3.4 km along the approximate path");
    expect(distanceBasisText(3080, "stop_to_stop_straight_line")).toBe("≈ 3.1 km stop to stop (straight line)");
    expect(distanceBasisText(640, "approximate_path")).toBe("≈ 640 m along the approximate path");
  });

  it("mixed fleet: traditional to modern rate, citing riders' reports only when they set the maximum", () => {
    expect(legFareText({ status: "estimate", minCentavos: 1400, maxCentavos: 1700, span: "traditional_to_modern", basis: "fare_rules" })).toBe(
      "Estimate ₱14–₱17 · traditional to modern rate · matrix not verified",
    );
    expect(legFareText({ status: "estimate", minCentavos: 1400, maxCentavos: 1900, span: "traditional_to_modern", basis: "fare_rules_and_reports" })).toBe(
      "Estimate ₱14–₱19 · traditional to modern rate · from the national fare rule and riders' reports · matrix not verified",
    );
    expect(legFareText({ status: "unavailable", minCentavos: null, maxCentavos: null, span: "traditional_to_modern", basis: "fare_rules" })).toBe(
      "Fare estimate unavailable",
    );
  });

  it("a single-class or unconfirmed fleet keeps the existing wording", () => {
    expect(legFareText({ status: "estimate", minCentavos: 1400, maxCentavos: 1700, span: "rule_span", basis: "fare_rules" })).toBe(
      "Estimate ₱14–₱17 · from reported fare rules · matrix not verified",
    );
  });

  const rec = (vehicleClass: FleetRecord["vehicleClass"], aircon: boolean | null, status: FleetRecord["status"] = "operating"): FleetRecord => ({
    code: `FL-${vehicleClass}`, vehicleClass, evidenceLevels: ["owner_confirmation"], status, firstReportedOn: null, lastReportedOn: "2026-10-16",
    unitsNote: null, aircon, airconSourceCodes: aircon === null ? [] : ["U01"], cooperatives: [], sourceCodes: ["U01"],
  });

  it("names the vehicle classes of a ride, aircon only when a source states it, never e-jeep", () => {
    expect(rideFleetText("jeepney", fleetSummary([rec("traditional_puj", null), rec("modern_puj", true)], "jeepney"))).toBe(
      "Jeepney · traditional and modern (air-conditioned)",
    );
    expect(rideFleetText("jeepney", fleetSummary([rec("traditional_puj", null), rec("modern_puj", null)], "jeepney"))).toBe(
      "Jeepney · traditional and modern",
    );
    expect(rideFleetText("jeepney", fleetSummary([rec("traditional_puj", null)], "jeepney"))).toBe("Jeepney · traditional");
    expect(rideFleetText("jeepney", fleetSummary([], "jeepney"))).toBe("Jeepney · type not confirmed");
    for (const t of [rideFleetText("jeepney", fleetSummary([rec("traditional_puj", null), rec("modern_puj", true)], "jeepney"))]) {
      expect(t).not.toMatch(/e-jeep/i);
    }
  });
});
