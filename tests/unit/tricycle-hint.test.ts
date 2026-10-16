import { describe, expect, it } from "vitest";
import { linesSchema, networkSnapshotSchema } from "@/domain/api/schemas";
import { encodePolyline } from "@/domain/geo/polyline";
import {
  TRICYCLE_FARE_NOTE,
  TRICYCLE_HINT_TITLE,
  TRICYCLE_TIME_NOTE,
  TRICYCLE_ZONES_NOTE,
  tricycleHint,
} from "@/domain/trip/tricycle-hint";
import linesFixture from "../e2e/fixtures/network/lines.json";
import snapshotFixture from "../e2e/fixtures/network/snapshot.json";

const snapshot = networkSnapshotSchema.parse(snapshotFixture);
const lines = linesSchema.parse(linesFixture);

const t14 = snapshot.terminals.find((t) => t.code === "T14");
if (!t14 || t14.lat === null || t14.lng === null) {
  throw new Error("expected T14 Balatas Tricycle Terminal with coordinates in snapshot fixture");
}
const t14Lat: number = t14.lat;
const t14Lng: number = t14.lng;

describe("tricycleHint (Task 10, D15)", () => {
  it("triggers when T14 is within 600 m of origin or destination and returns the exact D15 copy", () => {
    // ~300 m south-west of T14 (13.6311005, 123.2016278)
    const nearT14 = { lat: t14Lat - 0.0025, lng: t14Lng };
    const farPoint = { lat: 13.6224, lng: 123.1838 };

    const hint = tricycleHint(nearT14, farPoint, snapshot, lines);
    expect(hint).not.toBeNull();
    expect(hint?.terminal).toMatchObject({
      code: "T14",
      name: "Balatas Tricycle Terminal",
    });
    expect(hint?.terminal?.distanceM).toBeGreaterThan(200);
    expect(hint?.terminal?.distanceM).toBeLessThanOrEqual(600);
    expect(hint?.copy.title).toBe(TRICYCLE_HINT_TITLE);
    expect(hint?.copy.zonesNote).toBe(TRICYCLE_ZONES_NOTE);
    expect(hint?.copy.fareNote).toBe(TRICYCLE_FARE_NOTE);
    expect(hint?.copy.timeNote).toBe(TRICYCLE_TIME_NOTE);
    // D11/D15: no minutes estimated for tricycles
    expect(JSON.stringify(hint)).not.toMatch(/\b\d+\s*min\b/i);
  });

  it("does not trigger when T14 is 700 m away and no feeder is within 300 m", () => {
    // 0.0063 deg latitude is ~700 m
    const at700m = { lat: t14Lat - 0.0064, lng: t14Lng };
    const farPoint = { lat: 13.6224, lng: 123.1838 };

    const hint = tricycleHint(at700m, farPoint, snapshot, lines);
    expect(hint).toBeNull();
  });

  it("triggers when a traced tricycle feeder line passes within 300 m of either endpoint", () => {
    const feederCoords = [
      { lat: 13.615, lng: 123.21 },
      { lat: 13.618, lng: 123.215 },
    ];
    const customLines = {
      lines: [
        {
          ...lines.lines[0]!,
          variantId: "99999999-2222-4333-8444-555555555555",
          routeCode: "TRI-VISTODA",
          routeName: "Langon – Ateneo de Naga via Vistansa Subd",
          variantName: "Langon – Ateneo de Naga via Vistansa Subd",
          mode: "tricycle" as const,
          encoded: encodePolyline(feederCoords),
        },
      ],
    };
    // ~150 m north of the feeder midpoint (13.6165, 123.2125)
    const nearFeeder = { lat: 13.6178, lng: 123.2125 };
    const farOrigin = { lat: 13.6224, lng: 123.1838 };

    const hint = tricycleHint(farOrigin, nearFeeder, snapshot, customLines);
    expect(hint).not.toBeNull();
    expect(hint?.feeder).toMatchObject({
      routeCode: "TRI-VISTODA",
      name: "Langon – Ateneo de Naga via Vistansa Subd",
    });
    expect(hint?.feeder?.distanceM).toBeLessThanOrEqual(300);

    // ~450 m away from feeder -> does not trigger
    const farFromFeeder = { lat: 13.621, lng: 123.2125 };
    expect(tricycleHint(farOrigin, farFromFeeder, snapshot, customLines)).toBeNull();
  });

  it("never triggers on a waiting area without a coordinate (T15, T16)", () => {
    const waitingOnly = {
      terminals: snapshot.terminals.filter((t) => t.code === "T15" || t.code === "T16"),
    };
    expect(waitingOnly.terminals).toHaveLength(2);
    expect(waitingOnly.terminals.every((t) => t.lat === null && t.lng === null)).toBe(true);

    const hint = tricycleHint({ lat: 13.6224, lng: 123.1838 }, { lat: 13.6311, lng: 123.2016 }, waitingOnly, { lines: [] });
    expect(hint).toBeNull();
  });
});
