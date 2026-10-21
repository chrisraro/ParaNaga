import { describe, expect, it } from "vitest";
import { getRoadsideAdvice } from "@/domain/planner/roadside";

describe("roadside advice and two-way corridor detection", () => {
  const CENTRO = { lat: 13.6233869, lng: 123.1846726, name: "Plaza Rizal" };
  const MAGSAYSAY_COR = { lat: 13.6300, lng: 123.1950, name: "Cor. Magsaysay Ave. & Dayangdang St" };
  const DIVERSION_SM = { lat: 13.62539, lng: 123.19967, name: "Roxas Ave / Diversion near SM" };
  const FRANCIA_ST = { lat: 13.6320, lng: 123.1880, name: "Peñafrancia Ave near Cam High" };
  const BAGUMBAYAN_ST = { lat: 13.6310, lng: 123.1830, name: "Bagumbayan Sur" };

  it("Magsaysay Ave: Loop B & Loop D board Westbound to Centro; Loop A & Loop C board Eastbound to Diversion", () => {
    const loopB = getRoadsideAdvice("R8-B", MAGSAYSAY_COR, CENTRO);
    expect(loopB).not.toBeNull();
    expect(loopB?.heading).toBe("westbound");
    expect(loopB?.chip).toBe("Westbound side · to Centro");
    expect(loopB?.advice).toContain("Westbound side of Magsaysay Ave (facing Peñafrancia & Centro)");
    expect(loopB?.isTwoWay).toBe(true);

    const loopD = getRoadsideAdvice("R8-D", MAGSAYSAY_COR, CENTRO);
    expect(loopD?.heading).toBe("westbound");
    expect(loopD?.chip).toBe("Westbound side · to Centro");

    const loopA = getRoadsideAdvice("R8-A", MAGSAYSAY_COR, DIVERSION_SM);
    expect(loopA).not.toBeNull();
    expect(loopA?.heading).toBe("eastbound");
    expect(loopA?.chip).toBe("Eastbound side · to Diversion");
    expect(loopA?.advice).toContain("Eastbound side of Magsaysay Ave (facing Diversion Road / SM)");
    expect(loopA?.isTwoWay).toBe(true);

    const loopC = getRoadsideAdvice("R8-C", MAGSAYSAY_COR, DIVERSION_SM);
    expect(loopC?.heading).toBe("eastbound");
    expect(loopC?.chip).toBe("Eastbound side · to Diversion");
  });

  it("Roxas Ave (Diversion): Loop B & D board Northbound; Loop A & C board Southbound to Centro", () => {
    const loopB = getRoadsideAdvice("R8-B", DIVERSION_SM, MAGSAYSAY_COR);
    expect(loopB?.heading).toBe("northbound");
    expect(loopB?.chip).toBe("Northbound side · to Magsaysay");
    expect(loopB?.advice).toContain("Northbound side of Roxas Ave (facing Magsaysay Ave)");
    expect(loopB?.isTwoWay).toBe(true);

    const loopA = getRoadsideAdvice("R8-A", DIVERSION_SM, CENTRO);
    expect(loopA?.heading).toBe("southbound");
    expect(loopA?.chip).toBe("Southbound side · to Centro");
    expect(loopA?.advice).toContain("Southbound side of Roxas Ave (facing Panganiban / Centro)");
    expect(loopA?.isTwoWay).toBe(true);
  });

  it("Peñafrancia Ave (Francia): Loop A & C board Northbound; Loop B & D board Southbound to Centro", () => {
    const loopA = getRoadsideAdvice("R8-A", FRANCIA_ST, MAGSAYSAY_COR);
    expect(loopA?.heading).toBe("northbound");
    expect(loopA?.chip).toBe("Northbound side · to Magsaysay");

    const loopB = getRoadsideAdvice("R8-B", FRANCIA_ST, CENTRO);
    expect(loopB?.heading).toBe("southbound");
    expect(loopB?.chip).toBe("Southbound side · to Centro");
  });

  it("Centro / Plaza Rizal: assigns distinct roadside terminal guidance for loops", () => {
    const loopA = getRoadsideAdvice("R8-A", CENTRO, MAGSAYSAY_COR);
    expect(loopA?.chip).toBe("Centro / Gen. Luna");
    expect(loopA?.advice).toContain("Gen. Luna facing North");

    const loopB = getRoadsideAdvice("R8-B", CENTRO, DIVERSION_SM);
    expect(loopB?.chip).toBe("Gen. Luna / Elias Angeles");
    expect(loopB?.advice).toContain("Gen. Luna / Elias Angeles facing West");
  });

  it("Bagumbayan: Loop C boards Northbound; Loop D boards Southbound", () => {
    const loopC = getRoadsideAdvice("R8-C", BAGUMBAYAN_ST, MAGSAYSAY_COR);
    expect(loopC?.chip).toBe("Northbound side · to Magsaysay");

    const loopD = getRoadsideAdvice("R8-D", BAGUMBAYAN_ST, CENTRO);
    expect(loopD?.chip).toBe("Southbound side · to Centro");
  });
});
