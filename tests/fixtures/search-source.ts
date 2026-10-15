// SearchIndexSource built from the REAL Data_Sets files (all 128 mapped pins, 11 routes, trial
// circuits, terminals, barangays, study labels, categories, leads) plus the Task 3 synthetic
// OpenStreetMap fixture (fake names). Ids are derived deterministically from source identities
// (the database assigns its own ids).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { OsmPlace } from "@/domain/api/schemas";
import { NAGA_BOUNDARY } from "@/domain/geo/naga";
import { buildSnapshot, parseGeojsonStops, withIdentities } from "@/domain/import/mapped-stops";
import { parseOsmPlaces } from "@/domain/import/osm-places";
import { provisionalLoopSequence } from "@/domain/import/provisional-loops";
import { normalizeSeed } from "@/domain/import/seed";
import type { SearchIndexSource } from "@/domain/search/index-build";

const DATA_SETS = new URL("../../Data_Sets/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, DATA_SETS), "utf8");
const OSM_FIXTURE = new URL("./osm/naga-places-2026-10-15.osm.json", import.meta.url);

export function idFor(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function realSearchSource(): SearchIndexSource {
  const mapId = parseGeojsonStops(read("naga_mapped_stops.geojson")).metadata.mapId;
  const records = withIdentities(
    buildSnapshot(read("naga_mapped_stops_source.kml"), read("naga_mapped_stops.geojson"), read("naga_mapped_stops.csv")).records,
    mapId,
  );
  const onRoute = new Set(
    (["R8-A", "R8-B"] as const).flatMap((code) => provisionalLoopSequence(records, code)!.map((s) => s.recordIdentity)),
  );
  const seed = normalizeSeed(JSON.parse(read("naga_transport_seed.json")));

  const parsed = parseOsmPlaces(JSON.parse(readFileSync(OSM_FIXTURE, "utf8")), NAGA_BOUNDARY);
  const places: OsmPlace[] = parsed.places.map((p) => ({
    key: p.key, name: p.name, aliases: p.aliases, category: p.category, lat: p.lat, lng: p.lng,
    osmType: p.osmType, osmId: p.osmId, osmVersion: p.osmVersion, sourceCode: "OSM-2026-10-15",
  }));

  return {
    revision: { revisionId: idFor("revision"), label: "search fixture", kind: "provisional", publishedAt: null },
    places,
    stops: records.map((r) => ({
      id: idFor(r.sourceIdentity), layer: r.sourceLayer, code: r.code, label: r.label, lat: r.lat, lng: r.lng,
      onRoute: onRoute.has(r.sourceIdentity),
    })),
    routes: seed.routes.map((r) => {
      const trials = seed.trialChanges.filter((t) => t.routeCode === r.publicCode);
      const ab = r.publicCode === "R8-A" || r.publicCode === "R8-B";
      return {
        code: r.publicCode, name: r.name, groupNumber: r.officialGroupNumber,
        evidenceLevel: ab ? ("provisional" as const) : ("documentary" as const), hasTrial: trials.length > 0,
        streetLists: [r.legalStreets.inbound, r.legalStreets.outbound, r.legalStreets.circuit, ...trials.map((t) => t.simplifiedCircuit)]
          .filter((l): l is string[] => l !== null),
        mode: "jeepney" as const,
        fleetLabel: "Vehicle type not confirmed",
      };
    }),
    terminals: seed.terminals.map((t) => ({ code: t.code, name: t.name, locationText: t.locationText, modes: t.modes, kind: null, location: null })),
    barangays: seed.barangays.map((b) => ({ name: b.name, surveyStatus: b.surveyStatus, sourceCode: b.sourceCode })),
    studyLabels: seed.designatedCandidates.map((d) => ({
      code: d.code, label: d.labelRaw, labelType: d.labelType, routeCode: d.routeCode, direction: d.direction,
      sourceContext: d.sourceContext, sourceCodes: d.sourceIds,
    })),
    destinationCategories: seed.externalDestinationCategories.map((c) => ({
      category: c.category, destinations: c.destinations, terminalCode: c.candidateTerminalCode,
    })),
    feederLeads: seed.feederCandidates.map((f) => ({ code: f.code, name: f.name, status: f.operatingStatus })),
  };
}
