// Pure text helpers for search (src/domain/search/normalize.ts): used by the server-side index
// builder to group pin labels and by the client (Task 5) to match queries. No I/O.
import { describe, expect, it } from "vitest";
import { foldText, matchScore, rankByQuery, tokenize } from "@/domain/search/normalize";

describe("foldText", () => {
  it("applies NFC, trims, collapses spaces, case-folds and strips diacritics", () => {
    expect(foldText("  Peñafrancia   Ave ")).toBe("penafrancia ave");
    expect(foldText("PLAZA\tRizal")).toBe("plaza rizal");
    // Decomposed input (n + combining tilde) folds the same as the precomposed ñ.
    expect(foldText("Peñafrancia")).toBe("penafrancia");
    expect(foldText("Elías Ángeles")).toBe("elias angeles");
  });

  it("keeps punctuation (label grouping must not merge different spellings by accident)", () => {
    expect(foldText("Penafrancia - Magsaysay")).toBe("penafrancia - magsaysay");
  });

  it("returns an empty string for blank input", () => {
    expect(foldText("   ")).toBe("");
    expect(foldText("")).toBe("");
  });
});

describe("tokenize", () => {
  it("splits folded text on anything that is not a letter or digit", () => {
    expect(tokenize("Peñafrancia - Magsaysay")).toEqual(["penafrancia", "magsaysay"]);
    expect(tokenize("R8-A")).toEqual(["r8", "a"]);
    expect(tokenize("Gen. Luna St")).toEqual(["gen", "luna", "st"]);
    expect(tokenize(" , ")).toEqual([]);
  });
});

describe("matchScore", () => {
  const f = (text: string, weight = 1) => [{ text, weight }];

  it("is 0 for an empty query or no match", () => {
    expect(matchScore("", f("Plaza Rizal"))).toBe(0);
    expect(matchScore("cathedral", f("Plaza Rizal"))).toBe(0);
  });

  it("ranks exact > prefix > all tokens as word prefixes > substring", () => {
    const exact = matchScore("plaza rizal", f("Plaza Rizal"));
    const prefix = matchScore("plaza", f("Plaza Rizal"));
    const tokens = matchScore("riz pla", f("Plaza Rizal"));
    const substring = matchScore("aza ri", f("Plaza Rizal"));
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(tokens);
    expect(tokens).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it("ignores accents and case in both query and text", () => {
    expect(matchScore("PENAFRANCIA", f("Peñafrancia Ave"))).toBeGreaterThan(0);
    expect(matchScore("peñafrancia", f("Penafrancia Ave"))).toBeGreaterThan(0);
  });

  it("takes the best weighted field", () => {
    const name = matchScore("roxas", [{ text: "Roxas Ave", weight: 1 }]);
    const street = matchScore("roxas", [{ text: "Loop A", weight: 1 }, { text: "Roxas Ave", weight: 0.5 }]);
    expect(name).toBeGreaterThan(street);
    expect(street).toBeGreaterThan(0);
  });
});

describe("rankByQuery", () => {
  const items = [
    { name: "Naga Cathedral" },
    { name: "Plaza Rizal" },
    { name: "Plaza Quince Martires" },
    { name: "Rizal Street" },
  ];
  const fields = (i: { name: string }) => [{ text: i.name, weight: 1 }];

  it("returns only matches, best first, ties in input order", () => {
    expect(rankByQuery("plaza", items, fields).map((i) => i.name)).toEqual(["Plaza Rizal", "Plaza Quince Martires"]);
    expect(rankByQuery("rizal", items, fields).map((i) => i.name)).toEqual(["Rizal Street", "Plaza Rizal"]);
  });

  it("honours a limit and returns nothing for a blank query", () => {
    expect(rankByQuery("plaza", items, fields, 1)).toHaveLength(1);
    expect(rankByQuery("  ", items, fields)).toEqual([]);
  });
});
