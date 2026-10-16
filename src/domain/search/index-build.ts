// Builds the immutable search index of one published revision (decision D1) from rows the server
// read through the v_published_* views (src/server/repos/reference-repo.ts). Pure: no I/O.
// Server-side only (it hashes with node:crypto); the client uses ./normalize.ts.
//
// Honesty rules:
//  - only OpenStreetMap places, mapped-pin places and terminals with an OpenStreetMap coordinate
//    carry coordinates; barangays, study labels and terminals without one get `location: null`
//    (nothing is on file, nothing is inferred);
//  - a mapped-pin place is a group of candidate pins sharing one normalized raw label within 60 m
//    of the group's first pin; blank labels are never places;
//  - legacy (1993) names are historical hints with mappedRouteCode null.
import type { OsmPlace, RevisionMeta, SearchIndex, SearchPinPlace, SearchPlaces } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { isCorePlaceCategory } from "../places/osm-categories";
import { sha256Hex } from "../import/hash";
import { compareCodeUnits } from "../text/compare";
import { LEGACY_ROUTE_NAMES } from "./legacy-route-names";
import { foldText, tokenize } from "./normalize";

export const PIN_GROUP_RADIUS_M = 60;

export type SearchSourceStop = {
  id: string;
  layer: string | null;
  code: string | null;
  /** Raw source label, verbatim; blank or null is not a place. */
  label: string | null;
  lat: number;
  lng: number;
  onRoute: boolean;
};

export type SearchSourceRoute = {
  code: string;
  name: string;
  groupNumber: number | null;
  evidenceLevel: SearchIndex["routes"][number]["evidenceLevel"];
  hasTrial: boolean;
  /** Legal street lists (inbound, outbound, circuit, feeder branch text) and trial circuits, verbatim, in order. */
  streetLists: string[][];
  mode: SearchIndex["routes"][number]["mode"];
  /** fleetLabel of the published vehicle-class records. */
  fleetLabel: string;
};

export type SearchIndexSource = {
  revision: RevisionMeta;
  places: OsmPlace[];
  stops: SearchSourceStop[];
  routes: SearchSourceRoute[];
  terminals: SearchIndex["terminals"][number][];
  barangays: { name: string; surveyStatus: string; sourceCode: string | null }[];
  studyLabels: {
    code: string;
    label: string;
    labelType: string | null;
    routeCode: string | null;
    direction: string | null;
    sourceContext: string | null;
    sourceCodes: string[];
  }[];
  destinationCategories: { category: string; destinations: string[]; terminalCode: string | null }[];
  feederLeads: { code: string; name: string; status: string | null }[];
};

/** Natural stop order: layer (nulls last), code length, code, id — independent of input order. */
function compareStops(a: SearchSourceStop, b: SearchSourceStop): number {
  if (a.layer !== b.layer) {
    if (a.layer === null) return 1;
    if (b.layer === null) return -1;
    const c = compareCodeUnits(a.layer, b.layer);
    if (c !== 0) return c;
  }
  const ac = a.code ?? "";
  const bc = b.code ?? "";
  return ac.length - bc.length || compareCodeUnits(ac, bc) || compareCodeUnits(a.id, b.id);
}

type Group = { normalized: string; first: SearchSourceStop; stops: SearchSourceStop[] };

/** Groups labelled pins into mapped-pin places (see the file header). */
export function groupPinPlaces(stops: readonly SearchSourceStop[]): SearchPinPlace[] {
  const groups: Group[] = [];
  for (const stop of [...stops].sort(compareStops)) {
    const normalized = foldText(stop.label ?? "");
    if (normalized === "") continue;
    const group = groups.find(
      (g) => g.normalized === normalized && haversineMeters(g.first, stop) <= PIN_GROUP_RADIUS_M,
    );
    if (group) group.stops.push(stop);
    else groups.push({ normalized, first: stop, stops: [stop] });
  }

  return groups
    .map((g): SearchPinPlace => {
      const counts = new Map<string, number>();
      for (const s of g.stops) counts.set(s.label!, (counts.get(s.label!) ?? 0) + 1);
      const spellings = [...counts.keys()];
      // Most frequent raw spelling; ties go to the first seen.
      const label = spellings.reduce((best, s) => (counts.get(s)! > counts.get(best)! ? s : best));
      return {
        key: sha256Hex(g.normalized + g.first.id).slice(0, 16),
        label,
        spellings,
        pins: g.stops.map((s) => ({ stopId: s.id, code: s.code, layer: s.layer, lat: s.lat, lng: s.lng, onRoute: s.onRoute })),
      };
    })
    .sort((a, b) => compareCodeUnits(foldText(a.label), foldText(b.label)) || compareCodeUnits(a.key, b.key));
}

const distinct = (values: Iterable<string>): string[] => [...new Set(values)];
/** Feeder (TRI-*) street lists come from an unordered query: sort them so a recapture is stable. */
const routeStreets = (code: string, lists: string[][]): string[] => {
  const streets = distinct(lists.flat());
  return code.startsWith("TRI-") ? streets.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : streets;
};

/**
 * URL-safe key from the folded name ("Bagumbayan Norte" → "bagumbayan-norte"); a name without
 * letters or digits gets "barangay" (never an empty key, which the schema rejects).
 */
export function barangayKey(name: string): string {
  return tokenize(name).join("-") || "barangay";
}

/**
 * Keys for a list of barangay names, unique within the list: a repeated key (two names that fold
 * the same) gets a deterministic suffix in input order ("san-felipe", "san-felipe-2").
 */
export function barangayKeys(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = barangayKey(name);
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
    used.add(key);
    return key;
  });
}

const searchPlace = (p: OsmPlace): SearchPlaces["places"][number] => ({
  key: p.key,
  name: p.name,
  aliases: p.aliases,
  category: p.category,
  lat: p.lat,
  lng: p.lng,
  osmVersion: p.osmVersion,
  sourceCode: p.sourceCode,
});

/** The lazy chunk (Task 14): every published OSM place outside the D10 categories the index carries. */
export function buildSearchPlaces(source: Pick<SearchIndexSource, "revision" | "places">): SearchPlaces {
  return { revision: source.revision, places: source.places.filter((p) => !isCorePlaceCategory(p.category)).map(searchPlace) };
}

export function buildSearchIndex(source: SearchIndexSource): SearchIndex {
  const barangayKeyList = barangayKeys(source.barangays.map((b) => b.name));
  return {
    revision: source.revision,
    // Only the D10 categories: the first paint does not grow with the named-place snapshot.
    osmPlaces: source.places.filter((p) => isCorePlaceCategory(p.category)).map(searchPlace),
    pinPlaces: groupPinPlaces(source.stops),
    routes: source.routes.map((r) => ({
      code: r.code,
      name: r.name,
      groupNumber: r.groupNumber,
      evidenceLevel: r.evidenceLevel,
      hasTrial: r.hasTrial,
      streets: routeStreets(r.code, r.streetLists),
      mode: r.mode,
      fleetLabel: r.fleetLabel,
    })),
    terminals: source.terminals.map((t) => ({ ...t, location: t.location ? { ...t.location } : null })),
    barangays: source.barangays.map((b, i) => ({
      key: barangayKeyList[i]!,
      name: b.name,
      surveyStatus: b.surveyStatus,
      sourceCode: b.sourceCode,
      location: null,
    })),
    studyLabels: source.studyLabels.map((s) => ({ ...s, location: null })),
    destinationCategories: source.destinationCategories.map((c) => ({ ...c })),
    feederLeads: source.feederLeads.map((f) => ({ ...f })),
    legacyNames: LEGACY_ROUTE_NAMES.map((n) => ({ ...n })),
  };
}
