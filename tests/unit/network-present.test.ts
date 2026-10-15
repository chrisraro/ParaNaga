import { describe, expect, it } from "vitest";
import {
  allocationText,
  directionLabels,
  formatIsoDate,
  latestRetrievedOn,
  modeLabel,
  nearestStops,
  routeFareTile,
  routeGroupText,
  sharedLayers,
  snapshotSourceText,
  sourceCoordinatesText,
  sourcesLine,
  stopStatusBadge,
  streetNote,
  trialNoticeText,
  vehicleTile,
} from "@/domain/network/present";
import stopA1 from "../e2e/fixtures/network/stop-a1.json";
import routeR8A from "../e2e/fixtures/network/route-r8-a.json";
import routeR5 from "../e2e/fixtures/network/route-r5.json";
import routeR3 from "../e2e/fixtures/network/route-r3.json";
import { routeDetailSchema, stopDetailSchema } from "@/domain/api/schemas";

describe("dates", () => {
  it("formats an ISO calendar date as '15 Oct 2026' without a time zone shift", () => {
    expect(formatIsoDate("2026-10-15")).toBe("15 Oct 2026");
    expect(formatIsoDate("2025-01-01")).toBe("1 Jan 2025");
    expect(formatIsoDate("2025-12-31")).toBe("31 Dec 2025");
  });

  it("rejects anything that is not a plain date", () => {
    expect(formatIsoDate(null)).toBeNull();
    expect(formatIsoDate("2026-13-01")).toBeNull();
    expect(formatIsoDate("2026-10-15T00:00:00Z")).toBeNull();
    expect(formatIsoDate("")).toBeNull();
  });

  it("dates the snapshot sentence from the newest source record, never a constant", () => {
    expect(latestRetrievedOn([{ retrievedOn: "2026-10-15" }, { retrievedOn: "2026-11-02" }, { retrievedOn: null }])).toBe("2026-11-02");
    expect(latestRetrievedOn([])).toBeNull();
    expect(snapshotSourceText("2026-11-02")).toBe("Source: public My Maps snapshot (2 Nov 2026).");
    expect(snapshotSourceText(null)).toBe("Source: public My Maps snapshot (date not recorded).");
  });
});

describe("stop source record", () => {
  it("shows coordinates exactly as the source text wrote them, lat first", () => {
    expect(sourceCoordinatesText({ coordinatesRaw: "123.1846726,13.6233869,0", lat: 13.6233869, lng: 123.1846726 })).toBe("13.6233869, 123.1846726");
    // A trailing zero in the source survives (Number() would drop it).
    expect(sourceCoordinatesText({ coordinatesRaw: "123.1846720,13.6233860,0", lat: 13.623386, lng: 123.184672 })).toBe("13.6233860, 123.1846720");
  });

  it("falls back to the numbers when the raw text is not lng,lat", () => {
    expect(sourceCoordinatesText({ coordinatesRaw: "garbled", lat: 13.6, lng: 123.1 })).toBe("13.6, 123.1");
  });

  it("badges candidates as mapped candidates and never as verified", () => {
    expect(stopStatusBadge("candidate")).toBe("Mapped candidate");
    expect(stopStatusBadge("published")).toBe("Not verified for navigation");
  });

  it("lists the other layers that share the point (real A1 fixture)", () => {
    const a1 = stopDetailSchema.parse(stopA1);
    expect(sharedLayers(a1.sharedCoordinate)).toEqual(["Loop Service C"]);
    expect(sourceCoordinatesText(a1.sourceRecords[0]!)).toBe("13.6233869, 123.1846726");
    expect(latestRetrievedOn(a1.sourceRecords)).toBe("2026-10-15");
  });
});

describe("route detail copy", () => {
  it("reads the group and mode", () => {
    expect(modeLabel("PUJ_Class_2_plan")).toBe("jeepney");
    expect(modeLabel("tricycle")).toBeNull();
    expect(routeGroupText(5, "PUJ_Class_2_plan")).toBe("Group 5 · jeepney");
    expect(routeGroupText(null, null)).toBeNull();
  });

  it("shows the planned vehicle class as plan-only", () => {
    expect(vehicleTile("PUJ_Class_2_plan")).toEqual({ value: "Class 2", note: "Plan only" });
    expect(vehicleTile(null)).toEqual({ value: "Unknown", note: "Not observed" });
  });

  it("gives a fare estimate range from the reported rules, never an exact fare", () => {
    const r8a = routeDetailSchema.parse(routeR8A);
    const tile = routeFareTile(r8a.fareEvidence.rules);
    expect(tile).toEqual({ value: "₱14–₱17", note: "Estimate", detail: "From reported fare rules · matrix not verified" });
    expect(JSON.stringify(tile)).not.toMatch(/exact/i);
    expect(routeFareTile([])).toEqual({ value: "Unknown", note: "No fare rule", detail: null });
    expect(routeFareTile([{ baseCentavos: null }])).toMatchObject({ value: "Unknown" });
    expect(routeFareTile([{ baseCentavos: 1400 }])).toMatchObject({ value: "₱14", note: "Estimate" });
  });

  it("labels the two directions from the route name", () => {
    expect(directionLabels("Centro–San Felipe")).toEqual({ inbound: "Toward Centro", outbound: "Toward San Felipe" });
    expect(directionLabels("Centro–Del Rosario via Magsaysay Avenue")).toEqual({ inbound: "Toward Centro", outbound: "Toward Del Rosario" });
    expect(directionLabels("Somewhere")).toEqual({ inbound: "Inbound", outbound: "Outbound" });
    expect(directionLabels(routeDetailSchema.parse(routeR5).route.name).outbound).toBe("Toward San Felipe");
  });

  it("notes the ends of a street order", () => {
    expect([0, 1, 2].map((i) => streetNote(i, 3, false))).toEqual(["Start", "Street on plan", "End"]);
    expect([0, 2].map((i) => streetNote(i, 3, true))).toEqual(["Start of circuit", "End of circuit"]);
  });

  it("says an allocation is not a count of running jeepneys", () => {
    const r3 = routeDetailSchema.parse(routeR3);
    expect(allocationText(r3.route)).toBe("28 units allocated in the plan (not a count of jeepneys running).");
    const r8a = routeDetailSchema.parse(routeR8A);
    expect(allocationText(r8a.route)).toBe("71 units allocated to group 8 in the plan, no per-route count (not a count of jeepneys running).");
    expect(allocationText({ allocatedUnits: null, groupAllocatedUnits: null, groupNumber: null, allocationIsActiveFleetCount: null })).toBe(
      "Units allocated in the plan: unknown.",
    );
  });

  it("lists sources with the revision", () => {
    expect(sourcesLine(["S01", "S02"], "provisional-loops-2026-10-15")).toBe("Sources S01, S02 · revision provisional-loops-2026-10-15.");
  });

  it("describes the A/B trial from its source, with permanence unconfirmed (real R8-A fixture)", () => {
    const r8a = routeDetailSchema.parse(routeR8A);
    expect(trialNoticeText(r8a.trials[0]!, r8a.sources)).toBe(
      "Trial revision: Loop A/B Eastbound trial, Resolution 2025-735 (S03), adopted 11 Nov 2025 for 30 days; permanence unconfirmed.",
    );
  });
});

describe("nearestStops", () => {
  it("orders by straight-line distance from the map centre and caps the list", () => {
    const stops = [
      { id: "far", lat: 13.64, lng: 123.2 },
      { id: "near", lat: 13.6234, lng: 123.1847 },
      { id: "mid", lat: 13.626, lng: 123.187 },
    ];
    expect(nearestStops(stops, { lat: 13.6233869, lng: 123.1846726 }, 2).map((s) => s.id)).toEqual(["near", "mid"]);
    expect(nearestStops(stops, { lat: 13.6233869, lng: 123.1846726 }, 0)).toEqual([]);
  });
});
