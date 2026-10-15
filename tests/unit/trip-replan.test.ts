import { describe, expect, it } from "vitest";
import { REPLAN_MIN_MOVE_M, isGpsRefinement, shouldReplan, type PlanEnd } from "@/domain/trip/replan";

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
type Source = PlanEnd["source"];
const end = (lat: number, lng: number, source: Source): PlanEnd => ({ point: { lat, lng }, source });
const pair = (origin: PlanEnd, destination = end(BISCAST.lat, BISCAST.lng, "map")) => ({ origin, destination });
// ~0.0001° latitude ≈ 11 m; 0.0003° ≈ 33 m.
const gpsStart = pair(end(PLAZA_RIZAL.lat, PLAZA_RIZAL.lng, "gps"));
const gpsMoved = (dLat: number) => pair(end(PLAZA_RIZAL.lat + dLat, PLAZA_RIZAL.lng, "gps"));

describe("shouldReplan", () => {
  it("plans the first pair", () => expect(shouldReplan(null, gpsStart)).toBe(true));
  it("an unchanged pair does not replan", () => expect(shouldReplan(gpsStart, gpsMoved(0))).toBe(false));
  it(`a GPS refinement under ${REPLAN_MIN_MOVE_M} m does not replan`, () => expect(shouldReplan(gpsStart, gpsMoved(0.0001))).toBe(false));
  it(`a GPS refinement of ${REPLAN_MIN_MOVE_M} m or more replans`, () => expect(shouldReplan(gpsStart, gpsMoved(0.0003))).toBe(true));
  it(`a pin moved by hand under ${REPLAN_MIN_MOVE_M} m always replans (start or destination)`, () => {
    const pinned = pair(end(PLAZA_RIZAL.lat, PLAZA_RIZAL.lng, "map"));
    expect(shouldReplan(pinned, pair(end(PLAZA_RIZAL.lat + 0.0001, PLAZA_RIZAL.lng, "map")))).toBe(true);
    expect(shouldReplan(pinned, pair(pinned.origin, end(BISCAST.lat + 0.00005, BISCAST.lng, "map")))).toBe(true);
  });
  it("a search pick, or switching from GPS to a hand pin at the same spot, replans", () => {
    expect(shouldReplan(gpsStart, pair(end(PLAZA_RIZAL.lat + 0.00005, PLAZA_RIZAL.lng, "search")))).toBe(true);
    expect(shouldReplan(gpsStart, pair(end(PLAZA_RIZAL.lat, PLAZA_RIZAL.lng, "map")))).toBe(true);
  });
  it("a swap replans", () => expect(shouldReplan(gpsStart, { origin: gpsStart.destination, destination: gpsStart.origin })).toBe(true));
});

describe("isGpsRefinement (may keep the previous results while loading)", () => {
  it("a GPS end moving 25 m or more, nothing else changed", () => expect(isGpsRefinement(gpsStart, gpsMoved(0.0003))).toBe(true));
  it("not for the first plan", () => expect(isGpsRefinement(null, gpsStart)).toBe(false));
  it("not when a hand pin also moved, even slightly", () => {
    const next = pair(gpsMoved(0.0003).origin, end(BISCAST.lat + 0.00005, BISCAST.lng, "map"));
    expect(isGpsRefinement(gpsStart, next)).toBe(false);
  });
  it("not for a hand pin move, a search pick, a source change or a swap", () => {
    const pinned = pair(end(PLAZA_RIZAL.lat, PLAZA_RIZAL.lng, "map"));
    expect(isGpsRefinement(pinned, pair(end(PLAZA_RIZAL.lat + 0.01, PLAZA_RIZAL.lng, "map")))).toBe(false);
    expect(isGpsRefinement(gpsStart, pair(end(PLAZA_RIZAL.lat + 0.01, PLAZA_RIZAL.lng, "search")))).toBe(false);
    expect(isGpsRefinement(gpsStart, pair(end(PLAZA_RIZAL.lat, PLAZA_RIZAL.lng, "map")))).toBe(false);
    expect(isGpsRefinement(gpsStart, { origin: gpsStart.destination, destination: gpsStart.origin })).toBe(false);
  });
});
