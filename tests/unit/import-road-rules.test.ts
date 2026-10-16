import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  importableRecords,
  parseModesSeed,
  RULE_EVIDENCE,
  validateModesSeed,
  verifyRulesAgainstRoads,
  type ModesSeed,
  type ModesSeedContext,
} from "@/domain/import/modes-seed";
import { normalizeSeed } from "@/domain/import/seed";
import { readPinnedRoadsSnapshot } from "../../scripts/lib/roads-snapshot";

// Increment E Task 2: road rules, padyak areas and route notes in the reviewed modes seed.
const REAL_PATH = "data/source/research/naga-modes-seed-2026-10-16.json";
const realJson: unknown = JSON.parse(readFileSync(REAL_PATH, "utf8"));
const real: ModesSeed = parseModesSeed(realJson);
const imp = importableRecords(real);
const legacy = normalizeSeed(JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8")));
const ctx: ModesSeedContext = {
  externalSourceCodes: legacy.sources.map((s) => s.code),
  existingRouteCodes: legacy.routes.map((r) => r.publicCode),
  existingTerminalCodes: legacy.terminals.map((t) => t.code),
  existingFareRules: legacy.fareRules,
};
const roads = readPinnedRoadsSnapshot()!.roads!;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const violations = (mutate: (j: Json) => void) => {
  const j: Json = clone(realJson);
  mutate(j);
  return validateModesSeed(parseModesSeed(j), ctx).join("\n");
};
const rule = (j: Json, code: string) => j.roadRules.find((r: Json) => r.code === code);

describe("road rules (TRI-2006 and Ord 93-049 Sec 132)", () => {
  it("has four TRI-2006 portions, six crossings and eight Sec 132 items", () => {
    const codes = real.roadRules.map((r) => r.code);
    expect(codes).toEqual([
      "TRI-2006-P1", "TRI-2006-P2", "TRI-2006-P3", "TRI-2006-P4",
      "TRI-2006-X1", "TRI-2006-X2", "TRI-2006-X3", "TRI-2006-X4", "TRI-2006-X5", "TRI-2006-X6",
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `PADYAK-SEC132-${n}`),
    ]);
    expect(real.roadRules.filter((r) => r.ruleCode === "TRI-2006" && r.kind === "exclude")).toHaveLength(4);
    expect(real.roadRules.filter((r) => r.ruleCode === "TRI-2006" && r.kind === "exempt")).toHaveLength(6);
    expect(real.roadRules.filter((r) => r.ruleCode === "PADYAK-SEC132").every((r) => r.kind === "exclude" && r.appliesTo[0] === "padyak")).toBe(true);
  });

  it("every way id, clip node and junction node exists in the pinned road snapshot", () => {
    expect(verifyRulesAgainstRoads(real, roads)).toEqual([]);
    const ways = new Map(roads.ways.map((w) => [w.id, w]));
    for (const r of imp.roadRules) {
      for (const c of r.clips) {
        expect(ways.get(c.wayId)!.nodeIds, r.code).toContain(c.fromNodeId);
        expect(ways.get(c.wayId)!.nodeIds, r.code).toContain(c.toNodeId);
      }
    }
  });

  it("the verifier refuses a missing way, a clip node off its way and a stray junction", () => {
    const j: Json = clone(realJson);
    rule(j, "TRI-2006-P3").wayIds.push(1);
    rule(j, "TRI-2006-P4").clips[0].fromNodeId = 254709879;
    rule(j, "TRI-2006-X5").junctionNodeId = 254709879;
    const p = verifyRulesAgainstRoads(parseModesSeed(j), roads).join("\n");
    expect(p).toMatch(/TRI-2006-P3: way\/1 is not in the snapshot/);
    expect(p).toMatch(/TRI-2006-P4: clip node 254709879 is not on way\/252223483/);
    expect(p).toMatch(/TRI-2006-X5: junction node 254709879/);
  });

  it("every rule has imported sources and a known evidence level; dates come from the research", () => {
    const known = new Set(imp.sources.map((s) => s.code));
    for (const r of real.roadRules) {
      expect(r.sourceCodes.length, r.code).toBeGreaterThan(0);
      for (const c of r.sourceCodes) expect(known.has(c), `${r.code} ${c}`).toBe(true);
      expect(RULE_EVIDENCE).toContain(r.evidence);
    }
    expect(new Set(real.roadRules.filter((r) => r.ruleCode === "TRI-2006").map((r) => r.enacted))).toEqual(new Set(["2006-01-30"]));
    expect(new Set(real.roadRules.filter((r) => r.ruleCode === "PADYAK-SEC132").map((r) => r.enacted))).toEqual(new Set(["1993"]));
  });

  it("TRI-2006 portions lift 21:00-05:00; crossings apply at all hours; only the CBD item has the 20:00-06:00 window", () => {
    for (const r of real.roadRules.filter((x) => x.ruleCode === "TRI-2006")) {
      expect(r.exceptWindow, r.code).toEqual(r.kind === "exclude" ? { from: "21:00", to: "05:00" } : null);
    }
    const sec = real.roadRules.filter((x) => x.ruleCode === "PADYAK-SEC132");
    expect(sec.filter((r) => r.exceptWindow !== null).map((r) => [r.code, r.exceptWindow])).toEqual([["PADYAK-SEC132-1", { from: "20:00", to: "06:00" }]]);
  });

  it("Sec 132 names exactly the research's streets; the CBD item has no geometry", () => {
    const sec = real.roadRules.filter((r) => r.ruleCode === "PADYAK-SEC132");
    expect(sec.map((r) => r.streets)).toEqual([
      ["Central Business District"], ["Mabolo Drive"], ["Roxas Avenue (formerly Diversion Road)"], ["Panganiban Avenue"],
      ["Concepcion Road"], ["Magsaysay Avenue"], ["Penafrancia Avenue"], ["Elias Angeles Street", "Bagumbayan Road"],
    ]);
    const cbd = sec[0]!;
    expect(cbd.geometry).toBe("not_mapped");
    expect(cbd.clipNote).toMatch(/CBD boundary not defined in the ordinance text/);
    expect(cbd.wayIds).toEqual([]);
  });

  it("refuses an unknown evidence level, an unsourced rule, an OSM class field and an e-jeepney rule (parser)", () => {
    const bad = (m: (j: Json) => void) => { const j: Json = clone(realJson); m(j); return () => parseModesSeed(j); };
    expect(bad((j) => { rule(j, "TRI-2006-P3").evidence = "rumour"; })).toThrow(/roadRules/);
    expect(bad((j) => { rule(j, "TRI-2006-P3").sourceCodes = []; })).toThrow(/roadRules/);
    expect(bad((j) => { rule(j, "TRI-2006-P3").highway = "trunk"; })).toThrow(/roadRules/);
    expect(bad((j) => { rule(j, "TRI-2006-P3").appliesTo = ["e_jeepney"]; })).toThrow(/roadRules/);
    expect(bad((j) => { j.routeNotes[0].evidence = "rumour"; })).toThrow(/routeNotes/);
    expect(bad((j) => { j.padyakAreas[0].evidence = "hearsay"; })).toThrow(/padyakAreas/);
  });

  it("refuses a street absent from the research list, an OSM class as a street, and a rule without a date unless owner-reported", () => {
    expect(violations((j) => { rule(j, "PADYAK-SEC132-7").streets = ["Almeda Highway"]; })).toMatch(/PADYAK-SEC132-7: names "Almeda Highway", a street absent/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").streets = ["trunk"]; })).toMatch(/TRI-2006-P3: names "trunk"/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").enacted = null; })).toMatch(/TRI-2006-P3: needs an enactment date/);
    const owner = violations((j) => { const r = rule(j, "TRI-2006-P3"); r.enacted = null; r.evidence = "owner_report_unverified"; r.sourceCodes = ["U02"]; });
    expect(owner).not.toMatch(/TRI-2006-P3/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").appliesTo = ["padyak"]; })).toMatch(/TRI-2006 applies to tricycle/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").sourceCodes = ["RT99"]; })).toMatch(/TRI-2006-P3 cites unknown source RT99/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").sourceCodes = ["U02"]; })).toMatch(/TRI-2006-P3: cites only owner reports/);
  });

  it("refuses inconsistent geometry", () => {
    expect(violations((j) => { rule(j, "TRI-2006-P1").wayIds = [23519386]; })).toMatch(/TRI-2006-P1: geometry not_mapped lists no ways/);
    expect(violations((j) => { rule(j, "TRI-2006-P3").wayIds = []; })).toMatch(/TRI-2006-P3: geometry ways needs wayIds/);
    expect(violations((j) => { rule(j, "TRI-2006-P4").clips[0].wayId = 30518281; })).toMatch(/TRI-2006-P4: clip on way 30518281/);
    expect(violations((j) => { const r = rule(j, "TRI-2006-P1"); r.geometry = "junction"; r.junctionNodeId = 254713607; })).toMatch(/only an exempt crossing may be a junction/);
  });
});

describe("padyak areas", () => {
  it("one record per research candidate area (19): 16 imported, Tabuco, Bagumbayan Norte and the unknown barangays excluded", () => {
    expect(real.padyakAreas).toHaveLength(19);
    expect(imp.padyakAreas).toHaveLength(16);
    expect(real.padyakAreas.filter((a) => a.review.decision === "exclude").map((a) => a.area)).toEqual([
      "Tabuco", "Bagumbayan Norte", "Pacol / Lerma / Panicuason / Carolina / Penafrancia / Dayangdang (outside CHESTA)",
    ]);
  });

  it("area node ids are place nodes whose names match the area's barangays, each in one area only", () => {
    expect(verifyRulesAgainstRoads(real, roads)).toEqual([]);
    const placeIds = new Set(roads.places.map((p) => p.id));
    const all = imp.padyakAreas.flatMap((a) => a.placeNodeIds);
    expect(all.every((id) => placeIds.has(id))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    const j: Json = clone(realJson);
    j.padyakAreas[0].placeNodeIds = [12717296939]; // Sabang's node on Abella's record
    expect(verifyRulesAgainstRoads(parseModesSeed(j), roads).join()).toMatch(/PA01: place node 12717296939 "Sabang" is not one of its barangays/);
  });

  it("every imported area is documented by ordinance with a year; owner-reported barangays add U02", () => {
    for (const a of imp.padyakAreas) {
      expect(a.evidence, a.code).toBe("official");
      expect(a.associations.length, a.code).toBeGreaterThan(0);
      expect(a.documentedYear, a.code).not.toBeNull();
      expect(a.sourceCodes.some((c) => /^RP[0-9]{2}$/.test(c)), a.code).toBe(true);
    }
    expect(imp.padyakAreas.filter((a) => a.sourceCodes.includes("U02")).map((a) => a.area)).toEqual(["Abella", "Sabang", "Igualdad", "Santa Cruz"]);
  });

  it("refuses an imported area without a place node or association", () => {
    expect(violations((j) => { j.padyakAreas[0].placeNodeIds = []; })).toMatch(/PA01: an imported area needs a place node/);
    expect(violations((j) => { j.padyakAreas[0].associations = []; })).toMatch(/PA01: an imported area needs a documented association/);
    expect(violations((j) => { j.padyakAreas[1].placeNodeIds = [12717296953]; })).toMatch(/PA02: place node 12717296953 is already in another area/);
  });

  it("header assumption A4 caps area membership at 1,000 m", () => {
    expect(real.header.assumptions?.A4.maxDistanceM).toBe(1000);
  });
});

describe("route notes", () => {
  it("has the four section E notes on the right routes", () => {
    expect(real.routeNotes.map((n) => [n.code, n.routeCodes, n.evidence])).toEqual([
      ["RN01", ["R8-C", "R8-D"], "official"],
      ["RN02", ["R8-A", "R8-B"], "official"],
      ["RN03", ["R8-A", "R8-B", "R8-C", "R8-D"], "owner_report_unverified"],
      ["RN04", ["R2"], "owner_report_unverified"],
    ]);
    expect(real.routeNotes[0]!.near).toEqual({ lat: 13.6256, lng: 123.199, radiusM: 450 });
  });

  it("note text is at most 120 characters and every note has an imported source", () => {
    const known = new Set(imp.sources.map((s) => s.code));
    for (const n of real.routeNotes) {
      expect(n.text.length, n.code).toBeLessThanOrEqual(120);
      expect(n.sourceCodes.length, n.code).toBeGreaterThan(0);
      for (const c of n.sourceCodes) expect(known.has(c), `${n.code} ${c}`).toBe(true);
    }
    const long: Json = clone(realJson);
    long.routeNotes[0].text = "x".repeat(121);
    expect(() => parseModesSeed(long)).toThrow(/routeNotes/);
  });

  it("owner-only notes carry owner_report_unverified, and owner evidence cites U02", () => {
    for (const n of real.routeNotes) {
      if (n.sourceCodes.every((c) => /^U[0-9]{2}$/.test(c))) expect(n.evidence, n.code).toBe("owner_report_unverified");
      if (n.evidence === "owner_report_unverified") expect(n.sourceCodes, n.code).toContain("U02");
    }
    expect(violations((j) => { j.routeNotes[2].evidence = "official"; })).toMatch(/RN03: cites only owner reports/);
    expect(violations((j) => { j.routeNotes[3].sourceCodes = ["RL15"]; })).toMatch(/RN04: owner_report_unverified evidence needs a U source/);
    expect(violations((j) => { j.routeNotes[0].routeCodes = ["R9"]; })).toMatch(/RN01: unknown route R9/);
  });
});

describe("loop re-verification (loops-and-routes-2026-10.md A1)", () => {
  // Ord 2025-070 sequences as quoted in the research ("back to" is a reading aid, not a street).
  const A1: Record<string, string> = {
    "R8-A": "Gen. Luna St, P. Burgos St, Peñafrancia Ave, Magsaysay Ave, Taal Ave, J. Miranda Ave, Leon SA Aureus St / Mayflower St, back to Magsaysay Ave, Roxas Ave, Bicol Central Station, back to Roxas Ave, Fraternidad St, Biak na Bato St, Gen. Luna St",
    "R8-B": "Gen. Luna St, Biak na Bato St, Fraternidad St, Roxas Ave, Bicol Central Station, back to Roxas Ave, Magsaysay Ave, Leon SA Aureus St / Mayflower St, J. Miranda Ave, Taal Ave, back to Magsaysay Ave, Peñafrancia Ave, P. Burgos St, Gen. Luna St",
    "R8-C": "Gen. Luna St, P. Burgos St, Peñafrancia Ave, Diaz St, Elias Angeles St, Bagumbayan Sur Road, M.T. Villanueva Ave, Magsaysay Ave, Roxas Ave, Fraternidad St, Biak na Bato St, Gen. Luna St",
    "R8-D": "Gen. Luna St, Biak na Bato St, Fraternidad St, Roxas Ave, Magsaysay Ave, M.T. Villanueva Ave, Bagumbayan Road, Elias Angeles St, Caceres St, Gen. Luna St",
  };
  const norm = (s: string) => s.replace(/^back to /, "").replace(/ Road$/, " Rd");

  it("the seed street lists of R8-A..D equal the Ord 2025-070 sequences", () => {
    for (const [code, text] of Object.entries(A1)) {
      const route = legacy.routes.find((r) => r.publicCode === code)!;
      expect(route.legalStreets.circuit, code).toEqual(text.split(", ").map(norm));
    }
  });

  it("the C/D J. Miranda conflict is in the conflicts register", () => {
    const cx = real.conflicts.find((c) => /J\. Miranda/.test(c.topic))!;
    expect(cx).toMatchObject({ code: "CX10", source_codes: ["RL01", "RL03"] });
    expect(cx.refs).toEqual(expect.arrayContaining(["R8-C", "R8-D"]));
  });

  it("header pins the LF-normalised road snapshot it was reviewed against", () => {
    const f = "data/source/osm/naga-roads-2026-10-16.osm.json";
    const lf = createHash("sha256").update(readFileSync(f, "utf8").replace(/\r\n/g, "\n")).digest("hex");
    expect(real.header.preparedFrom).toContain(`${f}@sha256:${lf}`);
  });
});
