import { describe, expect, it } from "vitest";
import {
  syncSavedPlacesPayloadSchema,
  syncSavedTripsPayloadSchema,
  savedPlacesResponseSchema,
  savedTripsResponseSchema,
} from "@/domain/saved/sync-schemas";
import { buildSavedTrip, type SavedPlace, type SavedTrip } from "@/domain/saved/saved";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";

const plan: PlanResponse = planResponseSchema.parse(PROVISIONAL_PLAN);
const option = plan.plan.options[0]!;
const START = { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } };
const DEST = { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } };

describe("saved sync schemas", () => {
  it("validates saved place sync payloads and responses", () => {
    const place: SavedPlace = {
      id: "place-1",
      label: "Home",
      point: { lat: 13.621, lng: 123.194 },
      source: "pin",
      savedAt: new Date().toISOString(),
    };

    const payload = syncSavedPlacesPayloadSchema.parse({ places: [place] });
    expect(payload.places).toHaveLength(1);

    const res = savedPlacesResponseSchema.parse({ places: [place] });
    expect(res.places[0]!.id).toBe("place-1");
  });

  it("validates saved trip sync payloads and responses", () => {
    const trip: SavedTrip = buildSavedTrip({
      id: "trip-1",
      savedAt: "2026-10-16T02:00:00.000Z",
      data: plan,
      option,
      start: START,
      destination: DEST,
    });

    const payload = syncSavedTripsPayloadSchema.parse({ trips: [trip] });
    expect(payload.trips).toHaveLength(1);

    const res = savedTripsResponseSchema.parse({ trips: [trip] });
    expect(res.trips[0]!.id).toBe("trip-1");
  });
});
