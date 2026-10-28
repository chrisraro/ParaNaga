import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getRoadsideAdvice } from "@/domain/planner/roadside";

describe("roadside advice and two-way corridor detection", () => {
  const CENTRO = { lat: 13.6233869, lng: 123.1846726, name: "Plaza Rizal" };
  const MAGSAYSAY_COR = { lat: 13.6300, lng: 123.1950, name: "Cor. Magsaysay Ave. & Dayangdang St" };
  const DIVERSION_SM = { lat: 13.62539, lng: 123.19967, name: "Roxas Ave / Diversion near SM" };
  const FRANCIA_ST = { lat: 13.6320, lng: 123.1880, name: "Peñafrancia Ave near Cam High" };
  const BAGUMBAYAN_ST = { lat: 13.6310, lng: 123.1830, name: "Bagumbayan Sur" };

  it("Magsaysay Ave: Loop B & Loop D board Westbound to Centro; Loop A & Loop C board Eastbound to Diversion", () => {
    const loopB = getRoadsideAdvice("R8-B", "counterclockwise", MAGSAYSAY_COR);
    expect(loopB).not.toBeNull();
    expect(loopB?.heading).toBe("westbound");
    expect(loopB?.chip).toBe("Westbound side · to Centro");
    expect(loopB?.advice).toContain("Westbound side of Magsaysay Ave (facing Peñafrancia & Centro)");
    expect(loopB?.isTwoWay).toBe(true);

    const loopD = getRoadsideAdvice("R8-D", "counterclockwise", MAGSAYSAY_COR);
    expect(loopD?.heading).toBe("westbound");
    expect(loopD?.chip).toBe("Westbound side · to Centro");

    const loopA = getRoadsideAdvice("R8-A", "clockwise", MAGSAYSAY_COR);
    expect(loopA).not.toBeNull();
    expect(loopA?.heading).toBe("eastbound");
    expect(loopA?.chip).toBe("Eastbound side · to Diversion");
    expect(loopA?.advice).toContain("Eastbound side of Magsaysay Ave (facing Diversion Road / SM)");
    expect(loopA?.isTwoWay).toBe(true);

    const loopC = getRoadsideAdvice("R8-C", "clockwise", MAGSAYSAY_COR);
    expect(loopC?.heading).toBe("eastbound");
    expect(loopC?.chip).toBe("Eastbound side · to Diversion");
  });

  it("Roxas Ave (Diversion): Loop B & D board Northbound; Loop A & C board Southbound to Centro", () => {
    const loopB = getRoadsideAdvice("R8-B", "counterclockwise", DIVERSION_SM);
    expect(loopB?.heading).toBe("northbound");
    expect(loopB?.chip).toBe("Northbound side · to Magsaysay");
    expect(loopB?.advice).toContain("Northbound side of Roxas Ave (facing Magsaysay Ave)");
    expect(loopB?.isTwoWay).toBe(true);

    const loopA = getRoadsideAdvice("R8-A", "clockwise", DIVERSION_SM);
    expect(loopA?.heading).toBe("southbound");
    expect(loopA?.chip).toBe("Southbound side · to Centro");
    expect(loopA?.advice).toContain("Southbound side of Roxas Ave (facing Panganiban / Centro)");
    expect(loopA?.isTwoWay).toBe(true);
  });

  it("Peñafrancia Ave (Francia): Loop A & C board Northbound; Loop B & D board Southbound to Centro", () => {
    const loopA = getRoadsideAdvice("R8-A", "clockwise", FRANCIA_ST);
    expect(loopA?.heading).toBe("northbound");
    expect(loopA?.chip).toBe("Northbound side · to Magsaysay");

    const loopB = getRoadsideAdvice("R8-B", "counterclockwise", FRANCIA_ST);
    expect(loopB?.heading).toBe("southbound");
    expect(loopB?.chip).toBe("Southbound side · to Centro");
  });

  it("Centro / Plaza Rizal: assigns distinct roadside terminal guidance for loops", () => {
    const loopA = getRoadsideAdvice("R8-A", "clockwise", CENTRO);
    expect(loopA?.chip).toBe("Centro / Gen. Luna");
    expect(loopA?.advice).toContain("Gen. Luna facing North");

    const loopB = getRoadsideAdvice("R8-B", "counterclockwise", CENTRO);
    expect(loopB?.chip).toBe("Gen. Luna / Elias Angeles");
    expect(loopB?.advice).toContain("Gen. Luna / Elias Angeles facing West");
  });

  it("Bagumbayan: Loop C boards Northbound; Loop D boards Southbound", () => {
    const loopC = getRoadsideAdvice("R8-C", "clockwise", BAGUMBAYAN_ST);
    expect(loopC?.chip).toBe("Northbound side · to Magsaysay");

    const loopD = getRoadsideAdvice("R8-D", "counterclockwise", BAGUMBAYAN_ST);
    expect(loopD?.chip).toBe("Southbound side · to Centro");
  });

  // D1 (audit 2026-10-28): advice only from the variant's known loop direction on a corridor the route runs on.
  describe("D1: never an invented direction", () => {
    it("linear routes (direction not known in the plan) get no advice", () => {
      expect(getRoadsideAdvice("R6", null, { lat: 13.63, lng: 123.188, name: null })).toBeNull();
      expect(getRoadsideAdvice("R4", null, { lat: 13.6225, lng: 123.19, name: "Panganiban Drive" })).toBeNull();
      expect(getRoadsideAdvice("R7", null, { lat: 13.63, lng: 123.195, name: "Magsaysay corner" })).toBeNull();
      expect(getRoadsideAdvice("R1", null, MAGSAYSAY_COR)).toBeNull();
    });

    it("a loop without a known direction, or with a direction that contradicts its ordinance, gets no advice", () => {
      expect(getRoadsideAdvice("R8-A", null, MAGSAYSAY_COR)).toBeNull();
      expect(getRoadsideAdvice("R8-A", "counterclockwise", MAGSAYSAY_COR)).toBeNull();
      expect(getRoadsideAdvice("R8-B", "clockwise", MAGSAYSAY_COR)).toBeNull();
    });

    it("a loop off its own corridors gets no advice (Loop D never runs on Peñafrancia; A/B never on Bagumbayan)", () => {
      expect(getRoadsideAdvice("R8-D", "counterclockwise", FRANCIA_ST)).toBeNull();
      expect(getRoadsideAdvice("R8-A", "clockwise", BAGUMBAYAN_ST)).toBeNull();
      expect(getRoadsideAdvice("R8-A", "clockwise", { lat: 13.6225, lng: 123.19, name: "Panganiban Drive" })).toBeNull();
    });

    it("no corridor, or a point inside two overlapping corridor boxes, gets no advice", () => {
      expect(getRoadsideAdvice("R8-B", "counterclockwise", { lat: 13.6, lng: 123.25, name: null })).toBeNull();
      // Peñafrancia and Magsaysay boxes overlap at lng 123.1920-123.1930.
      expect(getRoadsideAdvice("R8-A", "clockwise", { lat: 13.63, lng: 123.1925, name: null })).toBeNull();
      // A name that names two corridors is ambiguous too.
      expect(getRoadsideAdvice("R8-A", "clockwise", { lat: 13.63, lng: 123.1925, name: "Peñafrancia cor. Magsaysay" })).toBeNull();
    });

    it("property: only R8 loops with their ordinance direction ever get advice", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D"),
          fc.constantFrom(null, "clockwise" as const, "counterclockwise" as const),
          fc.double({ min: 13.61, max: 13.64, noNaN: true }),
          fc.double({ min: 123.175, max: 123.205, noNaN: true }),
          (code, dir, lat, lng) => {
            const r = getRoadsideAdvice(code, dir, { lat, lng, name: null });
            if (r === null) return true;
            const expected = code === "R8-A" || code === "R8-C" ? "clockwise" : code === "R8-B" || code === "R8-D" ? "counterclockwise" : "none";
            return dir === expected;
          },
        ),
        { seed: 7, numRuns: 500 },
      );
    });
  });
});
