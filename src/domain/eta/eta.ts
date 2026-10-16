// Time estimates for a trip option (J3, D8–D12): ranges with their basis, never a single number,
// never a clock time. Pure: the departure instant is injected; Manila time comes from UTC.
//
//   Walk (D8):   d / walk speed … that × the slowdown factor (A1). d = the walk-graph path length
//                when the leg has one, else the leg's round(straight × 1.3) estimate.
//   Jeepney (D9): d / high speed … d / low speed, in the off-peak or the peak band.
//                 Band, decided per trip in two passes: estimate with the off-peak band; if
//                 [departure, departure + displayed total high end] touches a peak window, every ride leg
//                 uses the peak band. A leg that crosses a window boundary is therefore never
//                 split: the whole trip takes the slower band (conservative).
//   Other modes (tricycle, …): no speed is on file (D11): the leg is not estimated and the total
//                 is partial.
//   Waiting (D10): unknown, never added: the total says so once there is a ride.
//
// No model (an older snapshot) or an invalid one gives no estimate, with the reason.
import { etaModelSchema, type EtaModel, type EtaParam } from "../api/schemas";
import type { RouteMode } from "../modes/fleet";
import type { DistanceBasis } from "../planner/graph";
import { basisRows, type BasisRow } from "./basis";
import type { EtaParamKey } from "./params";
import { peakWindowsHit, type ClockWindow } from "./manila-time";

/** The parts of a planner option the estimate reads (a PlanOption satisfies it). */
export type EtaOptionInput = {
  legs: ReadonlyArray<
    | { kind: "walk"; estimateMeters: number }
    | { kind: "ride"; mode: RouteMode; distanceMeters: number; distanceBasis: DistanceBasis }
  >;
};

export type EtaLegBasis = "graph_path" | "straight_x1_3" | "approximate_path" | "stop_to_stop";
export type EtaBand = "offpeak" | "peak";

export type EtaLeg = {
  kind: "walk" | "ride";
  mode: "walk" | RouteMode;
  /** The distance the time is computed on, in metres. */
  meters: number;
  basis: EtaLegBasis;
  /** Ride band used; null for walks and for legs that are not estimated. */
  band: EtaBand | null;
  estimated: boolean;
  /** Whole minutes rounded outward (see roundRange); null when not estimated. */
  lowMin: number | null;
  highMin: number | null;
  /** Unrounded minutes (diagnostics; totals and time left sum the rounded ranges). */
  rawLowMin: number | null;
  rawHighMin: number | null;
};

export type EtaTotal = {
  /** Sum of the estimated legs' displayed (rounded) ranges; null when no leg is estimated. Waiting is not in it. */
  lowMin: number | null;
  highMin: number | null;
  rawLowMin: number | null;
  rawHighMin: number | null;
  rides: number;
  /** Every ride has an unknown boarding wait (no published headways); shown, never estimated. */
  waitUnknown: boolean;
  walkOnly: boolean;
  /** A leg is not estimated (a tricycle or another mode without a speed). */
  partial: boolean;
  peak: boolean;
  /** The ride band used; null when no jeepney leg is estimated. */
  band: EtaBand | null;
  /** The peak windows the trip touches (empty off-peak). */
  peakWindows: ClockWindow[];
};

export type EtaEstimate = { legs: EtaLeg[]; total: EtaTotal; basis: BasisRow[] };

export type EtaUnavailableReason = "no_model" | "invalid_model" | "invalid_departure" | "invalid_leg";
export type EtaResult = { ok: true; estimate: EtaEstimate } | { ok: false; reason: EtaUnavailableReason };

const EPS = 1e-9;

/** Whole minutes, rounded outward: floor(low) … ceil(high), at least 1, and the high end above the low end. */
export function roundRange(rawLow: number, rawHigh: number): { lowMin: number; highMin: number } {
  const lowMin = Math.max(1, Math.floor(rawLow + EPS));
  const highMin = Math.max(lowMin + 1, Math.ceil(rawHigh - EPS));
  return { lowMin, highMin };
}

type Speeds = { walkKmh: number; slowLow: number; slowHigh: number; off: [number, number]; peak: [number, number]; windows: ClockWindow[] };

/** The checked parameters, or null when the model cannot give an honest estimate. */
function readModel(model: EtaModel): Speeds | null {
  const parsed = etaModelSchema.safeParse(model);
  if (!parsed.success) return null;
  const by = new Map<EtaParamKey, EtaParam>(parsed.data.params.map((p) => [p.key, p]));
  const walk = by.get("walk_speed_kmh");
  const slow = by.get("walk_slowdown_factor");
  const off = by.get("jeepney_speed_offpeak_kmh");
  const peak = by.get("jeepney_speed_peak_kmh");
  const win = by.get("peak_windows");
  if (!walk || !slow || !off || !peak || !win?.windows) return null;
  if (walk.unit !== "km_per_h" || off.unit !== "km_per_h" || peak.unit !== "km_per_h" || slow.unit !== "factor") return null;
  const vals = [walk.low, slow.low, slow.high, off.low, off.high, peak.low, peak.high];
  if (!vals.every((v): v is number => v !== null && Number.isFinite(v) && v > 0)) return null;
  // A slowdown below 1 would make walking faster than the sourced speed; a peak band faster than
  // off-peak would break "peak ≥ off-peak".
  if (slow.low! < 1 || peak.low! > off.low! || peak.high! > off.high!) return null;
  return {
    walkKmh: walk.low!,
    slowLow: slow.low!,
    slowHigh: slow.high!,
    off: [off.low!, off.high!],
    peak: [peak.low!, peak.high!],
    windows: win.windows,
  };
}

const minutesAt = (meters: number, kmh: number) => (meters / 1000 / kmh) * 60;
const validMeters = (m: unknown): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0;

/**
 * Estimates `option` departing at `departure`. `walkLengths[i]` is the walk-graph path length of
 * leg i in metres (null/absent: no graph path, the leg's ×1.3 estimate is used).
 */
export function estimateOption(
  option: EtaOptionInput,
  walkLengths: ReadonlyArray<number | null | undefined>,
  model: EtaModel | null | undefined,
  departure: Date,
): EtaResult {
  if (!model) return { ok: false, reason: "no_model" };
  const s = readModel(model);
  if (!s) return { ok: false, reason: "invalid_model" };
  if (!Number.isFinite(departure.getTime())) return { ok: false, reason: "invalid_departure" };
  if (option.legs.length === 0) return { ok: false, reason: "invalid_leg" };

  const legsAt = (band: EtaBand): EtaLeg[] | null => {
    const out: EtaLeg[] = [];
    for (const [i, leg] of option.legs.entries()) {
      if (leg.kind === "walk") {
        const graph = walkLengths[i];
        if (graph !== null && graph !== undefined && !validMeters(graph)) return null;
        const onGraph = graph !== null && graph !== undefined;
        const meters = onGraph ? graph : leg.estimateMeters;
        if (!validMeters(meters)) return null;
        const low = minutesAt(meters, s.walkKmh) * s.slowLow;
        const high = minutesAt(meters, s.walkKmh) * s.slowHigh;
        out.push({ kind: "walk", mode: "walk", meters, basis: onGraph ? "graph_path" : "straight_x1_3", band: null, estimated: true, ...roundRange(low, high), rawLowMin: low, rawHighMin: high });
        continue;
      }
      if (!validMeters(leg.distanceMeters)) return null;
      const basis: EtaLegBasis = leg.distanceBasis === "approximate_path" ? "approximate_path" : "stop_to_stop";
      if (leg.mode !== "jeepney") {
        out.push({ kind: "ride", mode: leg.mode, meters: leg.distanceMeters, basis, band: null, estimated: false, lowMin: null, highMin: null, rawLowMin: null, rawHighMin: null });
        continue;
      }
      const [slowKmh, fastKmh] = band === "peak" ? s.peak : s.off;
      const low = minutesAt(leg.distanceMeters, fastKmh);
      const high = minutesAt(leg.distanceMeters, slowKmh);
      out.push({ kind: "ride", mode: "jeepney", meters: leg.distanceMeters, basis, band, estimated: true, ...roundRange(low, high), rawLowMin: low, rawHighMin: high });
    }
    return out;
  };

  const sum = (legs: EtaLeg[], f: (l: EtaLeg) => number | null) => legs.reduce((acc, l) => acc + (f(l) ?? 0), 0);

  // Pass 1: off-peak. Pass 2: the peak band for every ride when the trip touches a window.
  const offLegs = legsAt("offpeak");
  if (!offLegs) return { ok: false, reason: "invalid_leg" };
  const hasJeepney = offLegs.some((l) => l.band !== null);
  // The window test uses the displayed (rounded) total high end: the same number the rider sees.
  const hit = hasJeepney ? peakWindowsHit(departure, sum(offLegs, (l) => l.highMin), s.windows) : [];
  const peak = hit.length > 0;
  const legs = peak ? legsAt("peak")! : offLegs;

  const estimated = legs.filter((l) => l.estimated);
  const rawLow = estimated.length > 0 ? sum(estimated, (l) => l.rawLowMin) : null;
  const rawHigh = estimated.length > 0 ? sum(estimated, (l) => l.rawHighMin) : null;
  // The total is the sum of the displayed leg ranges, so adding up the legs gives the same numbers.
  const rounded = estimated.length > 0
    ? { lowMin: sum(estimated, (l) => l.lowMin), highMin: sum(estimated, (l) => l.highMin) }
    : { lowMin: null, highMin: null };
  const rides = legs.filter((l) => l.kind === "ride").length;

  return {
    ok: true,
    estimate: {
      legs,
      total: {
        ...rounded,
        rawLowMin: rawLow,
        rawHighMin: rawHigh,
        rides,
        waitUnknown: rides > 0,
        walkOnly: rides === 0,
        partial: estimated.length < legs.length,
        peak,
        band: hasJeepney ? (peak ? "peak" : "offpeak") : null,
        peakWindows: hit,
      },
      basis: basisRows(model),
    },
  };
}
