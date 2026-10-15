// One-off: drafts data/source/research/naga-modes-seed-2026-10-16.json.
//
//   pnpm exec tsx scripts/draft-modes-seed.ts [--out <path>]
//
// Inputs (read only, local files; no network):
//   - .superpowers/research/naga-transport-candidates-2026-10.json (research register; not in git,
//     so this script only runs on the machine that holds it. The app and the importer never read it.)
//   - Data_Sets/naga_transport_seed.json (existing T01–T06, F01–F03, R1–R8-D)
//   - data/source/osm/naga-places-2026-10-15.osm.json (OSM type/id/version/timestamp/coordinates)
//
// Sources are copied verbatim from the register. Every other record below is a reviewed value: the
// review decision and its reason are written next to the data, following the plan's Task 1 brief
// and the user decisions of 2026-10-16 (e-jeepney dropped; modern jeepneys operating on R4 and R7,
// owner confirmation U01; traditional operating on every LPTRP route, service only).
// Nothing is invented: a value with no source is either an explicit assumption (A1–A3) or absent.
// The output is checked with parseModesSeed + validateModesSeed before it is written.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseModesSeed,
  validateModesSeed,
  type ModesSeed,
  type FARE_EVIDENCE_STATUSES,
  type FARE_MODES,
} from "../src/domain/import/modes-seed";
import { normalizeSeed } from "../src/domain/import/seed";

type FareMode = (typeof FARE_MODES)[number];
type FareEvidence = (typeof FARE_EVIDENCE_STATUSES)[number];

const RESEARCH = ".superpowers/research/naga-transport-candidates-2026-10.json";
const LEGACY = "Data_Sets/naga_transport_seed.json";
const PLACES = "data/source/osm/naga-places-2026-10-15.osm.json";
const DEFAULT_OUT = "data/source/research/naga-modes-seed-2026-10-16.json";
const REVIEWED_ON = "2026-10-16";
const JEV_MODEL = "typesafe/jev-1.13-20260917";

/** sha256 of the LF-normalised text, so the pin is the same on every checkout (autocrlf). */
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
const ok = (reason: string) => ({ decision: "import" as const, reason, reviewedOn: REVIEWED_ON });
const no = (reason: string) => ({ decision: "exclude" as const, reason, reviewedOn: REVIEWED_ON });

type ResearchSource = {
  id: string; title: string; url?: string; url2?: string; url3?: string; publisher: string; date: string;
  type: string; licence?: string; retrieved: string; jev?: unknown; jev_claim?: string;
};
type ResearchTerminal = { id: string; lat: number | null; lng: number | null; coord_source: string | null };
type OsmElement = {
  type: "node" | "way"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number };
  version: number; timestamp: string;
};

/**
 * Four terminal objects are not in the places snapshot (their tags are outside its categories).
 * Their version and timestamp were read once from the OSM API 0.6 (api.openstreetmap.org, element
 * JSON, 2026-10-16; only these fields were kept). Every timestamp is before the research query's
 * osm_base (2026-10-15T20:42Z, N02), so the research coordinate belongs to this same version.
 * Node coordinates are the API values; the PNR way centroid is the Overpass `center` from N02.
 */
const OSM_API_READ: Record<string, { version: number; timestamp: string; lat: number; lng: number }> = {
  "node/4545730692": { version: 2, timestamp: "2017-08-29T18:32:16Z", lat: 13.6180598, lng: 123.1831728 },
  "node/4850021530": { version: 6, timestamp: "2026-04-06T08:09:36Z", lat: 13.623659, lng: 123.1847492 },
  "node/14053567159": { version: 1, timestamp: "2026-07-27T10:52:44Z", lat: 13.6318672, lng: 123.1973306 },
  "way/23662289": { version: 7, timestamp: "2026-03-30T17:55:06Z", lat: 13.619618, lng: 123.185879 },
};
const API_READ_FROM =
  "OSM API 0.6 element read 2026-10-16 (version, timestamp); timestamp precedes N02 osm_base 2026-10-15T20:42Z";

function main(): number {
  const outArg = process.argv.indexOf("--out");
  const out = outArg > 0 ? process.argv[outArg + 1]! : DEFAULT_OUT;
  if (!existsSync(RESEARCH)) {
    console.error(`${RESEARCH} is missing: this one-off script needs the research register.`);
    return 1;
  }
  const research = JSON.parse(readFileSync(RESEARCH, "utf8")) as { sources: ResearchSource[]; terminals: ResearchTerminal[] };
  const legacy = normalizeSeed(JSON.parse(readFileSync(LEGACY, "utf8")));
  const places = JSON.parse(readFileSync(PLACES, "utf8")) as { response: { elements: OsmElement[] } };
  const byKey = new Map(places.response.elements.map((e) => [`${e.type}/${e.id}`, e]));
  const researchByOsm = new Map(research.terminals.filter((t) => t.coord_source).map((t) => [t.coord_source!.replace("OSM ", ""), t]));

  /** OSM coordinate with provenance; cross-checked against the research register (≤ 1e-6°). */
  const osm = (key: string, coordNote: string | null) => {
    const [type, id] = key.split("/") as ["node" | "way", string];
    const snap = byKey.get(key);
    const api = OSM_API_READ[key];
    let c: { lat: number; lng: number; version: number; timestamp: string; readFrom: string };
    if (snap) {
      const p = snap.center ?? { lat: snap.lat!, lon: snap.lon! };
      c = { lat: p.lat, lng: p.lon, version: snap.version, timestamp: snap.timestamp, readFrom: `${PLACES} (OSM-2026-10-15)` };
    } else if (api) {
      c = { ...api, readFrom: type === "way" ? `N02 Overpass center; ${API_READ_FROM}` : API_READ_FROM };
    } else throw new Error(`${key}: no OSM record on file`);
    const r = researchByOsm.get(key);
    if (!r || r.lat === null || r.lng === null) throw new Error(`${key}: not in the research register`);
    if (Math.abs(r.lat - c.lat) > 1e-6 || Math.abs(r.lng - c.lng) > 1e-6) throw new Error(`${key}: coordinate differs from research`);
    return {
      lat: c.lat, lng: c.lng,
      coord_source: type === "way" ? ("osm_way_centroid" as const) : ("osm_node" as const),
      osm_type: type, osm_id: Number(id), osm_version: c.version, osm_timestamp: c.timestamp,
      read_from: c.readFrom, coord_note: coordNote,
    };
  };
  const legacyTerminal = (code: string) => {
    const t = legacy.terminals.find((x) => x.code === code);
    if (!t) throw new Error(`${code} missing from ${LEGACY}`);
    return t;
  };

  // ------------------------------------------------------------ sources (verbatim)
  const sources: ModesSeed["sources"] = research.sources.map((s) => ({
    code: s.id,
    title: s.title,
    url: s.url ?? null,
    extra_urls: [s.url2, s.url3].filter((u): u is string => typeof u === "string"),
    publisher: s.publisher,
    date: s.date,
    type: s.type,
    licence: s.licence ?? null,
    retrieved: s.retrieved,
    properties: { jev: s.jev ?? null, jev_claim: s.jev_claim ?? null },
    review: s.id === "N09"
      ? no("E-jeepney dropped by user decision 2026-10-16: the 2017 route is not imported, so its only source is not either")
      : ok("Verbatim from the research register; Jev scores kept as provenance only"),
  }));
  sources.push({
    code: "U01",
    title: "Project owner confirmation to ParaNaga (2026-10-16): traditional jeepneys operate on every LPTRP route (R1–R8); air-conditioned modern jeepneys operate on R4 and R7; riders pay about P3–P5 more on R4 modern and at least P5 more on R7 modern than the traditional fare",
    url: null,
    extra_urls: [],
    publisher: "ParaNaga project owner",
    date: "2026-10-16",
    type: "owner_confirmation",
    licence: null,
    retrieved: "2026-10-16",
    properties: { scope: "Confirms service only; not stop locations, stop order or paths" },
    review: ok("User decision 2026-10-16 (D2 as amended)"),
  });

  // ------------------------------------------------------------ terminals (D17)
  const t01 = legacyTerminal("T01");
  const t02 = legacyTerminal("T02");
  const t03 = legacyTerminal("T03");
  const t04 = legacyTerminal("T04");
  const t05 = legacyTerminal("T05");
  const t06 = legacyTerminal("T06");
  const centroid = "centroid, not an entrance";
  const terminals: ModesSeed["terminals"] = [
    {
      code: "T01", name: t01.name, kind: "terminal", location_text: t01.locationText,
      modes: ["bus", "uv_express"], modes_raw: [...t01.modes, "uv_express"],
      mode_sources: { bus: ["S09", "N02"], uv_express: ["N01"] },
      coordinate: osm("way/293702439", centroid),
      verification: "community_coordinate_official_address",
      status_note: "UV Express mode from community-mapped OSM route tags (Tabaco UV); confirm",
      notes: t01.notes, source_codes: ["S09", "N02", "N01"],
      review: ok("Brief T01: BCS way centroid; bus [S09, N02], uv_express [N01, community]"),
    },
    {
      code: "T02", name: t02.name, kind: "terminal", location_text: t02.locationText,
      modes: ["jeepney", "uv_express"], modes_raw: t02.modes,
      mode_sources: { jeepney: ["S03", "N12"], uv_express: ["N12"] },
      coordinate: null,
      verification: "official_location_text_conflicting_street",
      status_note: "Street conflicts: Anciano St vs Waling-Waling St",
      notes: t02.notes, source_codes: ["S03", "S12", "N12", "N30", "N19"],
      review: ok("Brief T02: no sourced coordinate (not in OSM); street conflict recorded"),
    },
    {
      code: "T03", name: t03.name, kind: "terminal", location_text: t03.locationText,
      modes: ["jeepney", "uv_express"], modes_raw: t03.modes,
      mode_sources: { jeepney: ["S10", "N31"], uv_express: ["S10", "N31", "N19"] },
      coordinate: osm("way/23670386", centroid),
      verification: "community_coordinate_official_historical_franchise",
      status_note: "franchise to about July 2025; renewal not found",
      notes: t03.notes, source_codes: ["S10", "N02", "N31", "N19"],
      review: ok("Brief T03: LCC way centroid"),
    },
    {
      code: "T04", name: t04.name, kind: "terminal", location_text: t04.locationText,
      modes: ["jeepney", "uv_express"], modes_raw: t04.modes,
      mode_sources: { jeepney: ["S11", "N31"], uv_express: ["S11", "N31"] },
      coordinate: osm("node/4545731100", null),
      verification: "community_coordinate_official_historical_franchise",
      status_note: "franchise (Ordinance 2016-034) was for 3 years; current franchise not found",
      notes: t04.notes, source_codes: ["S11", "S12", "N02", "N31"],
      review: ok("Brief T04: node 4545731100"),
    },
    {
      code: "T05", name: t05.name, kind: "loading_point", location_text: t05.locationText,
      modes: ["jeepney"], modes_raw: t05.modes, mode_sources: { jeepney: ["S01"] },
      coordinate: null, verification: t05.evidenceStatus ?? "official_street_structure",
      status_note: null, notes: t05.notes, source_codes: t05.sourceCodes,
      review: ok("Brief T05: unchanged from Data_Sets"),
    },
    {
      code: "T06", name: t06.name, kind: "station", location_text: t06.locationText,
      modes: ["rail"], modes_raw: t06.modes, mode_sources: { rail: ["S19", "S21", "N21"] },
      coordinate: osm("way/23662289", "building centroid, not an entrance"),
      verification: "community_coordinate",
      status_note: "Naga–Legazpi reported suspended; Naga–Lupi Viejo reported running (fan site, 15 Oct 2026) · confirm with PNR",
      notes: t06.notes, source_codes: ["S19", "S21", "N02", "N21"],
      review: ok("Brief T06: PNR way centroid"),
    },
    {
      code: "T07", name: "Eaglestar Naga Terminal", kind: "terminal", location_text: "OSM node south of CBD",
      modes: ["bus"], modes_raw: ["bus"], mode_sources: { bus: ["N02"] },
      coordinate: osm("node/5947830172", null), verification: "community_only",
      status_note: "OSM 2020 edit; operation unverified", notes: "Private bus terminal.", source_codes: ["N02"],
      review: ok("Brief T07"),
    },
    {
      code: "T08", name: "Milaor Jeepney Terminal", kind: "terminal", location_text: "OSM bus_stop node",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02"] },
      coordinate: osm("node/4545730692", null), verification: "community_only",
      status_note: null, notes: null, source_codes: ["N02"],
      review: ok("Brief T08"),
    },
    {
      code: "T09", name: "Jeepney station to Concepcion and Del Rosario", kind: "loading_point", location_text: "Dinaga St, Centro",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02", "N30"] },
      coordinate: osm("node/4850021524", null), verification: "community_coordinate_matches_LPTRP_street",
      status_note: null, notes: "Consistent with R4 using Dinaga St; curb side unverified.", source_codes: ["N02", "N30"],
      review: ok("Brief T09"),
    },
    {
      code: "T10", name: "Jeepney station to Pacol", kind: "loading_point", location_text: "Centro",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02"] },
      coordinate: osm("node/4850042233", null), verification: "community_only_old",
      status_note: null, notes: "OSM 2017 edit. Centro boarding point for R6 Pacol per OSM name (2017).", source_codes: ["N02"],
      review: ok("Brief T10"),
    },
    {
      code: "T11", name: "Jeepney station to Carolina and Panicuason", kind: "loading_point", location_text: "Centro",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02"] },
      coordinate: osm("node/4850021531", null), verification: "community_only_old",
      status_note: null, notes: "OSM 2017 edit. Centro boarding point for R7 Carolina/Panicuason per OSM name (2017).", source_codes: ["N02"],
      review: ok("Brief T11"),
    },
    {
      code: "T12", name: "Del Rosario → Centro jeepney station", kind: "loading_point", location_text: "Maharlika Hwy, Del Rosario",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02"] },
      coordinate: osm("node/5054596823", null), verification: "community_only",
      status_note: null, notes: "OSM 2019 edit. Boarding point toward Centro (via Panganiban, Magsaysay or Roxas) per OSM name.", source_codes: ["N02"],
      review: ok("Brief T12"),
    },
    {
      code: "T13", name: "Gen. Luna St at Plaza Rizal (PUJ platform)", kind: "loading_point", location_text: "Gen. Luna St",
      modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N02"] },
      coordinate: osm("node/4850021530", null), verification: "community_only",
      status_note: null, notes: "Tagged network=LTFRB Region V by the mapper; not an official LTFRB dataset.", source_codes: ["N02"],
      review: ok("Brief T13"),
    },
    {
      code: "T14", name: "Balatas Tricycle Terminal", kind: "terminal", location_text: "Balatas, near Magsaysay Ave/Balatas Rd",
      modes: ["tricycle"], modes_raw: ["tricycle"], mode_sources: { tricycle: ["N02"] },
      coordinate: osm("node/14053567159", null), verification: "community_only",
      status_note: null, notes: "OSM edit 2026-07-27.", source_codes: ["N02"],
      review: ok("Brief T14"),
    },
    {
      code: "T15", name: "Deca Vistansa special-trimobile waiting area", kind: "waiting_area", location_text: "Deca Vistansa, Pacol",
      modes: ["tricycle"], modes_raw: ["tricycle"], mode_sources: { tricycle: ["N06"] },
      coordinate: null, verification: "official_text_no_coordinate",
      status_note: null, notes: "Existing authorized waiting area (Ordinance 2025-067); no sourced coordinate.", source_codes: ["N06"],
      review: ok("Brief T15: no coordinate [N06]"),
    },
    {
      code: "T16", name: "Cararayan Proper special-trimobile waiting area", kind: "waiting_area", location_text: "Cararayan Proper",
      modes: ["tricycle"], modes_raw: ["tricycle"], mode_sources: { tricycle: ["N06"] },
      coordinate: null, verification: "official_text_no_coordinate",
      status_note: null, notes: "Existing authorized waiting area (Ordinance 2025-067); no sourced coordinate.", source_codes: ["N06"],
      review: ok("Brief T16: no coordinate [N06]"),
    },
    {
      code: "CT-UV-SOUTHBOUND-OSM", name: "'UV-Express Southbound Terminal' (OSM name)", kind: "terminal", location_text: "OSM node east of BCS",
      modes: ["uv_express"], modes_raw: ["uv_express"], mode_sources: { uv_express: ["N02"] },
      coordinate: osm("node/4545731190", null), verification: "community_only_conflict",
      status_note: null, notes: "Coordinate lies about 0.4 km east of BCS, not at the LCC/Sabang southbound site.", source_codes: ["N02", "N31"],
      review: no("OSM name conflicts with the official southbound site (LCC, Sabang); field-verify"),
    },
    {
      code: "CT-R4-CENTRO-LOAD", name: "R4 Centro loop (Arana St / J. Hernandez Ave / Caceres St / Dinaga St)", kind: "loading_point",
      location_text: "LPTRP R4 circuit through Centro", modes: ["jeepney"], modes_raw: ["jeepney"], mode_sources: { jeepney: ["N30"] },
      coordinate: null, verification: "official_route_text_no_stop", status_note: null,
      notes: "No designated stop list for R4 found.", source_codes: ["N30", "N14"],
      review: no("A route circuit, not a terminal; covered by T05 (Centro loading cluster) and T09"),
    },
  ];

  // ------------------------------------------------------------ routes (tricycle feeders only)
  const routes: ModesSeed["routes"] = [
    {
      code: "TRI-VISTODA",
      name: "VISTODA/LAVISTODA special trimobile (Langon – Ateneo de Naga; Langon – Centro Cararayan)",
      mode: "tricycle", service_status: "authorized_feeder", allocated_units: 33,
      operator_text: "VISTODA and LAVISTODA (consolidated)", enacted_on: "2025-09-09",
      restrictions: ["No entry to Tecla San Andres-Ziga Rd"],
      conflict_notes: [],
      notes: "Authorized by Ordinance 2025-067; daily operation not verified. Waiting areas: Deca Vistansa (T15) and Cararayan Proper (T16).",
      variants: [
        {
          direction: "branch",
          name: "Langon – Ateneo de Naga via Vistansa Subd",
          street_text: "Langon – Vistansa Subd – Ateneo de Naga",
          anchors: [
            { kind: "place_name", name: "Langon" },
            { kind: "place_name", name: "Vistansa" },
            { kind: "osm_places_snapshot", key: "osm:way/222268858" },
          ],
        },
        {
          direction: "branch",
          name: "Langon – Centro Cararayan (San Miguel St / Tecla San Andres-Ziga Rd corner) via Sitio Salunguigui",
          street_text: "Langon – Sitio Salunguigui – Centro Cararayan (corner of San Miguel St and Tecla San Andres-Ziga Rd)",
          anchors: [
            { kind: "place_name", name: "Langon" },
            { kind: "place_name", name: "Salunguigui" },
            { kind: "junction", streets: ["San Miguel St", "Tecla San Andres-Ziga Rd"] },
          ],
        },
      ],
      source_codes: ["N06"],
      review: ok("Brief: authorized feeder, 33 units [N06]; two branch variants"),
    },
    {
      code: "TRI-DECALANGON",
      name: "Special trimobile: Cararayan Rd corner (Langon) – Deca Vistansa via Salunguigui",
      mode: "tricycle", service_status: "authorized_feeder", allocated_units: 10,
      operator_text: null, enacted_on: "2025-03-18",
      restrictions: ["Plying Cararayan main road strictly prohibited"],
      conflict_notes: ["title says Cararayan proper; Section 1 says Deca Vistansa proper"],
      notes: "probably superseded by Ordinance 2025-067",
      variants: [
        {
          direction: "branch",
          name: "Langon (Cararayan Rd corner) – Deca Vistansa via Salunguigui",
          street_text: "Cararayan Rd corner (Langon) – Salunguigui – Deca Vistansa",
          anchors: [
            { kind: "place_name", name: "Langon" },
            { kind: "place_name", name: "Salunguigui" },
            { kind: "place_name", name: "Deca Vistansa" },
          ],
        },
      ],
      source_codes: ["N05"],
      review: ok("Brief: authorized feeder, 10 units [N05], with conflict note"),
    },
  ];

  // ------------------------------------------------------------ LPTRP routes: service confirmed
  const lptrp = legacy.routes.map((r) => r.publicCode);
  const routeStatusUpdates: ModesSeed["routeStatusUpdates"] = lptrp.map((code) => ({
    route_code: code,
    operating_status: "operating",
    status_note: "Traditional jeepney service owner-confirmed 2026-10-16. Stop locations, stop order and paths stay unverified.",
    confirmed_on: "2026-10-16",
    source_codes: ["U01"],
    review: ok("User decision 2026-10-16: traditional jeepneys confirmed operating on all routes (service only)"),
  }));

  // ------------------------------------------------------------ fleet (C1–C4 as amended 2026-10-16)
  const fleet: ModesSeed["fleet"] = [
    ...lptrp.map((code) => ({
      code: `FL-${code}-TRAD`,
      route_code: code,
      vehicle_class: "traditional_puj" as const,
      evidence_levels: ["legal_plan" as const, "owner_confirmation" as const],
      status: "operating" as const,
      first_reported_on: null,
      last_reported_on: "2026-10-16",
      units_note: "PUJ Class 2 in the 2025 route plan",
      aircon: null,
      aircon_source_codes: [],
      cooperatives: [],
      conflict_notes: [],
      notes: "The route plan's class is the planned class; traditional service confirmed by the project owner (U01).",
      source_codes: ["N30", "U01"],
      review: ok("C1 + user decision 2026-10-16: traditional jeepneys operate on every LPTRP route"),
    })),
    {
      code: "FL-R4-MOD", route_code: "R4", vehicle_class: "modern_puj",
      evidence_levels: ["official_report", "news_report", "owner_confirmation"], status: "operating",
      first_reported_on: "2023-04-17", last_reported_on: "2026-10-16",
      units_note: "about 10 air-conditioned units (2023–2024 reports); current count not confirmed",
      aircon: true, aircon_source_codes: ["N14", "U01"],
      cooperatives: ["Naga City Allied Transport Cooperative (NACIATRASCO)"],
      conflict_notes: [],
      notes: "Propulsion not stated by any source; never labelled e-jeepney.",
      source_codes: ["N14", "N38", "N39", "N41", "U01"],
      review: ok("C2 as amended 2026-10-16: modern jeepneys operating now on R4 (owner confirmation U01)"),
    },
    {
      code: "FL-R7-MOD", route_code: "R7", vehicle_class: "modern_puj",
      evidence_levels: ["official_report", "news_report", "owner_confirmation"], status: "operating",
      first_reported_on: "2024-01-16", last_reported_on: "2026-10-16",
      units_note: "about 5 units (2024 reports); current count not confirmed",
      aircon: true, aircon_source_codes: ["U01"],
      cooperatives: ["Naga City Allied Transport Cooperative (NACIATRASCO)", "Carolina Panicuason Transport Cooperative (CAPATRANSCO)"],
      conflict_notes: ["the two cooperatives' 5 units may be the same vehicles"],
      notes: "Propulsion not stated by any source; never labelled e-jeepney.",
      source_codes: ["N38", "N15", "N41", "U01"],
      review: ok("C3 as amended 2026-10-16: modern jeepneys operating now on R7 (owner confirmation U01)"),
    },
    {
      code: "FL-TRI-VISTODA", route_code: "TRI-VISTODA", vehicle_class: "tricycle",
      evidence_levels: ["legal_plan"], status: "planned",
      first_reported_on: "2025-09-09", last_reported_on: "2025-09-09",
      units_note: "33 special trimobile units authorized", aircon: null, aircon_source_codes: [], cooperatives: [], conflict_notes: [],
      notes: "Authorized; operation not verified.", source_codes: ["N06"],
      review: ok("Brief fleet row TRI-*"),
    },
    {
      code: "FL-TRI-DECALANGON", route_code: "TRI-DECALANGON", vehicle_class: "tricycle",
      evidence_levels: ["legal_plan"], status: "planned",
      first_reported_on: "2025-03-18", last_reported_on: "2025-03-18",
      units_note: "10 special trimobile units authorized", aircon: null, aircon_source_codes: [], cooperatives: [], conflict_notes: [],
      notes: "Authorized; operation not verified; probably superseded by Ordinance 2025-067.", source_codes: ["N05"],
      review: ok("Brief fleet row TRI-*"),
    },
  ];

  // ------------------------------------------------------------ cooperatives (C8; names only)
  const reg = "Registered cooperative whose name matches this corridor (OTC masterlist, July 2023) · route not confirmed";
  const cooperatives: ModesSeed["cooperatives"] = [
    { route_code: "R4", name: "Naga City Allied Transport Cooperative (NACIATRASCO)", basis: "corridor_reported", reported_on: "2024-01-16", notes: null, source_codes: ["N14", "N38"], review: ok("Brief C8") },
    { route_code: "R7", name: "Naga City Allied Transport Cooperative (NACIATRASCO)", basis: "corridor_reported", reported_on: "2024-01-16", notes: null, source_codes: ["N38"], review: ok("Brief C8") },
    { route_code: "R7", name: "Carolina Panicuason Transport Cooperative (CAPATRANSCO)", basis: "corridor_reported", reported_on: "2024-06-24", notes: "Corridor inferred from the cooperative name and N15.", source_codes: ["N15", "N41"], review: ok("Brief C8") },
    { route_code: "R4", name: "Centro Panganiban Del Rosario Transport Cooperative", basis: "name_matches_corridor", reported_on: "2023-07", notes: reg, source_codes: ["N40"], review: ok("Brief C8 (registry name match)") },
    { route_code: "R4", name: "Del Rosario Panganiban Centro Bagong Pag-Asa Transport Cooperative (DCPC-BAPAGTRANSCO)", basis: "name_matches_corridor", reported_on: "2023-07", notes: reg, source_codes: ["N40"], review: ok("Brief C8 (registry name match)") },
    { route_code: "R3", name: "Naga Concepcion Diversion Del Rosario Transport Cooperative", basis: "name_matches_corridor", reported_on: "2023-07", notes: reg, source_codes: ["N40"], review: ok("Brief C8 (registry name match)") },
    { route_code: "R6", name: "Naga City – Pacol Allied Transport Cooperative", basis: "name_matches_corridor", reported_on: "2023-07", notes: reg, source_codes: ["N40"], review: ok("Brief C8 (registry name match)") },
    { route_code: null, name: "Magsaysay Allied Transport Cooperative (MATCo)", basis: "name_matches_corridor", reported_on: "2023-07", notes: null, source_codes: ["N40"], review: no("corridor unclear (R2 or R8); registry address error") },
  ];

  // ------------------------------------------------------------ regional services (J6, D4)
  const termNote = "terminal from OSM tags/name; confirm";
  const busFares = ["F08", "F09", "F10", "F11", "F12"];
  const rs = (code: string, mode: "jeepney" | "bus" | "uv_express", name: string, operators: string[], terminal: string, destination: string, ids: number[], fares: string[]) => ({
    code, mode, name, operators, terminal_code: terminal, terminal_note: termNote, destination,
    osm_relation_ids: ids, status: "community_mapped" as const, fare_rule_codes: fares, notes: null,
    source_codes: ["N01"], review: ok("Brief regional services table"),
  });
  const regionalServices: ModesSeed["regionalServices"] = [
    rs("RS01", "jeepney", "Naga–Goa", [], "T03", "Goa", [11498944, 11498945], ["F01"]),
    rs("RS02", "bus", "Florencia Naga–Goa", ["Florencia Transport Services Inc."], "T01", "Goa", [11495322, 11495323], busFares),
    rs("RS03", "bus", "Florencia/JC Liner Naga–Lagonoy", ["Florencia Transport Services Inc.", "JC Liner Corporation"], "T01", "Lagonoy", [11495326, 11495327], busFares),
    rs("RS04", "jeepney", "Naga–Pasacao", [], "T03", "Pasacao", [14065995, 14065996], ["F01"]),
    rs("RS05", "uv_express", "UV Express Naga–Tabaco via Sabluyon", [], "T01", "Tabaco", [11498948, 11498949], ["F06", "F07"]),
    rs("RS06", "bus", "PITX–Naga (Philtranco; Bicol Isarog)", ["Philtranco", "Bicol Isarog"], "T01", "PITX (Parañaque)", [9732639, 10594406, 10939369], busFares),
    rs("RS07", "bus", "Santa Rosa ITT–Naga (Raymond)", ["Raymond Transportation"], "T01", "Santa Rosa ITT", [11488879], busFares),
    { ...rs("C-OSM-SABANG-UV", "uv_express", "UV Express Naga–Sabang", [], "T03", "Sabang", [3635597, 8203308], ["F06", "F07"]), review: no("which Sabang is unconfirmed") },
    { ...rs("C-OSM-SABANG-PUJ", "jeepney", "Jeepney Naga–Sabang", [], "T03", "Sabang", [11495324, 11495325], ["F01"]), review: no("which Sabang is unconfirmed") },
  ];

  // ------------------------------------------------------------ fares (J7, J6)
  const nat = (code: string, mode: FareMode, basePhp: number | null, baseKm: number | null, perKm: number, evidence: FareEvidence, ruleText: string) => ({
    code, mode, base_php: basePhp, base_km: baseKm, additional_php_per_km: perKm, effective_from: "2026-09-28",
    evidence_status: evidence, publish_exact: false as const, rule_text: ruleText, notes: null,
    source_codes: ["N17"], review: ok("Brief new fare rules F06–F12 (national rates from 2026-09-28)"),
  });
  const fareRules: ModesSeed["fareRules"] = [
    nat("F06", "uv_express_traditional", null, null, 2.6, "provisional_national_rate", "Provisional: P2.60/km (traditional UV); no minimum stated"),
    nat("F07", "uv_express_modern", null, null, 3.0, "provisional_national_rate", "Provisional: P3.00/km (modern UV); no minimum stated"),
    nat("F08", "bus_ordinary", 12, 5, 2.2, "national_rate_reported", "Ordinary: P12.00 first 5 km + P2.20/km"),
    nat("F09", "bus_aircon", null, null, 2.45, "national_rate_reported", "Aircon P2.45/km"),
    nat("F10", "bus_deluxe", null, null, 2.6, "national_rate_reported", "Deluxe P2.60/km"),
    nat("F11", "bus_super_deluxe", null, null, 2.7, "national_rate_reported", "Super deluxe P2.70/km"),
    nat("F12", "bus_luxury", null, null, 3.35, "national_rate_reported", "Luxury P3.35/km"),
    {
      code: "CF-REGIONAL-OBS-2026-01", mode: "bus_regional_ticket_observed", base_php: null, base_km: null, additional_php_per_km: null,
      effective_from: null, evidence_status: "aggregator_outdated", publish_exact: false,
      rule_text: "Observed pre-hike ticket prices from BCS (Jan 2026)", notes: "Jev p(current) = 0.09",
      source_codes: ["N18"], review: no("pre-hike regional prices (p current 0.09)"),
    },
    {
      code: "CF-TERMINAL-FEE-EB", mode: "terminal_dispatch_fee", base_php: 40, base_km: null, additional_php_per_km: null,
      effective_from: "2022-02-15", evidence_status: "official_historical", publish_exact: false,
      rule_text: "Eastbound terminal dispatch fee P40/jeepney, P60/van (operator fee, not passenger fare)", notes: null,
      source_codes: ["N12"], review: no("Eastbound dispatch fee is an operator fee, not a passenger fare"),
    },
  ];
  // Owner-reported practice (U01), stored as observations against the modern class, never as rules.
  const fareObservations: ModesSeed["fareObservations"] = [
    {
      code: "FO-R4-MOD", route_code: "R4", vehicle_class: "modern_puj", kind: "reported_practice",
      relative_to: "traditional_fare", delta_qualifier: "range", delta_centavos_low: 300, delta_centavos_high: 500,
      observed_on: "2026-10-16", report_text: "R4 modern fare is about P3–P5 more than the traditional fare",
      notes: "Reported practice; estimates for the modern class span the national modern rule (F02) and traditional + this delta.",
      source_codes: ["U01"], review: ok("Owner fact 2026-10-16 (coordinator): observation, not a rule"),
    },
    {
      code: "FO-R7-MOD", route_code: "R7", vehicle_class: "modern_puj", kind: "reported_practice",
      relative_to: "traditional_fare", delta_qualifier: "at_least", delta_centavos_low: 500, delta_centavos_high: null,
      observed_on: "2026-10-16", report_text: "R7 modern fare is at least P5 more than the traditional fare",
      notes: "Reported practice; estimates for the modern class span the national modern rule (F02) and traditional + this delta.",
      source_codes: ["U01"], review: ok("Owner fact 2026-10-16 (coordinator): observation, not a rule"),
    },
  ];
  const fareRuleSourceAdditions: ModesSeed["fareRuleSourceAdditions"] = [
    { rule_code: "F01", add_source_codes: ["N17", "N32"], review: ok("J7: values equal the national 2026-09-28 rate; sources added") },
    { rule_code: "F02", add_source_codes: ["N17", "N32"], review: ok("J7: values equal the national 2026-09-28 rate; sources added") },
    { rule_code: "F03", add_source_codes: ["N33"], review: ok("N33 is Ordinance 2024-002 (same as S04)") },
  ];

  // ------------------------------------------------------------ time-estimate parameters (D8, D9)
  const etaParams: ModesSeed["etaParams"] = [
    {
      key: "walk_speed_kmh", value_low: 4.238, value_high: 4.238, unit: "km_per_h", windows: null, days: null,
      applies_to: ["walk"], is_assumption: false, assumption_note: null,
      basis: "Walking speed 4.238 km/h, Metro Manila study (Tolentino & Sigua 2022)", source_codes: ["N28"],
      review: ok("D8"),
    },
    {
      key: "walk_slowdown_factor", value_low: 1, value_high: 1.25, unit: "factor", windows: null, days: null,
      applies_to: ["walk"], is_assumption: true,
      assumption_note: "A1: crossings, waiting at roads, slower walkers (high end = low end × 1.25); no source",
      basis: "ParaNaga assumption A1", source_codes: [],
      review: ok("D8 assumption A1"),
    },
    {
      key: "jeepney_speed_offpeak_kmh", value_low: 10, value_high: 15, unit: "km_per_h", windows: null, days: null,
      applies_to: ["jeepney"], is_assumption: false, assumption_note: null,
      basis: "Naga baseline about 10 km/h (SafeTravelPH SimEx); comparable-city observed upper about 15 km/h (Puerto Princesa)",
      source_codes: ["N16", "N29"],
      review: ok("D9"),
    },
    {
      key: "jeepney_speed_peak_kmh", value_low: 7, value_high: 13, unit: "km_per_h", windows: null, days: null,
      applies_to: ["jeepney"], is_assumption: true,
      assumption_note: "A2: the low end (7 km/h) is 30% below the Naga ~10 km/h baseline, an assumption; the high end (13) is N29's 13.3 rounded down",
      basis: "High end from N29 (observed peak 13.3 km/h); low end assumption A2", source_codes: ["N29"],
      review: ok("D9 (mixed band: high end sourced, low end assumption A2)"),
    },
    {
      key: "peak_windows", value_low: null, value_high: null, unit: "windows",
      windows: [{ start: "06:00", end: "08:00" }, { start: "11:00", end: "13:00" }, { start: "16:00", end: "19:00" }],
      days: "every_day", applies_to: ["jeepney"], is_assumption: true,
      assumption_note: "A3: applied every day; no day-of-week source",
      basis: "Ordinance 2025-110 peak-hour truck ban on Roxas Ave (Asia/Manila)", source_codes: ["N04"],
      review: ok("D9 (windows sourced; every-day application assumption A3)"),
    },
    {
      key: "tricycle_speed_kmh", value_low: 19.9, value_high: 19.9, unit: "km_per_h", windows: null, days: null,
      applies_to: ["tricycle"], is_assumption: false, assumption_note: null,
      basis: "PIDS Metro Manila drive cycle (search excerpt only)", source_codes: [],
      review: no("unverified excerpt (PIDS page 404)"),
    },
  ];

  // ------------------------------------------------------------ conflicts register (never shown as facts)
  const conflicts: ModesSeed["conflicts"] = [
    { code: "CX01", topic: "Cooperative chairpersons", description: "Chairperson names for NACIATRASCO and CAPATRANSCO are swapped between N41 and N14/N40. Names are not stored and never shown.", refs: ["FL-R4-MOD", "FL-R7-MOD"], source_codes: ["N14", "N40", "N41"], review: ok("C8") },
    { code: "CX02", topic: "R7 modern units", description: "the two cooperatives' 5 units may be the same vehicles", refs: ["FL-R7-MOD"], source_codes: ["N38", "N15", "N41"], review: ok("C3") },
    { code: "CX03", topic: "OSM 'UV-Express Southbound Terminal'", description: "OSM name conflicts with the official southbound site (LCC, Sabang); the node lies about 0.4 km east of BCS; field-verify", refs: ["CT-UV-SOUTHBOUND-OSM", "T03"], source_codes: ["N02", "N31"], review: ok("Brief exclusion of CT-UV-SOUTHBOUND-OSM") },
    { code: "CX04", topic: "Eastbound terminal street", description: "Anciano St (Res. 2025-735) vs Waling-Waling St (Wikivoyage); neither gives a coordinate", refs: ["T02"], source_codes: ["S03", "N30", "N19"], review: ok("Research conflict 3") },
    { code: "CX05", topic: "Deca–Langon route wording", description: "title says Cararayan proper; Section 1 says Deca Vistansa proper", refs: ["TRI-DECALANGON"], source_codes: ["N05"], review: ok("Research conflict 7") },
    { code: "CX06", topic: "MATCo registry entry", description: "The masterlist files MATCo under Albay although it lists a Naga location (registry address error); corridor unclear (R2 or R8)", refs: [], source_codes: ["N40"], review: ok("Research conflict (registry)") },
    { code: "CX07", topic: "Tricycle fare ordinance number", description: "Search summaries cite Ordinance 2026-023; that ordinance is the slow-moving vehicle lane. The fare is in Ordinance 2024-002.", refs: ["F03"], source_codes: ["N03", "N33"], review: ok("Research conflict 1") },
    { code: "CX08", topic: "Rush-hour windows", description: "Three different window sets: 1993 Traffic Code, 2025 truck ban, a commuter guide. The 2025 truck ban (N04) is used.", refs: ["peak_windows"], source_codes: ["N11", "N04", "N20"], review: ok("Research conflict 5") },
    { code: "CX09", topic: "Bicol Central Station ticket prices", description: "All retrieved destination prices predate the 28 Sep 2026 increase; not used.", refs: ["CF-REGIONAL-OBS-2026-01"], source_codes: ["N18"], review: ok("Research conflict 6") },
  ];

  const seed: ModesSeed = {
    header: {
      schemaVersion: 1,
      preparedOn: REVIEWED_ON,
      preparedFrom: [
        `naga-transport-candidates-2026-10.json@sha256:${sha(RESEARCH)}`,
        `${LEGACY}@sha256:${sha(LEGACY)}`,
        `${PLACES}@sha256:${sha(PLACES)}`,
      ],
      reviewer: "controller",
      jevModel: JEV_MODEL,
    },
    sources, terminals, routes, routeStatusUpdates, fleet, cooperatives, regionalServices,
    fareRules, fareObservations, fareRuleSourceAdditions, etaParams, streetAliases: [], conflicts,
  };

  const parsed = parseModesSeed(JSON.parse(JSON.stringify(seed)));
  const issues = validateModesSeed(parsed, {
    externalSourceCodes: legacy.sources.map((s) => s.code),
    existingRouteCodes: lptrp,
    existingTerminalCodes: legacy.terminals.map((t) => t.code),
    existingFareRules: legacy.fareRules,
  });
  if (issues.length > 0) {
    console.error(issues.join("\n"));
    return 1;
  }
  writeFileSync(path.resolve(out), `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  console.log(`wrote ${out}`);
  return 0;
}

process.exitCode = main();
