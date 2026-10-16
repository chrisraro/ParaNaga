import { describe, expect, it } from "vitest";
import { photoForPlace, photoForStopSource } from "@/domain/media/photos";
import { rightsForSource, SOURCE_RIGHTS_BLOCKERS } from "@/domain/sources/rights";

describe("reference photo identity and source rights", () => {
  it("never substitutes a nearby or similarly named place for an unsourced identity", () => {
    expect(photoForPlace("osm:node/unknown")).toBeNull();
    expect(photoForPlace("SM City Naga")).toBeNull();
    expect(photoForPlace("osm:way/175408605")?.creator).toBe("Ralff Nestor Nacor");
  });
  it("does not carry a landmark reference onto a relocated stop or a reused code in another loop", () => {
    const source = { layer: "Loop Service A", code: "A1", lat: 13.6233869, lng: 123.1846726 };
    expect(photoForStopSource(source)).not.toBeNull();
    expect(photoForStopSource({ ...source, lat: 13.64 })).toBeNull();
    expect(photoForStopSource({ ...source, layer: "Loop Service B" })).toBeNull();
  });
  it("does not turn a citation into reuse permission", () => {
    expect(rightsForSource("S39")?.status).toBe("reuse_unconfirmed");
    expect(rightsForSource("N01")?.license).toBe("ODbL 1.0");
    expect(rightsForSource("new-unknown-source")).toBeNull();
    expect(SOURCE_RIGHTS_BLOCKERS.map((s) => s.code)).toEqual(expect.arrayContaining(["S34", "S39", "S40"]));
  });
});
