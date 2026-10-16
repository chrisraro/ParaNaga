// Place detail (Increment A, Task 6): which entry of the published search index a place URL
// names, and the copy of the Place and Terminal detail screens. Pure: no I/O, no React.
//
// A "place" is one of four things, all from data (global constraints): an OpenStreetMap place
// (has a coordinate), a mapped-pin place (pins sharing one raw label; has the pins'
// coordinates), a barangay (no location) and a 2025 study stop label (no location). Only the
// first two can be a trip start or destination. Nothing here infers a location, an entrance,
// hours or a photo.
import type { SearchIndex, SearchOsmPlace, SearchPinPlace } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";
import { formatIsoDate } from "../network/present";
import { OSM_ELEMENT_TYPES, type OsmElementType } from "./osm-categories";

export type OsmPlaceRef = { kind: "osm"; type: OsmElementType; id: string };
export type PlaceRef = OsmPlaceRef | { kind: "pin"; key: string } | { kind: "barangay"; key: string } | { kind: "study"; code: string };

export type PlaceEntry =
  | { kind: "osm"; type: OsmElementType; id: string; place: SearchOsmPlace }
  | { kind: "pin"; place: SearchPinPlace }
  | { kind: "barangay"; place: SearchIndex["barangays"][number] }
  | { kind: "study"; place: SearchIndex["studyLabels"][number] };

// ------------------------------------------------------------------ URLs

const OSM_ID = /^[1-9][0-9]{0,18}$/;
const PIN_KEY = /^[0-9a-f]{16}$/;
const BARANGAY_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STUDY_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

/** URL params → a place reference; null for anything malformed (the page answers not-found). */
export function parsePlaceRef(kind: PlaceRef["kind"], params: Record<string, string | undefined>): PlaceRef | null {
  switch (kind) {
    case "osm": {
      const type = params.type;
      const id = params.id;
      if (!type || !id || !(OSM_ELEMENT_TYPES as readonly string[]).includes(type) || !OSM_ID.test(id)) return null;
      return { kind: "osm", type: type as OsmElementType, id };
    }
    case "pin":
      return params.key && PIN_KEY.test(params.key) ? { kind: "pin", key: params.key } : null;
    case "barangay":
      return params.key && BARANGAY_KEY.test(params.key) ? { kind: "barangay", key: params.key } : null;
    case "study":
      return params.code && STUDY_CODE.test(params.code) ? { kind: "study", code: params.code } : null;
  }
}

/** "osm:way/123" → { type: "way", id: "123" }; null if the key is not an OSM key. */
export function osmKeyParts(key: string): { type: OsmElementType; id: string } | null {
  const m = /^osm:(node|way|relation)\/([1-9][0-9]*)$/.exec(key);
  return m ? { type: m[1] as OsmElementType, id: m[2]! } : null;
}

/** The detail screen of each kind of place (and of terminals). */
export function osmPlaceHref(key: string): string | null {
  const parts = osmKeyParts(key);
  return parts ? `/app/places/osm/${parts.type}/${parts.id}` : null;
}
export const pinPlaceHref = (key: string) => `/app/places/pin/${encodeURIComponent(key)}`;
export const barangayHref = (key: string) => `/app/places/barangay/${encodeURIComponent(key)}`;
export const studyLabelHref = (code: string) => `/app/places/study/${encodeURIComponent(code)}`;
export const terminalHref = (code: string) => `/app/terminals/${encodeURIComponent(code)}`;

/**
 * Search, prefilled with `query`. The query rides in the fragment, which never reaches a server
 * (decision D1: search queries never leave the phone).
 */
export function searchHref(query: string): string {
  return `/app/search#q=${encodeURIComponent(query)}`;
}

/** The query of a `#q=` fragment (see searchHref); "" when there is none. */
export function queryFromHash(hash: string): string {
  const m = /^#q=(.*)$/.exec(hash);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return "";
  }
}

export function findPlace(index: SearchIndex, ref: PlaceRef): PlaceEntry | null {
  switch (ref.kind) {
    case "osm": {
      const key = `osm:${ref.type}/${ref.id}`;
      const place = index.osmPlaces.find((p) => p.key === key);
      return place ? { kind: "osm", type: ref.type, id: ref.id, place } : null;
    }
    case "pin": {
      const place = index.pinPlaces.find((p) => p.key === ref.key);
      return place ? { kind: "pin", place } : null;
    }
    case "barangay": {
      const place = index.barangays.find((b) => b.key === ref.key);
      return place ? { kind: "barangay", place } : null;
    }
    case "study": {
      const place = index.studyLabels.find((s) => s.code === ref.code);
      return place ? { kind: "study", place } : null;
    }
  }
}

// ------------------------------------------------------------------ trip ends

/** The pin a mapped-pin place is used at: its first on-route pin, else its first pin. */
export function pinPlaceMainPin(place: SearchPinPlace): SearchPinPlace["pins"][number] {
  return place.pins.find((p) => p.onRoute) ?? place.pins[0]!;
}

export function pinPlacePoint(place: SearchPinPlace): LatLng {
  const pin = pinPlaceMainPin(place);
  return { lat: pin.lat, lng: pin.lng };
}

/** The trip-end label of a mapped-pin place (same as Search). */
export const pinPlaceEndpointLabel = (label: string) => `${label} (mapped pin)`;

// ------------------------------------------------------------------ nearest mapped stops

export const NEAREST_STOP_RADIUS_M = 600;
export const NEAREST_STOP_LIMIT = 3;

export type NearbyMappedStop = { stopId: string; label: string; code: string | null; layer: string | null; meters: number };

/**
 * Up to `limit` mapped pins within `radius` m of `point` (straight line), nearest first: one per
 * mapped-pin place (its nearest pin, preferring one on a route order at the same distance), so
 * the same corner imported in several layers is listed once.
 */
export function nearestMappedStops(
  index: Pick<SearchIndex, "pinPlaces">,
  point: LatLng,
  radius = NEAREST_STOP_RADIUS_M,
  limit = NEAREST_STOP_LIMIT,
): NearbyMappedStop[] {
  const out: (NearbyMappedStop & { i: number })[] = [];
  index.pinPlaces.forEach((place, i) => {
    let best: { pin: SearchPinPlace["pins"][number]; d: number } | null = null;
    for (const pin of place.pins) {
      const d = haversineMeters(point, pin);
      if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && pin.onRoute && !best.pin.onRoute)) best = { pin, d };
    }
    if (best && best.d <= radius) {
      out.push({ stopId: best.pin.stopId, label: place.label, code: best.pin.code, layer: best.pin.layer, meters: best.d, i });
    }
  });
  return out
    .sort((a, b) => a.meters - b.meters || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map(({ i, ...stop }) => {
      void i;
      return stop;
    });
}

// ------------------------------------------------------------------ copy

/** "OSM-2026-10-15" → "15 Oct 2026" (the snapshot's fetch date); null for any other code. */
export function osmSnapshotDate(sourceCode: string): string | null {
  const m = /^OSM-(\d{4}-\d{2}-\d{2})$/.exec(sourceCode);
  return m ? formatIsoDate(m[1]) : null;
}

/** "Source · OpenStreetMap, snapshot of 15 Oct 2026 · object way/123 v4". */
export function osmSourceText(place: Pick<SearchOsmPlace, "sourceCode" | "osmVersion">, type: OsmElementType, id: string): string {
  const date = osmSnapshotDate(place.sourceCode);
  return `OpenStreetMap, snapshot of ${date ?? "an undated snapshot"} · object ${type}/${id} v${place.osmVersion}`;
}

/** The element's page on openstreetmap.org (no query string). */
export function osmObjectUrl(type: OsmElementType, id: string): string {
  return `https://www.openstreetmap.org/${type}/${id}`;
}

/** Other raw spellings of a mapped-pin place; empty unless the group has more than one. */
export function otherSpellings(place: Pick<SearchPinPlace, "label" | "spellings">): string[] {
  if (place.spellings.length < 2) return [];
  return place.spellings.filter((s) => s !== place.label);
}

/** "2025_LPTRP_SimEx" → "2025 LPTRP SimEx"; null stays null. */
export function sourceContextText(context: string | null): string | null {
  if (!context) return null;
  const text = context.replace(/_/g, " ").trim();
  return text === "" ? null : text;
}

/** "Stop label from the 2025 route study (2025 LPTRP SimEx)". */
export function studyKindText(context: string | null): string {
  const text = sourceContextText(context);
  return `Stop label from the 2025 route study${text ? ` (${text})` : ""}`;
}

/** "R8-A clockwise"; "Not recorded" when neither is on file. */
export function studyRouteText(routeCode: string | null, direction: string | null): string {
  const text = [routeCode, direction].filter((x): x is string => !!x).join(" ");
  return text || "Not recorded";
}

// ------------------------------------------------------------------ terminals

const MODE_LABEL: Record<string, string> = {
  bus: "Bus",
  jeepney: "Jeepney",
  city_jeepney: "City jeepney",
  rail: "Rail",
  van: "Van",
  uv_express: "UV Express",
  tricycle: "Tricycle",
};

/** ["jeepney", "UV/van"] → "Jeepney, UV/van" (unknown modes verbatim, underscores spelled out). */
export function terminalModesText(modes: readonly string[]): string {
  return modes
    .map((m) => MODE_LABEL[m] ?? (m.charAt(0).toUpperCase() + m.slice(1)).replace(/_/g, " "))
    .join(", ");
}

const EVIDENCE_LABEL: Record<string, string> = {
  official_address: "city source",
  official_route_reference: "city route reference",
  official_historical_franchise: "historical franchise",
  official_street_structure: "legal street list",
  "station_exists;entrance_unverified": "station listed, entrance not verified",
  // Terminal versions of the modes seed (2026-10-16): the location is community data (OpenStreetMap).
  community_coordinate_official_address: "city source · location community-mapped",
  community_coordinate_official_historical_franchise: "historical franchise · location community-mapped",
  community_coordinate_matches_LPTRP_street: "community-mapped, on a legal route plan street",
  community_coordinate: "community-mapped",
  community_only: "community-mapped only",
  community_only_old: "community-mapped only (older edit)",
  official_location_text_conflicting_street: "city source, conflicting street",
  official_text_no_coordinate: "ordinance text · no location on file",
};

/** The address evidence ("Address: city source"); unknown statuses are spelled out. */
export function terminalEvidenceLabel(status: string | null): string {
  if (!status) return "no evidence on file";
  return EVIDENCE_LABEL[status] ?? status.replace(/[_;]+/g, " ").trim();
}

/** The terminal's role=note sentences (confusions on file, and what category labels mean). */
export function terminalNoteSentences(code: string, hasDestinationCategories: boolean): string[] {
  const out: string[] = [];
  if (code === "T01") out.push("Not the PNR railway station.");
  if (code === "T06") out.push("Not Bicol Central Station (the bus terminal).");
  if (hasDestinationCategories) out.push("Category labels such as northbound and eastbound are administrative, not compass directions.");
  return out;
}

/** The second line of a route that names the terminal. */
export function terminalRouteSub(basis: "legal_plan" | "trial"): string {
  return basis === "trial" ? "Named in the Nov 2025 trial · permanence unconfirmed" : "Named in the legal route plan · bay not mapped";
}
