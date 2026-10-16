// Copy for time estimates (D12). Durations only, always labelled as an estimate: never a clock
// time, never "arriving" or "ETA". The peak note names the peak windows (clock times of the
// windows, not of the trip). Pure.
import { roundRange, type EtaEstimate, type EtaLeg, type EtaTotal } from "./eta";

/** 5 → "5 min"; 60 → "1 h"; 65 → "1 h 5 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "12–18 min"; from 60 min each end is written out: "50 min–1 h 5 min". */
export function formatRange(lowMin: number, highMin: number): string {
  if (highMin < 60) return `${lowMin}–${highMin} min`;
  return `${formatDuration(lowMin)}–${formatDuration(highMin)}`;
}

export const TRICYCLE_NOT_ESTIMATED = "Tricycle time not estimated";
const WAITING = " + waiting (unknown)";

/** "Estimate 18–27 min + waiting (unknown)", "Estimate 14–18 min walk", "… · tricycle time not estimated". */
export function formatTotal(t: EtaTotal): string {
  const waiting = t.rides > 0 ? WAITING : "";
  if (t.lowMin === null || t.highMin === null) return `${TRICYCLE_NOT_ESTIMATED}${waiting}`;
  const walk = t.walkOnly ? " walk" : "";
  const partial = t.partial ? " · tricycle time not estimated" : "";
  return `Estimate ${formatRange(t.lowMin, t.highMin)}${walk}${waiting}${partial}`;
}

/** "Peak hours · slower estimate (06:00–08:00)", or null off-peak. */
export function formatPeakNote(t: EtaTotal): string | null {
  if (!t.peak) return null;
  return `Peak hours · slower estimate (${t.peakWindows.map((w) => `${w.start}–${w.end}`).join(", ")})`;
}

/** "≈ 14–18 min walk", "≈ 12–18 min ride", or "Tricycle time not estimated". */
export function formatLeg(l: EtaLeg): string {
  if (!l.estimated || l.lowMin === null || l.highMin === null) return TRICYCLE_NOT_ESTIMATED;
  return `≈ ${formatRange(l.lowMin, l.highMin)} ${l.kind === "walk" ? "walk" : "ride"}`;
}

export type RemainingKind = "trip" | "riding";

/**
 * The estimated time of legs fromLeg… (rides only for "riding"), rounded outward; null when no
 * such estimated leg is left. Waiting stays outside.
 */
export function remainingRange(e: EtaEstimate, fromLeg: number, kind: RemainingKind): { lowMin: number; highMin: number } | null {
  const legs = e.legs.slice(fromLeg).filter((l) => l.estimated && (kind === "trip" || l.kind === "ride"));
  if (legs.length === 0) return null;
  return roundRange(legs.reduce((s, l) => s + l.rawLowMin!, 0), legs.reduce((s, l) => s + l.rawHighMin!, 0));
}

/** "About 10–16 min left (estimate)" / "About 10–16 min of riding left (estimate)". */
export function formatRemaining(r: { lowMin: number; highMin: number }, kind: RemainingKind): string {
  return `About ${formatRange(r.lowMin, r.highMin)} ${kind === "riding" ? "of riding " : ""}left (estimate)`;
}
