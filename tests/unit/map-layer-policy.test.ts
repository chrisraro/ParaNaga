// @vitest-environment jsdom
// Facts: the route lines and the legend must never vanish: not while picking a point, not while a
// trip is open, not while it is guided, and not when the trip revision's lines are not loaded.
import { describe, expect, it } from "vitest";
import { guidanceActiveLegIndex, guidanceStopPins } from "@/ui/home/use-home-guidance";
import { legendVisualKeys, mapLayerPolicy, mapScene, overviewLinesForTrip } from "@/ui/map/map-layer-policy";
import { INACTIVE_LEG_OPACITY, buildTripLinesData, legOpacity } from "@/ui/map/trip-lines-layer";
import { startSession } from "@/domain/guidance/session";
import { oneRide, twoRides, tripOf, LOOP_A, LOOP_B } from "./guidance-fixtures";

const base = { guiding: false, tripOpen: false, picking: false, tripHasRides: true, tripLinesStatus: "ready" as const, sameRevisionAsOverview: true };

describe("mapLayerPolicy", () => {
  it("idle: overview lines, interactive, legend", () => {
    expect(mapLayerPolicy(base)).toEqual({ scene: "idle", tripLines: false, overviewLines: true, overviewStandIn: false, tripLinesMissing: false, overviewInteractive: true, legend: true });
  });

  it("picking a point keeps the overview lines and the legend (not interactive)", () => {
    const p = mapLayerPolicy({ ...base, picking: true });
    expect(p).toMatchObject({ scene: "picking", overviewLines: true, overviewInteractive: false, legend: true });
  });

  it("an open trip draws the trip lines, not the overview, when its lines are loaded", () => {
    const p = mapLayerPolicy({ ...base, tripOpen: true });
    expect(p).toMatchObject({ scene: "detail", tripLines: true, overviewLines: false, legend: true });
  });

  it("preview (options listed, none open): the option's lines, overview hidden, nothing tappable", () => {
    const p = mapLayerPolicy({ ...base, previewing: true });
    expect(p).toMatchObject({ scene: "preview", tripLines: true, overviewLines: false, overviewInteractive: false, tripLinesMissing: false, legend: true });
  });

  it("preview falls back to the dimmed overview like a trip when its lines did not load", () => {
    const p = mapLayerPolicy({ ...base, previewing: true, tripLinesStatus: "failed" });
    expect(p).toMatchObject({ scene: "preview", overviewLines: true, overviewStandIn: true, tripLinesMissing: true });
  });

  it("an open trip and picking win over the preview", () => {
    expect(mapScene({ guiding: false, tripOpen: true, picking: false, previewing: true })).toBe("detail");
    expect(mapScene({ guiding: false, tripOpen: false, picking: true, previewing: true })).toBe("picking");
  });

  it("guiding keeps the trip lines and the legend", () => {
    const p = mapLayerPolicy({ ...base, guiding: true, tripOpen: true });
    expect(p).toMatchObject({ scene: "guiding", tripLines: true, overviewLines: false, overviewInteractive: false, legend: true });
  });

  it("guidance wins over an open trip and picking", () => {
    expect(mapScene({ guiding: true, tripOpen: true, picking: true })).toBe("guiding");
    expect(mapScene({ guiding: false, tripOpen: true, picking: true })).toBe("detail");
  });

  it("falls back to the overview lines only once the trip's lines ended without loading, on the snapshot's revision", () => {
    for (const guiding of [false, true]) {
      const p = mapLayerPolicy({ ...base, guiding, tripOpen: true, tripLinesStatus: "failed" });
      expect(p).toMatchObject({ tripLines: true, overviewLines: true, overviewStandIn: true, tripLinesMissing: true, overviewInteractive: false, legend: true });
    }
  });

  it("does not flash the overview while the trip's lines are still loading", () => {
    const p = mapLayerPolicy({ ...base, tripOpen: true, tripLinesStatus: "loading" });
    expect(p).toMatchObject({ overviewLines: false, overviewStandIn: false, tripLinesMissing: false });
  });

  it("another revision than the overview's: no stand-in, only the walks, the legend and the note", () => {
    const p = mapLayerPolicy({ ...base, tripOpen: true, tripLinesStatus: "failed", sameRevisionAsOverview: false });
    expect(p).toMatchObject({ overviewLines: false, overviewStandIn: false, tripLinesMissing: true, legend: true });
  });

  it("a walk-only trip needs no fallback", () => {
    expect(mapLayerPolicy({ ...base, tripOpen: true, tripHasRides: false, tripLinesStatus: "failed" }).overviewLines).toBe(false);
  });

  it("the legend is present in every scene", () => {
    for (const guiding of [false, true])
      for (const tripOpen of [false, true])
        for (const picking of [false, true])
          for (const tripLinesStatus of ["loading", "ready", "failed"] as const) expect(mapLayerPolicy({ ...base, guiding, tripOpen, picking, tripLinesStatus }).legend).toBe(true);
  });
});

describe("legendVisualKeys", () => {
  it("always lists walking, and only the classes drawn before it", () => {
    expect(legendVisualKeys(null, [])).toEqual(["walk"]);
    expect(legendVisualKeys(["walk", "traditional_puj"], ["modern_puj", "traditional_puj"])).toEqual(["traditional_puj", "modern_puj", "walk"]);
  });

  it("lists walking only when a walk is drawn or no trip is open", () => {
    expect(legendVisualKeys(["traditional_puj"], [])).toEqual(["traditional_puj"]);
  });

  it("clips the stand-in overview to the ridden variants by variant id", () => {
    const lines = [{ variantId: "a", routeCode: "R1" }, { variantId: "b", routeCode: "R1" }, { variantId: "c", routeCode: "R2" }];
    expect(overviewLinesForTrip(lines, ["b"]).map((l) => l.variantId)).toEqual(["b"]);
    expect(overviewLinesForTrip(lines, ["zzz"])).toEqual([]);
  });
});

describe("trip lines while guided", () => {
  it("draws the trip's walks dotted (straight fallback) with the leg index, rides need lines by variant id", () => {
    const data = buildTripLinesData(oneRide(), [], null);
    expect(data.walkSegments.map((w) => w.legIndex)).toEqual([0, 2]);
    expect(data.rideSegments).toEqual([]); // lines not loaded: no invented path
    expect(data.legendItems).toEqual(["walk"]);
  });

  it("emphasises only the current leg", () => {
    expect(legOpacity(null, 1)).toBe(1);
    expect(legOpacity(1, 1)).toBe(1);
    expect(legOpacity(1, 0)).toBe(INACTIVE_LEG_OPACITY);
  });

  it("names the current leg and the current ride's stops for each guidance step", () => {
    const s0 = startSession(tripOf(twoRides()), 0);
    expect(guidanceActiveLegIndex(s0)).toBe(0); // walk to the first stop
    expect(guidanceStopPins(s0).map((p) => p.id)).toEqual(LOOP_A.map((p) => p.id)); // the ride it is heading to
    const at = (stepIndex: number) => ({ ...s0, stepIndex });
    expect(guidanceActiveLegIndex(at(1))).toBe(1); // riding A
    expect(guidanceStopPins(at(1)).map((p) => p.id)).toEqual(LOOP_A.map((p) => p.id));
    expect(guidanceActiveLegIndex(at(2))).toBe(2); // transfer walk
    expect(guidanceStopPins(at(2)).map((p) => p.id)).toEqual(LOOP_B.map((p) => p.id));
    expect(guidanceActiveLegIndex(at(3))).toBe(3);
    expect(guidanceStopPins(at(4))).toEqual([]); // the last walk: no ride
    expect(guidanceStopPins(at(1))[0]).toMatchObject({ status: "candidate", navigationApproved: false, routeCodes: ["R01"] });
  });
});
