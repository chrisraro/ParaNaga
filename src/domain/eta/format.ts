// Copy for time estimates (D12). Durations only, always labelled as an estimate: never a clock
// time, never "arriving" or "ETA". The peak note names the peak windows (clock times of the
// windows, not of the trip). Pure.
import type { RouteMode } from "../modes/fleet";
import { type EtaEstimate, type EtaLeg, type EtaTotal } from "./eta";

/** 5 → "5 min"; 60 → "1 h"; 65 → "1 h 5 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * "12–18 min", "32–61 min" (minutes while the low end is below 60); both ends from 60:
 * "1 h 5 min – 1 h 30 min" (spaced en dash, so "min–1" never reads as "minus 1").
 */
export function formatRange(lowMin: number, highMin: number): string {
  if (lowMin < 60) return `${lowMin}–${highMin} min`;
  return `${formatDuration(lowMin)} – ${formatDuration(highMin)}`;
}

const spokenDuration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  const minutes = `${m} ${m === 1 ? "minute" : "minutes"}`;
  return h === 0 ? minutes : m === 0 ? hours : `${hours} ${minutes}`;
};

/** Accessible label for a range: "32 to 61 minutes"; "1 hour 5 minutes to 1 hour 30 minutes". */
export function formatRangeLabel(lowMin: number, highMin: number): string {
  if (lowMin < 60) return `${lowMin} to ${highMin} minutes`;
  return `${spokenDuration(lowMin)} to ${spokenDuration(highMin)}`;
}

/** Mode names in "… time not estimated" copy (lower case mid-sentence). */
const MODE_NAME: Readonly<Record<RouteMode, string>> = {
  jeepney: "jeepney",
  tricycle: "tricycle",
  uv_express: "UV Express",
  bus: "bus",
  rail: "train",
};
const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const notEstimated = (modes: readonly RouteMode[]) => `${modes.map((m) => MODE_NAME[m]).join(" and ")} time not estimated`;

export const TRICYCLE_NOT_ESTIMATED = capitalise(notEstimated(["tricycle"]));

/** "Estimate 18–27 min + waiting (unknown)" ("+ waiting (unknown, 2 rides)" for several rides), "Estimate 14–18 min walk", "… · tricycle time not estimated" (named by mode). */
export function formatTotal(t: EtaTotal): string {
  const waiting = t.rides === 0 ? "" : t.rides === 1 ? " + waiting (unknown)" : ` + waiting (unknown, ${t.rides} rides)`;
  if (t.lowMin === null || t.highMin === null) return `${capitalise(notEstimated(t.unestimatedModes))}${waiting}`;
  const walk = t.walkOnly ? " walk" : "";
  const partial = t.partial ? ` · ${notEstimated(t.unestimatedModes)}` : "";
  return `Estimate ${formatRange(t.lowMin, t.highMin)}${walk}${waiting}${partial}`;
}

/** "Peak hours · slower estimate (06:00–08:00)", or null off-peak. */
export function formatPeakNote(t: EtaTotal): string | null {
  if (!t.peak) return null;
  return `Peak hours · slower estimate (${t.peakWindows.map((w) => `${w.start}–${w.end}`).join(", ")})`;
}

/** "≈ 14–18 min walk", "≈ 12–18 min ride", or "Tricycle time not estimated" (the leg's mode). */
export function formatLeg(l: EtaLeg): string {
  if (!l.estimated || l.lowMin === null || l.highMin === null) return capitalise(notEstimated([l.mode === "walk" ? "tricycle" : l.mode]));
  return `≈ ${formatRange(l.lowMin, l.highMin)} ${l.kind === "walk" ? "walk" : "ride"}`;
}

export type RemainingKind = "trip" | "riding";

/**
 * The estimated time of legs fromLeg… (rides only for "riding"): the sum of their displayed ranges; null when no
 * such estimated leg is left. Waiting stays outside.
 */
export function remainingRange(e: EtaEstimate, fromLeg: number, kind: RemainingKind): { lowMin: number; highMin: number } | null {
  const legs = e.legs.slice(fromLeg).filter((l) => l.estimated && (kind === "trip" || l.kind === "ride"));
  if (legs.length === 0) return null;
  return { lowMin: legs.reduce((s, l) => s + l.lowMin!, 0), highMin: legs.reduce((s, l) => s + l.highMin!, 0) };
}

/** "About 10–16 min left (estimate)" / "About 10–16 min of riding left (estimate)". */
export function formatRemaining(r: { lowMin: number; highMin: number }, kind: RemainingKind): string {
  return `About ${formatRange(r.lowMin, r.highMin)} ${kind === "riding" ? "of riding " : ""}left (estimate)`;
}
