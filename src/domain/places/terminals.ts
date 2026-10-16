// Terminals layer, terminal detail and the Explore terminals directory (Increment D, Task 13).
// Pure: no DOM, no I/O. Copy follows the task brief and the global constraints (J6, D15, D17):
// a coordinate is community data from OpenStreetMap (ODbL) and never an entrance; regional fares
// are estimates ("operator prices may differ"); a terminal without a coordinate is listed, never
// drawn, as "Location not mapped".
import { ROUTE_MODES, modeName, type RouteMode } from "../modes/fleet";

/** At most this many terminals are drawn as DOM markers; more fall back to one canvas layer. */
export const TERMINAL_DOM_MARKER_LIMIT = 16;

export type TerminalMarkerRender = "dom" | "canvas";

export function terminalMarkerRender(count: number): TerminalMarkerRender {
  return count <= TERMINAL_DOM_MARKER_LIMIT ? "dom" : "canvas";
}

export const isRouteMode = (m: string): m is RouteMode => (ROUTE_MODES as readonly string[]).includes(m);

/** The known modes of a terminal, in its own order (unknown mode strings are dropped). */
export function terminalRouteModes(modes: readonly string[]): RouteMode[] {
  return modes.filter(isRouteMode);
}

/** ["bus", "uv_express"] → "Bus and UV Express"; three or more → "A, B and C". */
export function terminalModesPhrase(modes: readonly string[]): string {
  const names = terminalRouteModes(modes).map(modeName);
  if (names.length <= 1) return names[0] ?? "Transport";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The marker's accessible name: "{name}, {modes} terminal, community-mapped location". */
export function terminalMarkerName(t: { name: string; modes: readonly string[] }): string {
  return `${t.name}, ${terminalModesPhrase(t.modes)} terminal, community-mapped location`;
}

const KIND_LABEL: Record<string, string> = {
  terminal: "Terminal",
  loading_point: "Loading point",
  waiting_area: "Waiting area",
  station: "Station",
};

/** "Loading point", "Waiting area" …; null for a legacy row without a kind. */
export function terminalKindLabel(kind: string | null): string | null {
  return kind ? (KIND_LABEL[kind] ?? null) : null;
}

/** Mode filter shared by the map layer, the Layers sheet list and Explore: empty means all. */
export function terminalMatchesModes(t: { modes: readonly string[] }, modes: readonly RouteMode[]): boolean {
  return modes.length === 0 || t.modes.some((m) => (modes as readonly string[]).includes(m));
}

export type TerminalCoordinateInfo = {
  osmType: "node" | "way";
  osmId: number;
  osmVersion: number | null;
  note: string | null;
};

/** "OSM way/293702439 v6 · centroid, not an entrance" (the version and note only when on file). */
export function terminalOsmLocationText(c: TerminalCoordinateInfo): string {
  const ref = `OSM ${c.osmType}/${c.osmId}${c.osmVersion !== null ? ` v${c.osmVersion}` : ""}`;
  return c.note ? `${ref} · ${c.note}` : ref;
}

/** The trip end that "Directions to here" sets: the coordinate is a map point, never an entrance. */
export function terminalDirectionsLabel(name: string): string {
  return `${name} (map point, entrance not mapped)`;
}

export type RegionalServiceInput = {
  destination: string;
  operators: readonly string[];
  distanceKm: number | null;
  fareEstimate: { text: string };
};

const NO_DISTANCE_SEGMENT = /\s*·\s*distance not on file/i;

function formatKm(km: number): string {
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1);
}

/**
 * The two lines of a regional service row:
 *   "{destination} · {operators}"
 *   "≈ {km} km by the community-mapped route · {fare estimate}" or "Distance not on file · {rates}".
 * The estimate text always ends with "operator prices may differ" (src/domain/fares/regional.ts).
 */
export function regionalServiceRow(s: RegionalServiceInput): { title: string; detail: string } {
  const title = s.operators.length > 0 ? `${s.destination} · ${s.operators.join(", ")}` : `${s.destination} · operator not on file`;
  const detail =
    s.distanceKm === null
      ? `Distance not on file · ${s.fareEstimate.text.replace(NO_DISTANCE_SEGMENT, "")}`
      : `≈ ${formatKm(s.distanceKm)} km by the community-mapped route · ${s.fareEstimate.text}`;
  return { title, detail };
}

/** Markers closer than this on screen (CSS px) are drawn as one group, so no 44 px target overlaps. */
export const TERMINAL_MARKER_SPACING_PX = 48;

export type ScreenPoint = { code: string; x: number; y: number };

/**
 * Single-linkage grouping of marker positions (screen pixels at the current zoom): two terminals
 * closer than `spacing` share a group. Each group is anchored at the member nearest its centroid,
 * so any two anchors are at least `spacing` apart. Groups and members keep the input order.
 */
export function groupScreenPoints(points: readonly ScreenPoint[], spacing = TERMINAL_MARKER_SPACING_PX): { anchor: string; codes: string[] }[] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < spacing) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const groups = new Map<number, ScreenPoint[]>();
  points.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p]);
  });
  return [...groups.values()].map((members) => {
    const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
    const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
    let anchor = members[0]!;
    for (const p of members) if (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(anchor.x - cx, anchor.y - cy)) anchor = p;
    return { anchor: anchor.code, codes: members.map((p) => p.code) };
  });
}

/** A group marker's accessible name: activating it zooms in until its terminals separate. */
export function terminalGroupName(members: readonly { name: string }[]): string {
  return `${members.length} terminals close together: ${members.map((m) => m.name).join("; ")}. Select to see each one`;
}
