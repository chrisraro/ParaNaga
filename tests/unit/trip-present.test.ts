import { describe, expect, it } from "vitest";
import {
  directionText,
  fareChipText,
  formatDistance,
  legFareText,
  noCoverageCopy,
  ringDirection,
  routeChipLabel,
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
    expect(stopLabel("B18", "B18")).toBe("B18");
    expect(stopLabel("Somewhere", null)).toBe("Somewhere");
  });
});

describe("noCoverageCopy", () => {
  const brief = { title: "No provisional route nearby yet", detail: "Loops A and B are the only routes we can suggest for now." };
  it.each(["no_route", "no_stop_near_origin", "no_stop_near_destination", "outside_city"] as const)("%s uses the brief's lines", (reason) => {
    expect(noCoverageCopy(reason, 1200)).toEqual(brief);
  });
  it("walk_shorter names the direct walk estimate", () => {
    expect(noCoverageCopy("walk_shorter", 845)).toEqual({
      title: "Walking (≈ 850 m) is shorter than any ride we can suggest.",
      detail: "Straight-line estimate; path not verified. Loops A and B are the only routes we can suggest for now.",
    });
  });
  it("walk_shorter without an estimate falls back to the brief's lines", () => {
    expect(noCoverageCopy("walk_shorter", null)).toEqual(brief);
  });
});
