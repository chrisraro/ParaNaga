// The reviewed inputs of the path tracer (Task 5), resolved once per road snapshot and shared by
// the importer (scripts/lib/lines-plan.ts) and the dev preview (scripts/preview-route-paths.ts), so
// both trace exactly the same thing:
//   - landmark items of the street lists (ROUTE_LANDMARKS), resolved against sourced data only;
//   - the outer terminus of each open LPTRP route (ROUTE_TERMINI), by place-node name;
//   - the listed terminals of a street list (their stretches can be terminal_access);
//   - feeder anchors (junction, OSM places snapshot, place name with a reviewed terminal fallback).
// `provenance()` lists every review decision used with how it resolved, for the import batch record
// (the decisions live in code, so the batch makes them auditable).
// Pure.
import type { RoadGraph } from "../geo/road-graph";
import type { StreetAlias } from "../geo/street-names";
import type { LatLng, LngLat } from "../geo/types";
import { resolvePlaceName, type PlaceNode } from "./osm-roads";
import { resolveRouteLandmarks, ROUTE_LANDMARKS, ROUTE_TERMINI, type LandmarkResolution } from "./route-landmarks";
import type { TraceAnchor, TraceInput } from "./trace-route";

/** Feeder place names with a reviewed waiting-area terminal (Task 4 ruling C: sourced terminal coordinate fallback). */
export const PLACE_TERMINAL_FALLBACK: Readonly<Record<string, string>> = { "Deca Vistansa": "T15" };

export type SeedAnchor =
  | { kind: "junction"; streets: readonly [string, string] }
  | { kind: "osm_place"; osmType: string; osmId: number }
  | { kind: "osm_places_snapshot"; key: string }
  | { kind: "place_name"; name: string };

export type TraceContextInput = {
  graph: RoadGraph;
  boundary: readonly LngLat[];
  aliases: readonly StreetAlias[];
  /** Reviewed modes-seed terminals (code + OSM coordinate or null). */
  terminals: readonly { code: string; lat: number | null; lng: number | null }[];
  /** Place nodes of the road snapshot (landmark qualifiers, termini, feeder place names). */
  roadPlaces: readonly PlaceNode[];
  /** Places of the committed OSM places snapshot (feeder `osm_places_snapshot` anchors). */
  osmPlaces: readonly { key: string; lat: number; lng: number }[];
};

export type TerminusResolution = { place: string; reason: string; point: LatLng | null; note: string };

export type TraceRulesProvenance = {
  landmarks: { item: string; rule: string; reason: string; resolved: boolean; note: string }[];
  termini: { routeCode: string; place: string; reason: string; resolved: boolean; note: string }[];
  placeTerminalFallback: Record<string, string>;
};

export type TraceContext = {
  landmarks: Readonly<Record<string, LatLng | null>>;
  resolutions: Readonly<Record<string, LandmarkResolution>>;
  /** A street-list trace input (open lists get the route's terminus; circuits close). */
  streetListInput(routeCode: string, direction: string, streets: readonly string[], opts?: { pins?: readonly LatLng[] }): TraceInput;
  /** A feeder trace input from the seed's anchors. */
  anchorInput(anchors: readonly SeedAnchor[]): TraceInput;
  terminusOf(routeCode: string): TerminusResolution | null;
  provenance(): TraceRulesProvenance;
};

export function buildTraceContext(ctx: TraceContextInput): TraceContext {
  const resolutions = resolveRouteLandmarks(ROUTE_LANDMARKS, {
    terminals: ctx.terminals, graph: ctx.graph, boundary: ctx.boundary, aliases: ctx.aliases, places: ctx.roadPlaces,
  });
  const landmarks = Object.fromEntries(Object.entries(resolutions).map(([k, v]) => [k, v.point]));

  /** Points of the listed terminals of a street list (landmark rules of kind "terminal" that resolved). */
  const terminalsOf = (streets: readonly string[]): LatLng[] =>
    [...new Set(streets)].flatMap((n) => (ROUTE_LANDMARKS[n]?.kind === "terminal" && landmarks[n] ? [landmarks[n]!] : []));

  const terminusOf = (code: string): TerminusResolution | null => {
    const rule = ROUTE_TERMINI[code];
    if (!rule) return null;
    const r = resolvePlaceName(ctx.roadPlaces, rule.place);
    return r.status === "resolved"
      ? { ...rule, point: { lat: r.place.lat, lng: r.place.lng }, note: `place node ${r.place.id}` }
      : { ...rule, point: null, note: `${r.reason} (${r.candidates.length} candidate(s)); the street's far end is used` };
  };

  const streetListInput: TraceContext["streetListInput"] = (routeCode, direction, streets, opts = {}) => {
    const open = direction === "inbound" || direction === "outbound";
    const terminus = open ? terminusOf(routeCode)?.point ?? null : null;
    return {
      streets,
      landmarks,
      terminals: terminalsOf(streets),
      ...(opts.pins && opts.pins.length > 0 ? { pins: opts.pins } : {}),
      ...(open ? { termini: direction === "inbound" ? { start: terminus } : { end: terminus } } : {}),
      isCircular: !open,
    };
  };

  const anchorInput = (anchors: readonly SeedAnchor[]): TraceInput => ({
    streets: [],
    isCircular: false,
    anchors: anchors.map((a): TraceAnchor => {
      if (a.kind === "junction") return { kind: "junction", streets: a.streets };
      if (a.kind === "osm_places_snapshot") {
        const p = ctx.osmPlaces.find((x) => x.key === a.key);
        return p ? { kind: "point", label: a.key, at: { lat: p.lat, lng: p.lng } } : { kind: "unresolved", label: a.key };
      }
      if (a.kind === "osm_place") return { kind: "unresolved", label: `osm:${a.osmType}/${a.osmId}` };
      const r = resolvePlaceName(ctx.roadPlaces, a.name);
      if (r.status === "resolved") return { kind: "point", label: a.name, at: { lat: r.place.lat, lng: r.place.lng } };
      const t = ctx.terminals.find((x) => x.code === PLACE_TERMINAL_FALLBACK[a.name]);
      if (t && t.lat !== null && t.lng !== null) return { kind: "point", label: `${a.name} (${t.code})`, at: { lat: t.lat, lng: t.lng } };
      return { kind: "unresolved", label: a.name };
    }),
  });

  const provenance = (): TraceRulesProvenance => ({
    landmarks: Object.keys(ROUTE_LANDMARKS).sort().map((item) => {
      const rule = ROUTE_LANDMARKS[item]!;
      const res = resolutions[item]!;
      return { item, rule: rule.kind, reason: rule.reason, resolved: res.point !== null, note: res.note };
    }),
    termini: Object.keys(ROUTE_TERMINI).sort().map((routeCode) => {
      const t = terminusOf(routeCode)!;
      return { routeCode, place: t.place, reason: t.reason, resolved: t.point !== null, note: t.note };
    }),
    placeTerminalFallback: { ...PLACE_TERMINAL_FALLBACK },
  });

  return { landmarks, resolutions, streetListInput, anchorInput, terminusOf, provenance };
}
