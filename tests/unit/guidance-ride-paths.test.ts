// The ride paths guidance starts with (Increment E Task 10).
import { describe, expect, it } from "vitest";
import { linesSchema } from "@/domain/api/schemas";
import { ridePathsFor } from "@/domain/guidance/ride-paths";
import { decodePolyline } from "@/domain/geo/polyline";
import { isCircuitLine } from "@/domain/planner/paths";
import linesJson from "../e2e/fixtures/network/lines.json";
import { PATH_LINE, oneRide, pathRide } from "./guidance-fixtures";

const lines = linesSchema.parse(linesJson);

describe("ridePathsFor", () => {
  it("is undefined without Lines or without a ride on free points", () => {
    const base = { ...oneRide(), legs: [pathRide(100, 900, (m) => ({ lat: PATH_LINE[0]!.lat + m / 111_320, lng: PATH_LINE[0]!.lng }))] };
    expect(ridePathsFor(base, null)).toBeUndefined();
    expect(ridePathsFor(oneRide(), lines)).toBeUndefined();
  });

  it("maps each ridden variant to its encoded path and circuit flag", () => {
    const line = lines.lines[0]!;
    const ride = { ...pathRide(100, 900, () => PATH_LINE[0]!), variantId: line.variantId };
    const paths = ridePathsFor({ legs: [ride] }, lines)!;
    expect(Object.keys(paths)).toEqual([line.variantId]);
    expect(paths[line.variantId]).toEqual({ encoded: line.encoded, isCircuit: isCircuitLine(line) });
    expect(decodePolyline(paths[line.variantId]!.encoded).length).toBeGreaterThan(1);
  });

  it("skips a variant the Lines do not hold", () => {
    expect(ridePathsFor({ legs: [pathRide(100, 900, () => PATH_LINE[0]!)] }, lines)).toBeUndefined();
  });
});
