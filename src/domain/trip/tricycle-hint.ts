// D15 "Tricycle may serve this" hint. Pure: no I/O.
//
// Trigger: a card appears below the trip options (never a ranked option) when either:
//   - a published tricycle terminal with a coordinate lies within 600 m straight-line of the
//     start or destination; or
//   - a published tricycle feeder path passes within 300 m of either.
// Waiting areas without a coordinate (T15, T16) never trigger.
//
// Honesty (J4, D11, D15): no tricycle speed or zone map exists, so a tricycle never gets a minute
// estimate or a drawn ride line; the card always states the ₱15 minimum (Ordinance 2024-002),
// that discounts are not applied, and to confirm with the driver.
import type { Line, Lines, NetworkSnapshot } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { projectOnLine } from "../geo/measure";
import { decodePolyline } from "../geo/polyline";
import type { LatLng } from "../geo/types";
import { formatDistance } from "./present";

export const TRICYCLE_TERMINAL_MAX_M = 600;
export const TRICYCLE_FEEDER_MAX_M = 300;

export const TRICYCLE_HINT_TITLE = "A tricycle may serve this" as const;
export const TRICYCLE_ZONES_NOTE = "Routes and zones are not documented" as const;
export const TRICYCLE_FARE_NOTE =
  "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver" as const;
export const TRICYCLE_TIME_NOTE = "Tricycle time not estimated" as const;

export type TricycleTerminalMatch = {
  code: string;
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
  near: "origin" | "destination";
};

export type TricycleFeederMatch = {
  routeCode: string;
  name: string;
  distanceM: number;
  near: "origin" | "destination";
};

export type TricycleHintCopy = {
  title: typeof TRICYCLE_HINT_TITLE;
  terminalText: string | null;
  feederText: string | null;
  zonesNote: typeof TRICYCLE_ZONES_NOTE;
  fareNote: typeof TRICYCLE_FARE_NOTE;
  timeNote: typeof TRICYCLE_TIME_NOTE;
};

export type TricycleHint = {
  terminal?: TricycleTerminalMatch;
  feeder?: TricycleFeederMatch;
  copy: TricycleHintCopy;
};

type TerminalInput = Pick<NetworkSnapshot["terminals"][number], "code" | "name" | "modes" | "lat" | "lng">;
type LineInput = Pick<Line, "routeCode" | "routeName" | "mode" | "encoded"> & {
  variantName?: string | null;
  coords?: readonly LatLng[];
};

type SnapshotOrTerminals =
  | Pick<NetworkSnapshot, "terminals">
  | { terminals: readonly TerminalInput[] }
  | readonly TerminalInput[]
  | null
  | undefined;

type LinesOrArray =
  | Pick<Lines, "lines">
  | { lines: readonly LineInput[] }
  | readonly LineInput[]
  | null
  | undefined;

export type TricycleHintObjectInput = {
  origin: LatLng;
  destination: LatLng;
  snapshot?: SnapshotOrTerminals;
  terminals?: readonly TerminalInput[] | null;
  lines?: LinesOrArray;
};

function extractTerminals(input: SnapshotOrTerminals): readonly TerminalInput[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if ("terminals" in input) return input.terminals;
  return [];
}

function extractLines(input: LinesOrArray): readonly LineInput[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if ("lines" in input) return input.lines;
  return [];
}

function nearestTricycleTerminal(
  origin: LatLng,
  destination: LatLng,
  terminals: readonly TerminalInput[],
): TricycleTerminalMatch | undefined {
  let best: { code: string; name: string; dist: number; lat: number; lng: number; near: "origin" | "destination" } | null = null;
  for (const t of terminals) {
    if (!t.modes.includes("tricycle")) continue;
    if (t.lat === null || t.lng === null || !Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
    const coord = { lat: t.lat, lng: t.lng };
    const dOrigin = haversineMeters(origin, coord);
    const dDest = haversineMeters(destination, coord);
    const dist = Math.min(dOrigin, dDest);
    if (dist > TRICYCLE_TERMINAL_MAX_M) continue;
    const near: "origin" | "destination" = dOrigin <= dDest ? "origin" : "destination";
    if (best === null || dist < best.dist || (dist === best.dist && t.code < best.code)) {
      best = { code: t.code, name: t.name, dist, lat: t.lat, lng: t.lng, near };
    }
  }
  if (!best) return undefined;
  return {
    code: best.code,
    name: best.name,
    distanceM: Math.round(best.dist),
    lat: best.lat,
    lng: best.lng,
    near: best.near,
  };
}

function nearestTricycleFeeder(
  origin: LatLng,
  destination: LatLng,
  lines: readonly LineInput[],
): TricycleFeederMatch | undefined {
  let best: { routeCode: string; name: string; dist: number; near: "origin" | "destination" } | null = null;
  for (const l of lines) {
    if (l.mode !== "tricycle") continue;
    const coords = l.coords ?? (l.encoded ? decodePolyline(l.encoded) : []);
    if (coords.length < 2) continue;
    const dOrigin = projectOnLine(coords, origin).distM;
    const dDest = projectOnLine(coords, destination).distM;
    const dist = Math.min(dOrigin, dDest);
    if (dist > TRICYCLE_FEEDER_MAX_M) continue;
    const near: "origin" | "destination" = dOrigin <= dDest ? "origin" : "destination";
    const name = l.variantName ?? l.routeName;
    if (
      best === null ||
      dist < best.dist ||
      (dist === best.dist && (l.routeCode < best.routeCode || (l.routeCode === best.routeCode && name < best.name)))
    ) {
      best = { routeCode: l.routeCode, name, dist, near };
    }
  }
  if (!best) return undefined;
  return {
    routeCode: best.routeCode,
    name: best.name,
    distanceM: Math.round(best.dist),
    near: best.near,
  };
}

const endPhrase = (near: "origin" | "destination") => (near === "origin" ? "from your start" : "from your destination");

export function tricycleHint(
  origin: LatLng,
  destination: LatLng,
  snapshotOrTerminals?: SnapshotOrTerminals,
  lines?: LinesOrArray,
): TricycleHint | null;
export function tricycleHint(input: TricycleHintObjectInput): TricycleHint | null;
export function tricycleHint(
  arg1: LatLng | TricycleHintObjectInput,
  arg2?: LatLng,
  arg3?: SnapshotOrTerminals,
  arg4?: LinesOrArray,
): TricycleHint | null {
  let origin: LatLng;
  let destination: LatLng;
  let terminals: readonly TerminalInput[];
  let lines: readonly LineInput[];

  if ("origin" in arg1) {
    origin = arg1.origin;
    destination = arg1.destination;
    terminals = arg1.terminals ?? extractTerminals(arg1.snapshot);
    lines = extractLines(arg1.lines);
  } else {
    if (!arg2) return null;
    origin = arg1;
    destination = arg2;
    terminals = extractTerminals(arg3);
    lines = extractLines(arg4);
  }

  const terminal = nearestTricycleTerminal(origin, destination, terminals);
  const feeder = nearestTricycleFeeder(origin, destination, lines);
  if (!terminal && !feeder) return null;

  const terminalText = terminal
    ? `${terminal.name} (${terminal.code}) · ${formatDistance(terminal.distanceM)} ${endPhrase(terminal.near)}`
    : null;
  const feederText = feeder
    ? `${feeder.name} (${feeder.routeCode}) · ${formatDistance(feeder.distanceM)} ${endPhrase(feeder.near)}`
    : null;

  return {
    ...(terminal ? { terminal } : {}),
    ...(feeder ? { feeder } : {}),
    copy: {
      title: TRICYCLE_HINT_TITLE,
      terminalText,
      feederText,
      zonesNote: TRICYCLE_ZONES_NOTE,
      fareNote: TRICYCLE_FARE_NOTE,
      timeNote: TRICYCLE_TIME_NOTE,
    },
  };
}
