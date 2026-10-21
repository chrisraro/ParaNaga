// Field test 2026-10-21 (Loop B counterclockwise to Robinsons B11): with GPS on, the stop count did not move
// as the jeepney passed BISCAST. The planner dropped the boarding pin its own board point is named after
// (the projection sat 13 m past the pin), so the rail's "boarded" dot was BISCAST, a stop still ahead, and
// passing it could never count. Real Lines, snapshot and streets; synthetic noisy GPS along the Lines path.
import { describe, expect, it } from "vitest";
import { pathRideProgress, rideProgress, NEW_RIDE_MEMORY } from "@/domain/guidance/progress";
import type { LatLng } from "@/domain/geo/types";
import { planningNetwork, planTrip } from "@/domain/planner/plan";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const NET = { lines, streets: realStreets() };
const TEN = { now: new Date("2026-10-17T02:00:00Z") };
const net = planningNetwork(snap, lines);
const variantOf = (code: string) => net.variants.find((v) => v.routeCode === code && net.pins.has(v.variantId)) ?? net.variants.find((v) => v.routeCode === code)!;

type V = (typeof net.variants)[number];
function pointAt(v: V, m0: number): LatLng {
  const m = ((m0 % v.lengthM) + v.lengthM) % v.lengthM;
  const i = Math.max(1, v.cumM.findIndex((c) => c >= m));
  const t = (m - v.cumM[i - 1]!) / (v.cumM[i]! - v.cumM[i - 1]! || 1);
  const a = v.points[i - 1]!;
  const b = v.points[i]!;
  return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
}

/** Fixes every 20–40 m along the path from `fromM` to `toM`, accuracy 15–40 m, Gaussian noise (σ = accuracy / 2). */
function trace(v: V, fromM: number, toM: number, seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out: { x: number; fix: { lat: number; lng: number; accuracy: number; timestamp: number } }[] = [];
  let t = 1_000_000;
  for (let m = fromM; m <= toM; m += 20 + rnd() * 20) {
    const p = pointAt(v, m);
    const accuracy = 15 + rnd() * 25;
    out.push({ x: m - fromM, fix: { lat: p.lat + (gauss() * accuracy) / 2 / 110_574, lng: p.lng + (gauss() * accuracy) / 2 / 108_190, accuracy, timestamp: (t += 3_000) } });
  }
  return out;
}

/** Plans origin → destination and rides the one-ride option on `code` with GPS; checks the count against the pins passed. */
function rideWithGps(code: string, origin: LatLng, destination: LatLng, seed: number) {
  const v = variantOf(code);
  const leg = planTrip(snap, NET, origin, destination, TEN)
    .options.filter((o) => o.legs.filter((l) => l.kind === "ride").length === 1)
    .flatMap((o) => o.legs)
    .find((l) => l.kind === "ride" && l.variantId === v.variantId);
  if (!leg || leg.kind !== "ride") return null;
  // The rail starts at the pin the board point is named after (the place the rider boards).
  if (leg.board.stopId) expect(leg.stops[0]!.id).toBe(leg.board.stopId);
  if (leg.alight.stopId) expect(leg.stops.at(-1)!.id).toBe(leg.alight.stopId);
  const pinM = new Map(net.pins.get(v.variantId)!.map((p) => [p.stopId, p.measureM]));
  // Metres along the ride from the board point (a pin up to 100 m before it reads negative).
  const along = (m: number) => ((((m - leg.boardMeasureM! + 100) % v.lengthM) + v.lengthM) % v.lengthM) - 100;
  const pins = leg.stops.map((s) => along(pinM.get(s.id)!));
  let memory = NEW_RIDE_MEMORY;
  for (const { x, fix } of trace(v, leg.boardMeasureM!, leg.boardMeasureM! + leg.distanceMeters, seed)) {
    const before = memory.passedIndex;
    memory = rideProgress(leg.stops, memory, fix, fix.timestamp);
    const at = `${code} ${leg.stops[0]!.name} → ${leg.stops.at(-1)!.name} at ${Math.round(x)} m (pins at ${pins.map(Math.round).join(",")})`;
    expect(memory.passedIndex).toBeGreaterThanOrEqual(before);
    // Every pin the jeepney is 100 m past has been counted (the boarding pin, within 100 m of the board point, is index 0).
    expect(memory.passedIndex, at).toBeGreaterThanOrEqual(pins.filter((d) => d > 100 && d <= x - 100).length);
  }
  expect(memory).toMatchObject({ passedIndex: leg.stops.length - 1, countLost: false });
  return leg;
}

describe("GPS stop count on the real loops (field test 2026-10-21)", () => {
  it("Loop B counterclockwise: board by Peñafrancia/Magsaysay, alight at Robinsons (B11); the count moves past BISCAST", () => {
    const leg = rideWithGps("R8-B", { lat: 13.6329, lng: 123.1941 }, { lat: 13.615, lng: 123.1928 }, 20261021);
    expect(leg).not.toBeNull();
    expect(leg!.stops.map((s) => s.name)).toEqual(expect.arrayContaining(["Cor. Peñafrancia Ave & Magsaysay Ave", "BISCAST", "Robinsons Mall/Banko Central ng Pilipinas"]));
    expect(leg!.stops[0]!.name).toBe("Cor. Peñafrancia Ave & Magsaysay Ave");
    expect(leg!.stops.at(-1)!.name).toBe("Robinsons Mall/Banko Central ng Pilipinas");
  });

  it.each(["R8-A", "R8-B"])("%s: boarding 40 m past a pin and riding ~8 pins, the count follows the pins passed", (code) => {
    const v = variantOf(code);
    const pins = net.pins.get(v.variantId)!;
    let rides = 0;
    for (let k = 0; k < pins.length; k += 3) {
      const origin = pointAt(v, pins[k]!.measureM + 40);
      const destination = pointAt(v, pins[(k + 8) % pins.length]!.measureM);
      if (rideWithGps(code, origin, destination, 1000 + k)) rides++;
    }
    expect(rides).toBeGreaterThanOrEqual(5);
  });

  it.each(["R8-C", "R8-D"])("%s (no pins): the path progress only shrinks along the ride and never reads off path", (code) => {
    const v = variantOf(code);
    const [board, alight] = [v.lengthM * 0.1, v.lengthM * 0.6];
    let last = Infinity;
    for (const { fix } of trace(v, board, alight, 7)) {
      const p = pathRideProgress(v.points, v.isCircuit, board, alight, fix, fix.timestamp)!;
      expect(p.offPath).toBe(false);
      if (!p.offPath) {
        expect(p.remainingM).toBeLessThanOrEqual(last + 60);
        last = Math.min(last, p.remainingM);
      }
    }
    expect(last).toBeLessThan(100);
  });
});
