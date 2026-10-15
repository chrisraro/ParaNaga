// Pins from the snapshot (D2) must be exactly what GET /api/v1/stops?bbox= returned for the same
// revision: both fixtures were captured from one published revision.
import { describe, expect, it } from "vitest";
import { networkSnapshotSchema, stopsInBboxSchema } from "@/domain/api/schemas";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { pinsInBounds, snapshotPins } from "@/domain/network/snapshot-pins";
import snapshotJson from "../e2e/fixtures/network/snapshot.json" with { type: "json" };
import stopsAllJson from "../e2e/fixtures/network/stops-all.json" with { type: "json" };

const snapshot = networkSnapshotSchema.parse(snapshotJson);
const stopsAll = stopsInBboxSchema.parse(stopsAllJson);

describe("snapshot pins", () => {
  it("equal the bbox endpoint's pins for the whole city, route codes included", () => {
    const pins = pinsInBounds(snapshotPins(snapshot), NAGA_MAX_BOUNDS);
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...pins].sort(byId)).toEqual([...stopsAll.stops].sort(byId));
    expect(snapshot.revision).toEqual(stopsAll.revision);
  });

  it("list each route code once, sorted, and none for a stop no variant orders", () => {
    const pins = snapshotPins({
      stops: snapshot.stops.slice(0, 2),
      variants: [
        { ...snapshot.variants[0]!, routeCode: "R8-B", stopIds: [snapshot.stops[0]!.id, snapshot.stops[0]!.id] },
        { ...snapshot.variants[0]!, routeCode: "R8-A", stopIds: [snapshot.stops[0]!.id] },
      ],
    });
    expect(pins.map((p) => p.routeCodes)).toEqual([["R8-A", "R8-B"], []]);
  });

  it("filter a view with its edges included", () => {
    const pins = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];
    expect(pinsInBounds(pins, { west: 1, south: 1, east: 2, north: 2 })).toEqual([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
  });
});
