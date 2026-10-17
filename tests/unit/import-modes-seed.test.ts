import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ETA_PARAM_KEYS,
  importableRecords,
  parseModesSeed,
  validateModesSeed,
  type ModesSeed,
  type ModesSeedContext,
} from "@/domain/import/modes-seed";
import { normalizeSeed } from "@/domain/import/seed";
import { isInsideNaga } from "@/domain/geo/naga";

const REAL_PATH = "data/source/research/naga-modes-seed-2026-10-16.json";
const realJson: unknown = JSON.parse(readFileSync(REAL_PATH, "utf8"));
const syntheticJson: unknown = JSON.parse(readFileSync("tests/fixtures/modes/modes-seed-synthetic.json", "utf8"));
const legacy = normalizeSeed(JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8")));

const ctx: ModesSeedContext = {
  externalSourceCodes: legacy.sources.map((s) => s.code),
  existingRouteCodes: legacy.routes.map((r) => r.publicCode),
  existingTerminalCodes: legacy.terminals.map((t) => t.code),
  existingFareRules: legacy.fareRules,
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const real: ModesSeed = parseModesSeed(realJson);

describe("parseModesSeed schema", () => {
  it("accepts the real reviewed file and the synthetic fixture", () => {
    expect(() => parseModesSeed(realJson)).not.toThrow();
    expect(() => parseModesSeed(syntheticJson)).not.toThrow();
  });

  it("rejects unknown keys at the top level and inside records", () => {
    const top: Json = clone(realJson);
    top.extra = 1;
    expect(() => parseModesSeed(top)).toThrow(/Modes seed/);
    const coop: Json = clone(realJson);
    coop.cooperatives[0].chair = "Someone";
    expect(() => parseModesSeed(coop)).toThrow(/cooperatives\.0/);
    const addr: Json = clone(realJson);
    addr.cooperatives[0].address = "Somewhere";
    expect(() => parseModesSeed(addr)).toThrow();
  });

  it("requires a review on every record", () => {
    const j: Json = clone(realJson);
    delete j.terminals[0].review;
    expect(() => parseModesSeed(j)).toThrow(/terminals\.0\.review/);
  });

  it("refuses a coordinate without its OSM object", () => {
    const j: Json = clone(realJson);
    const t = j.terminals.find((x: Json) => x.coordinate !== null);
    delete t.coordinate.osm_id;
    expect(() => parseModesSeed(j)).toThrow();
  });
});

describe("validateModesSeed on the real file", () => {
  it("has no violations", () => {
    expect(validateModesSeed(real, ctx)).toEqual([]);
  });

  it("the synthetic fixture is flagged and valid against its own sources", () => {
    const s = parseModesSeed(syntheticJson);
    expect(s.header.synthetic).toBe(true);
    expect(validateModesSeed(s, { ...ctx, externalSourceCodes: [], existingRouteCodes: ["R1"], existingTerminalCodes: [] })).toEqual([]);
  });
});

describe("rules", () => {
  const violations = (mutate: (j: Json) => void, c: ModesSeedContext = ctx) => {
    const j: Json = clone(realJson);
    mutate(j);
    return validateModesSeed(parseModesSeed(j), c);
  };
  const fleetTemplate = (j: Json) => j.fleet.find((f: Json) => f.route_code === "R4" && f.vehicle_class === "modern_puj");

  it("rejects an e_jeepney fleet record on an R-route (C5, user decision)", () => {
    const v = violations((j) => {
      j.fleet.push({ ...clone(fleetTemplate(j)), code: "FL-R6-EJ", route_code: "R6", vehicle_class: "e_jeepney" });
    });
    expect(v.join("\n")).toMatch(/FL-R6-EJ.*e_jeepney/);
  });

  it("reported_not_confirmed exactly when the evidence is secondary or user-only", () => {
    const secondaryReported = violations((j) => {
      j.fleet.push({
        ...clone(fleetTemplate(j)), code: "FL-R6-MOD", route_code: "R6",
        evidence_levels: ["secondary_claim"], status: "reported", source_codes: ["N20"],
      });
    });
    expect(secondaryReported.join("\n")).toMatch(/FL-R6-MOD.*reported_not_confirmed/);
    const newsNotConfirmed = violations((j) => {
      const f = fleetTemplate(j);
      f.evidence_levels = ["news_report"];
      f.status = "reported_not_confirmed";
    });
    expect(newsNotConfirmed.join("\n")).toMatch(/reported_not_confirmed/);
    const userOnly = violations((j) => {
      j.fleet.push({
        ...clone(fleetTemplate(j)), code: "FL-R6-USER", route_code: "R6",
        evidence_levels: ["user_report"], status: "reported_not_confirmed", source_codes: ["U01"],
      });
    });
    expect(userOnly).toEqual([]);
  });

  it("operating requires an owner confirmation; planned is legal plan only", () => {
    expect(violations((j) => {
      const f = fleetTemplate(j);
      f.evidence_levels = ["news_report"];
    }).join("\n")).toMatch(/operating/);
    expect(violations((j) => {
      const f = j.fleet.find((x: Json) => x.status === "planned");
      f.evidence_levels = ["legal_plan", "news_report"];
    }).join("\n")).toMatch(/planned/);
  });

  it("every source code exists in sources (or the Data_Sets seed)", () => {
    const v = violations((j) => {
      j.terminals[0].source_codes.push("N99");
    });
    expect(v.join("\n")).toMatch(/N99/);
    // S-codes resolve only through the context
    expect(validateModesSeed(real, { ...ctx, externalSourceCodes: [] }).join("\n")).toMatch(/S09/);
  });

  it("an imported record may not cite an excluded source", () => {
    const v = violations((j) => {
      const n = j.sources.find((s: Json) => s.code === "N38");
      n.review = { decision: "exclude", reason: "test", reviewedOn: "2026-10-16" };
    });
    expect(v.join("\n")).toMatch(/N38/);
  });

  it("terminal coordinates must be inside Naga", () => {
    const v = violations((j) => {
      const t = j.terminals.find((x: Json) => x.coordinate !== null);
      t.coordinate.lat = 14.5995;
      t.coordinate.lng = 120.9842;
    });
    expect(v.join("\n")).toMatch(/outside Naga/);
  });

  it("F01/F02 must equal the national 28 Sep 2026 rates (J7); a tampered seed fails", () => {
    const tampered = ctx.existingFareRules.map((f) =>
      f.code === "F02" ? { ...f, incrementCentavosPerKm: 250 } : f,
    );
    const v = validateModesSeed(real, { ...ctx, existingFareRules: tampered });
    expect(v.join("\n")).toMatch(/F02/);
    const base = ctx.existingFareRules.map((f) => (f.code === "F01" ? { ...f, baseCentavos: 1300 } : f));
    expect(validateModesSeed(real, { ...ctx, existingFareRules: base }).join("\n")).toMatch(/F01/);
  });

  it("A1–A3: an assumption carries an assumption_note; a non-assumption carries sources", () => {
    expect(violations((j) => {
      const p = j.etaParams.find((x: Json) => x.key === "walk_slowdown_factor");
      p.assumption_note = null;
    }).join("\n")).toMatch(/walk_slowdown_factor/);
    expect(violations((j) => {
      const p = j.etaParams.find((x: Json) => x.key === "walk_slowdown_factor");
      p.is_assumption = false;
    }).join("\n")).toMatch(/walk_slowdown_factor/);
  });

  it("all five time-estimate keys are imported exactly once", () => {
    expect(violations((j) => {
      j.etaParams = j.etaParams.filter((x: Json) => x.key !== "peak_windows");
    }).join("\n")).toMatch(/peak_windows/);
  });

  it("a fare observation needs a matching fleet class and a consistent delta", () => {
    expect(violations((j) => {
      j.fareObservations[0].route_code = "R6";
    }).join("\n")).toMatch(/FO-R4-MOD.*R6 modern_puj/);
    expect(violations((j) => {
      j.fareObservations[1].delta_centavos_high = 800;
    }).join("\n")).toMatch(/FO-R7-MOD/);
    expect(violations((j) => {
      j.fareObservations[0].delta_centavos_low = 900;
    }).join("\n")).toMatch(/FO-R4-MOD/);
  });

  it("aircon is stated only with sources", () => {
    expect(violations((j) => {
      fleetTemplate(j).aircon_source_codes = [];
    }).join("\n")).toMatch(/FL-R4-MOD.*aircon/);
  });

  it("fare rules: unknown modes are refused by the schema; an imported rule needs effective_from", () => {
    for (const mode of ["e_jeepney", "ferry"]) {
      const j: Json = clone(realJson);
      j.fareRules[0].mode = mode;
      expect(() => parseModesSeed(j)).toThrow(/fareRules\.0\.mode/);
    }
    const ev: Json = clone(realJson);
    ev.fareRules[0].evidence_status = "made_up";
    expect(() => parseModesSeed(ev)).toThrow(/fareRules\.0\.evidence_status/);
    expect(violations((j) => {
      j.fareRules[0].effective_from = null;
    }).join("\n")).toMatch(/F06.*effective_from/);
    expect(violations((j) => {
      const fee = j.fareRules.find((f: Json) => f.mode === "terminal_dispatch_fee");
      fee.review = { decision: "import", reason: "test", reviewedOn: "2026-10-16" };
      fee.code = "F95";
    }).join("\n")).toMatch(/F95.*not a passenger fare/);
  });

  it("a regional service must point at an imported terminal", () => {
    expect(violations((j) => {
      j.regionalServices[0].terminal_code = "T99";
    }).join("\n")).toMatch(/T99/);
  });
});

describe("importableRecords", () => {
  it("never returns an excluded record", () => {
    const imp = importableRecords(real);
    for (const [key, list] of Object.entries(imp)) {
      if (!Array.isArray(list)) continue;
      for (const r of list as { review: { decision: string } }[]) {
        expect(r.review.decision, key).toBe("import");
      }
    }
    const excludedTerminals = real.terminals.filter((t) => t.review.decision === "exclude").map((t) => t.code);
    expect(excludedTerminals).toContain("CT-UV-SOUTHBOUND-OSM");
    expect(imp.terminals.map((t) => t.code)).not.toContain("CT-UV-SOUTHBOUND-OSM");
    expect(imp.cooperatives.some((c) => /MATCo/.test(c.name))).toBe(false);
    expect(imp.etaParams.map((p) => p.key).sort()).toEqual([...ETA_PARAM_KEYS].sort());
    expect(imp.fareRules.some((f) => /REGIONAL|FEE/.test(f.code))).toBe(false);
  });
});

describe("real file content", () => {
  const imp = importableRecords(real);

  it("has 16 terminals T01–T16, coordinates inside Naga with OSM provenance", () => {
    expect(imp.terminals.map((t) => t.code)).toEqual(
      Array.from({ length: 16 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`),
    );
    for (const t of imp.terminals) {
      if (t.coordinate === null) continue;
      expect(isInsideNaga(t.coordinate), t.code).toBe(true);
      expect(t.coordinate.osm_id, t.code).toBeGreaterThan(0);
      expect(t.coordinate.osm_version, t.code).toBeGreaterThan(0);
    }
    const noCoord = imp.terminals.filter((t) => t.coordinate === null).map((t) => t.code);
    expect(noCoord).toEqual(["T02", "T05", "T15", "T16"]);
    const t01 = imp.terminals.find((t) => t.code === "T01")!;
    expect(t01.coordinate).toMatchObject({ osm_type: "way", osm_id: 293702439, coord_source: "osm_way_centroid" });
    expect(t01.mode_sources.bus).toEqual(["S09", "N02"]);
  });

  it("has the two tricycle feeder routes and no e-jeepney route (user decision)", () => {
    expect(imp.routes.map((r) => r.code)).toEqual(["TRI-VISTODA", "TRI-DECALANGON"]);
    expect(real.routes.some((r) => /EJ/.test(r.code))).toBe(false);
    expect(JSON.stringify(real.fleet)).not.toMatch(/e_jeepney/);
    const v = imp.routes.find((r) => r.code === "TRI-VISTODA")!;
    expect(v.allocated_units).toBe(33);
    expect(v.variants.map((x) => x.name)).toEqual([
      "Langon – Ateneo de Naga via Vistansa Subd",
      "Langon – Centro Cararayan (San Miguel St / Tecla San Andres-Ziga Rd corner) via Sitio Salunguigui",
    ]);
    expect(v.restrictions).toContain("No entry to Tecla San Andres-Ziga Rd");
  });

  it("modern jeepneys operate on R4 and R7 only; traditional operates on every LPTRP route", () => {
    const modern = imp.fleet.filter((f) => f.vehicle_class === "modern_puj");
    expect(modern.map((f) => f.route_code).sort()).toEqual(["R4", "R7"]);
    for (const f of modern) {
      expect(f.status).toBe("operating");
      expect(f.source_codes).toContain("U01");
    }
    expect(modern.find((f) => f.route_code === "R4")!.source_codes).toEqual(
      expect.arrayContaining(["N14", "N38", "N39", "N41", "U01"]),
    );
    const traditional = imp.fleet.filter((f) => f.vehicle_class === "traditional_puj");
    expect(traditional.map((f) => f.route_code).sort()).toEqual([...ctx.existingRouteCodes].sort());
    expect(traditional.every((f) => f.status === "operating")).toBe(true);
    expect(imp.fleet.some((f) => f.status === "reported_not_confirmed")).toBe(false);
  });

  it("route service updates mark every LPTRP route operating (owner-confirmed), service only", () => {
    expect(imp.routeStatusUpdates.map((u) => u.route_code).sort()).toEqual([...ctx.existingRouteCodes].sort());
    for (const u of imp.routeStatusUpdates) {
      expect(u.operating_status).toBe("operating");
      expect(u.status_note).toMatch(/stop/);
    }
  });

  it("keeps no chair names or addresses anywhere", () => {
    // sha256 of the lower-cased name and registry-address tokens from the research register (C8);
    // the tokens themselves are never committed.
    const forbidden = new Set([
      "eeaf0bb1f9974c046b625191f6c600b333b28bae12c169a5f7b39832ae039c13",
      "e8dd2bc632aac084b29c50ca18d20d057d82088ab07e77c140a76a5842f82e52",
      "10efcf799a6b45fa3154379fb53e9d6a164ca72153a238b9ec664f6ac061e9f8",
      "1579a6e3112caba1b6031ef7c507f3014d7b0a408fefd1b4d4a2c8c32d2274ff",
      "2b559e6fba6e8c0c77239f473850a0572cc60944757a09b5de12371f5213ed0e",
      "c9776e74f0fa662149b4ddf545ca4d10ff7e5b52bb5a854f0881a40161efe742",
      "a106021309bd39fe15410b4cfbfae60e136081e8b10ed8a67b28cabc64c08859",
      "b16c59c43041ccd95c5aa7f9143d68e140f4210db2ec6f7e1673777dc15f2ec8",
      "151e9009f577496d21dfbb428ec4417f67793d480fdbccf130f63e1649504e0f",
      "19bfa158a75d060b8d3749532a9a715ce187aa65b16e436f24379049f919d22c",
      "da9f6713671da24a575ffbe6f0749ecb613efe7f3887b5c9f3e6cc8a94982ae9",
      "17c225852f2b62112b17f6d13b8dfee886d7ec07a290698726206d09c12b1a39",
      "1934d2caba2b323a4dd6b04ad12c24b10e42936620d2e17622b4b6c61bf8328d",
      "3ab69804b338e958e14f37b1fbff271a14bbe83ff4a0f0d2dcbf11b4b4c97c9b",
      "d5ff1cfbc39c93f357b6581ba91e0b8d0a638608663f460ed2a9c7e01e6d2563",
      "64f6b32668c3fec9f04584e62b610e129c6f34ba40ffea54fa7a26dab04188e4",
    ]);
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    for (const file of [REAL_PATH, "tests/fixtures/modes/modes-seed-synthetic.json", "data/source/research/README.md"]) {
      const tokens = new Set(readFileSync(file, "utf8").toLowerCase().split(/[^a-z0-9-]+/));
      const hits = [...tokens].filter((t) => forbidden.has(hash(t)));
      expect(hits.length, file).toBe(0);
    }
  });

  it("header pins LF-normalised sha256 of each committed input", () => {
    const lf = (f: string) => createHash("sha256").update(readFileSync(f, "utf8").replace(/\r\n/g, "\n")).digest("hex");
    for (const f of ["Data_Sets/naga_transport_seed.json", "data/source/osm/naga-places-2026-10-15.osm.json"]) {
      expect(real.header.preparedFrom).toContain(`${f}@sha256:${lf(f)}`);
    }
  });

  it("modern units on R4 and R7 are air-conditioned (U01; N14 for R4)", () => {
    const r4 = imp.fleet.find((f) => f.code === "FL-R4-MOD")!;
    const r7 = imp.fleet.find((f) => f.code === "FL-R7-MOD")!;
    expect(r4).toMatchObject({ aircon: true, aircon_source_codes: ["N14", "U01"] });
    expect(r7).toMatchObject({ aircon: true, aircon_source_codes: ["U01"] });
    expect(imp.fleet.filter((f) => f.vehicle_class === "traditional_puj").every((f) => f.aircon === null)).toBe(true);
  });

  it("modern fare reports are observations against the modern class, never rules", () => {
    expect(imp.fareObservations).toEqual([
      expect.objectContaining({ route_code: "R4", vehicle_class: "modern_puj", kind: "reported_practice", delta_qualifier: "range", delta_centavos_low: 300, delta_centavos_high: 500, source_codes: ["U01"] }),
      expect.objectContaining({ route_code: "R7", vehicle_class: "modern_puj", kind: "reported_practice", delta_qualifier: "at_least", delta_centavos_low: 500, delta_centavos_high: null, source_codes: ["U01"] }),
    ]);
    expect(imp.fareRules.map((f) => f.code)).toEqual(["F06", "F07", "F08", "F09", "F10", "F11", "F12"]);
  });

  it("e-jeepney source N09 is excluded", () => {
    expect(real.sources.find((s) => s.code === "N09")!.review.decision).toBe("exclude");
    expect(real.sources.find((s) => s.code === "U01")!.type).toBe("owner_confirmation");
  });
});

describe("research sources RT/RL/RP/RH and owner report U02 (2026-10-17)", () => {
  const research = real.sources.filter((s) => /^R[TLPH][0-9]{2}$/.test(s.code));

  it("has one record per candidate: 24 tricycle candidates + 8 TODA ordinances (RT25-RT32), 19 loops, 22 padyak, 21 jeepney-hours", () => {
    const count = (p: string) => research.filter((s) => s.code.startsWith(p)).length;
    expect({ RT: count("RT"), RL: count("RL"), RP: count("RP"), RH: count("RH") }).toEqual({ RT: 32, RL: 19, RP: 22, RH: 21 });
  });

  it("every new code is unique and matches the R-prefixed pattern; the parser refuses other R codes", () => {
    const codes = research.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^R[TLPH][0-9]{2}$/.test(c))).toBe(true);
    const bad = clone(realJson) as Json;
    bad.sources.find((s: Json) => s.code === "RT01").code = "RX01";
    expect(() => parseModesSeed(bad)).toThrow();
  });

  it("U02 is the owner report with the exact plan title, imported as user_report_unverified", () => {
    const u02 = real.sources.find((s) => s.code === "U02")!;
    expect(u02.type).toBe("user_report_unverified");
    expect(u02.title).toBe("Project owner report to ParaNaga, 2026-10-17: request reroutes on loops; 'Francia' signboard; padyak in Abella, Sabang, Sta. Cruz, Igualdad; some jeepneys start about 5 am or before");
    expect(u02.review.decision).toBe("import");
  });

  it("RT25-RT32 are the TODA ordinances, official, imported, each with an ordinance URL on www2.naga.gov.ph", () => {
    const toda = real.sources.filter((s) => /^RT(2[5-9]|3[0-2])$/.test(s.code));
    expect(toda.map((s) => s.code)).toEqual(["RT25", "RT26", "RT27", "RT28", "RT29", "RT30", "RT31", "RT32"]);
    expect(toda.map((s) => s.title.match(/\d{4}-\d{3}/)![0])).toEqual(["1998-103", "1998-107", "1999-046", "2001-047", "2004-008", "2009-073", "2018-079", "2020-052"]);
    for (const s of toda) {
      expect(s.type).toBe("official");
      expect(s.url).toMatch(/^https:\/\/www2\.naga\.gov\.ph\/(prev-ordinance|sp_ordinances)\/ordinance-no-\d{4}-\d{3}\/$/);
      expect(s.review.decision).toBe("import");
    }
  });

  it("U03 is the 2026-10-18 owner report (far areas, TODAs), unverified, and RN04 cites it as owner_report_unverified", () => {
    const u03 = real.sources.find((s) => s.code === "U03")!;
    expect(u03.type).toBe("user_report_unverified");
    expect(u03.url).toBeNull();
    expect(u03.title).toBe("Project owner report to ParaNaga, 2026-10-18: far areas (Cararayan, Pacol, Panicuason) tricycles charge special trips; Balatas to Cararayan tricycle terminal; Del Rosario vias (Panganiban, Diversion, Magsaysay-Francia); Ateneo and jeepney-terminal TODAs");
    expect(u03.review.decision).toBe("import");
    const rn04 = real.routeNotes.find((n) => n.code === "RN04")!;
    expect(rn04).toMatchObject({ routeCodes: ["R2"], evidence: "owner_report_unverified" });
    expect(rn04.sourceCodes).toContain("U03");
  });

  it("sources the research marks not used are excluded with a reason (P22, H16, H17)", () => {
    const excluded = research.filter((s) => s.review.decision === "exclude").map((s) => s.code).sort();
    expect(excluded).toEqual(["RH16", "RH17", "RP22"]);
    for (const s of research.filter((x) => x.review.decision === "exclude")) expect(s.review.reason).toMatch(/not used/);
  });

  it("keeps no private individual's name from the research (hashed tokens, as for chair names)", () => {
    const forbidden = new Set([
      "87afeaec6cb1e23ad5e6ff51f919ef108db191154f9a05738134685cd58652cc", // josiah
      "4ee3679892e6ac5a5b513eba7fd529d363d7a96508421c5dbd44b01b349cf514", // antonio
      "6b70e2d592dd17196b7940574ee89f31c354435338179245457ad54064ba7f77", // drei
      "74a2a3d228c40bb43ced9e4854b97d78ccb0dbac1ea94ecded7e548f0723eab7", // laurel
      "f11d1d57230f4a05280dbef76e5b96170f4f5b80c112df9786b3dc994dd2afbb", // gumba
      "f25772b747d11e686c8c1f5c74468ae1cee22ae8c54ba8b22d2346925f82a60b", // kyna
      "df835dcf8d6c492c3d340604b9e58d8603d98cd5f90e754a3a85cf174488e17d", // castro
      "9b36b2dfb7c5090ae999e275b48f32ac10970f89b0d8a37d9bc2d57627dc89c4", // kruseman
      "dc960fe73c59d30e68a354db0180bfabf8a089b69de12cd39972c52578690c89", // bernadas
      "07473a4253fa248590947c91a9e008b5dff1b3a397f7d8f9c613394bf3f77665", // keren
    ]);
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const tokens = new Set(readFileSync(REAL_PATH, "utf8").toLowerCase().split(/[^a-z0-9-]+/));
    expect([...tokens].filter((t) => forbidden.has(hash(t)))).toEqual([]);
  });
});
