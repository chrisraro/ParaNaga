import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { matchStreet, normalizeStreetName, wayStreetNames } from "@/domain/geo/street-names";

describe("normalizeStreetName", () => {
  it("treats Peñafrancia Ave. and Penafrancia Avenue as equal", () => {
    expect(normalizeStreetName("Peñafrancia Ave.")).toBe(normalizeStreetName("Penafrancia Avenue"));
    expect(normalizeStreetName("Peñafrancia Ave.")).toBe("penafrancia avenue");
  });

  it("expands the listed abbreviations, with or without a dot", () => {
    expect(normalizeStreetName("Elias Angeles St")).toBe("elias angeles street");
    expect(normalizeStreetName("Magsaysay Ave")).toBe("magsaysay avenue");
    expect(normalizeStreetName("Diversion Rd.")).toBe("diversion road");
    expect(normalizeStreetName("Maharlika Hwy")).toBe("maharlika highway");
    expect(normalizeStreetName("Panganiban Dr.")).toBe("panganiban drive");
    expect(normalizeStreetName("Gen. Luna St.")).toBe("general luna street");
  });

  it("removes punctuation, case and extra spaces; composes NFC first", () => {
    expect(normalizeStreetName("  J.  Hernandez–Ave ")).toBe("j hernandez avenue");
    expect(normalizeStreetName("Peñafrancia")).toBe("penafrancia");
    expect(normalizeStreetName("BARLIN")).toBe("barlin");
    expect(normalizeStreetName("...")).toBe("");
  });

  it("does not expand an abbreviation inside a word", () => {
    expect(normalizeStreetName("Street Ave")).toBe("street avenue");
    expect(normalizeStreetName("Stadium Road")).toBe("stadium road");
    expect(normalizeStreetName("Drive-In Rd")).toBe("drive in road");
  });

  it("is idempotent", () => {
    fc.assert(fc.property(fc.string(), (s) => normalizeStreetName(normalizeStreetName(s)) === normalizeStreetName(s)));
  });
});

describe("matchStreet", () => {
  const way = { tags: { name: "Peñafrancia Avenue", alt_name: "Old Road;Cathedral Way", official_name: "Our Lady of Peñafrancia Ave." } };

  it("checks name, alt_name (each ;-separated value), old_name and official_name", () => {
    expect(matchStreet("Penafrancia Ave.", way, [])).toBe("name");
    expect(matchStreet("Cathedral Way", way, [])).toBe("alt_name");
    expect(matchStreet("Our Lady of Penafrancia Avenue", way, [])).toBe("official_name");
    expect(matchStreet("Former St", { tags: { name: "X", old_name: "Former Street" } }, [])).toBe("old_name");
    expect(matchStreet("Magsaysay Ave", way, [])).toBeNull();
  });

  it("uses reviewed aliases (legal name -> OSM name)", () => {
    const aliases = [{ legalName: "Naga Diversion Rd", osmName: "Peñafrancia Avenue" }];
    expect(matchStreet("Naga Diversion Road", way, aliases)).toBe("alias");
    expect(matchStreet("Naga Diversion Road", { tags: { name: "Other" } }, aliases)).toBeNull();
  });

  it("never matches an empty name", () => {
    expect(matchStreet("", { tags: { name: "" } }, [])).toBeNull();
    expect(matchStreet("...", { tags: {} }, [])).toBeNull();
  });
});

describe("wayStreetNames", () => {
  it("lists distinct normalized names in tag order", () => {
    expect(wayStreetNames({ name: "Peñafrancia Ave.", alt_name: "Penafrancia Avenue;Old Rd", ref: "N1" })).toEqual([
      "penafrancia avenue",
      "old road",
    ]);
    expect(wayStreetNames({})).toEqual([]);
  });
});
