// Share text and offline trip text for the Increment E legs (Task 9): tricycle and padyak legs and
// rides that board and alight at free points. No minutes for street legs, the fare minimum, the badge only on rides.
import { describe, expect, it } from "vitest";
import { shareText, type SavedTrip } from "@/domain/saved/saved";
import { savedTripSteps } from "@/domain/saved/trip-text";
import { ETA_MODEL, manila } from "./eta-fixtures";
import { BASE, DEST, ORIGIN, oneRide, pathRide, streetOnly } from "./guidance-fixtures";

const START = { label: "Plaza Rizal", point: ORIGIN };
const END = { label: "SM City Naga", point: DEST };
const input = (option: SavedTrip["option"]) => ({ start: START, destination: END, option, stops: [], variants: [], revisionLabel: "anywhere-alight" });
const card = (option: SavedTrip["option"]) => ({ ...input(option), destination: { ...END, label: "SM City Naga" } }) as unknown as SavedTrip;

describe("share text: street legs", () => {
  it("tricycle: the step, the minimum fare, no minutes, no route badge", () => {
    const text = shareText(input(streetOnly("tricycle", 1500)), { etaModel: ETA_MODEL, departure: manila("09:30") });
    expect(text).toContain("1. Take a tricycle to SM City Naga · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver");
    expect(text).toContain("Fare: Minimum fare ₱15");
    expect(text).toContain("Tricycle time not estimated + waiting (unknown). Data revision anywhere-alight.");
    expect(text).not.toMatch(/\d\s*min\b/);
    expect(text).not.toContain("Unverified route");
  });

  it("padyak: ₱10 per passenger, named padyak", () => {
    const text = shareText(input(streetOnly("padyak", 800)), { etaModel: ETA_MODEL, departure: manila("09:30") });
    expect(text).toContain("1. Take a padyak to SM City Naga · about 0.8 km along streets · ₱10 per passenger · confirm with the driver");
    expect(text).toContain("Fare: ₱10 per passenger");
    expect(text).toContain("Padyak time not estimated");
    expect(text).not.toMatch(/tricycle/i);
  });

  it("a ride at free points: board near, get off near the destination, 'para', stop not marked", () => {
    const at = (m: number) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
    const option = { ...oneRide(), legs: [oneRide().legs[0]!, pathRide(200, 2000, at), oneRide().legs[2]!] };
    const text = shareText(input(option));
    expect(text).toContain("Board R1 near your stop along R1");
    expect(text).toContain("Ride along the approximate path. Get off near SM City Naga · tell the driver 'para' · stop not marked");
  });
});

describe("offline trip text: street legs", () => {
  it("one line per street leg, never a crash", () => {
    expect(savedTripSteps(card(streetOnly("tricycle", 1500)))).toEqual([
      "Take a tricycle to SM City Naga · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver.",
    ]);
    expect(savedTripSteps(card(streetOnly("padyak", null, "unavailable")))).toEqual([
      "Take a padyak to SM City Naga · street route not available · ₱10 per passenger · confirm with the driver.",
    ]);
  });

  it("a ride at free points reads along the path, not by pin order", () => {
    const at = (m: number) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
    const option = { ...oneRide(), legs: [oneRide().legs[0]!, pathRide(200, 2000, at), oneRide().legs[2]!] };
    const ride = savedTripSteps(card(option))[1]!;
    expect(ride).toMatch(/^Ride R1 along the approximate path from your stop along R1\. Get off near SM City Naga · tell the driver 'para' · stop not marked\. Unverified route/);
    expect(ride).not.toMatch(/pin order/);
  });
});
