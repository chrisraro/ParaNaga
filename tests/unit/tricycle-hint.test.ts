import { describe, expect, it } from "vitest";
import { networkSnapshotSchema } from "@/domain/api/schemas";
import { nearestTricycleTerminal } from "@/domain/trip/tricycle-hint";
import snapshotFixture from "../e2e/fixtures/network/snapshot.json";

const snapshot = networkSnapshotSchema.parse(snapshotFixture);
const t14 = snapshot.terminals.find((t) => t.code === "T14");
if (!t14 || t14.lat === null || t14.lng === null) throw new Error("expected T14 with coordinates in the snapshot fixture");
const far = { lat: 13.6224, lng: 123.1838 };

describe("nearestTricycleTerminal", () => {
  it("matches T14 within 600 m of either end and names which end", () => {
    const near = { lat: t14.lat! - 0.0025, lng: t14.lng! };
    expect(nearestTricycleTerminal(near, far, snapshot.terminals)).toMatchObject({ code: "T14", near: "origin" });
    expect(nearestTricycleTerminal(far, near, snapshot.terminals)).toMatchObject({ code: "T14", near: "destination" });
  });

  it("does not match 700 m away", () => {
    expect(nearestTricycleTerminal({ lat: t14.lat! - 0.0064, lng: t14.lng! }, far, snapshot.terminals)).toBeUndefined();
  });

  it("never matches a waiting area without a coordinate (T15, T16)", () => {
    const waiting = snapshot.terminals.filter((t) => t.code === "T15" || t.code === "T16");
    expect(waiting.every((t) => t.lat === null && t.lng === null)).toBe(true);
    expect(nearestTricycleTerminal(far, { lat: 13.6311, lng: 123.2016 }, waiting)).toBeUndefined();
  });
});
