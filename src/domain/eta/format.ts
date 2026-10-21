// Copy for time estimates (D12). Durations only, always labelled as an estimate: never a clock
// time, never "arriving" or "ETA". The peak note names the peak windows (clock times of the
// windows, not of the trip). Pure.
import { en, type Dict } from "@/i18n/dict";
import { type EtaEstimate, type EtaLeg, type EtaMode, type EtaTotal } from "./eta";

/** The English copy shown when no time estimate can be made (no model on file); screens use `t.eta.timeNotAvailable`. */
export const TIME_NOT_AVAILABLE = en.eta.timeNotAvailable;

/** 5 → "5 min"; 60 → "1 h"; 65 → "1 h 5 min". */
export function formatDuration(min: number, copy: Dict["eta"] = en.eta): string {
  if (min < 60) return copy.min(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? copy.hours(h) : copy.hoursMin(h, m);
}

/**
 * "12–18 min", "32–61 min" (minutes while the low end is below 60); both ends from 60:
 * "1 h 5 min – 1 h 30 min" (spaced en dash, so "min–1" never reads as "minus 1").
 */
export function formatRange(lowMin: number, highMin: number, copy: Dict["eta"] = en.eta): string {
  if (lowMin < 60) return copy.rangeMin(lowMin, highMin);
  return copy.rangeLong(formatDuration(lowMin, copy), formatDuration(highMin, copy));
}

const spokenDuration = (min: number, copy: Dict["eta"]) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = copy.spokenHours(h);
  const minutes = copy.spokenMinutes(m);
  return h === 0 ? minutes : m === 0 ? hours : copy.spokenBoth(hours, minutes);
};

/** Accessible label for a range: "32 to 61 minutes"; "1 hour 5 minutes to 1 hour 30 minutes". */
export function formatRangeLabel(lowMin: number, highMin: number, copy: Dict["eta"] = en.eta): string {
  if (lowMin < 60) return copy.spokenRangeMin(lowMin, highMin);
  return copy.spokenRangeLong(spokenDuration(lowMin, copy), spokenDuration(highMin, copy));
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Mode names in "… time not estimated" copy (lower case mid-sentence). */
const notEstimated = (modes: readonly EtaMode[], copy: Dict["eta"]) => copy.notEstimated(modes.map((m) => copy.modeName[m]).join(copy.modesJoin));

export const TRICYCLE_NOT_ESTIMATED = capitalise(notEstimated(["tricycle"], en.eta));

/** "Estimate 18–27 min + waiting (unknown)" ("+ waiting (unknown, 2 rides)" for several rides), "Estimate 14–18 min walk", "… · tricycle time not estimated" (named by mode). */
export function formatTotal(t: EtaTotal, copy: Dict["eta"] = en.eta): string {
  const waiting = t.rides === 0 ? "" : t.rides === 1 ? copy.waitingOne : copy.waitingMany(t.rides);
  if (t.lowMin === null || t.highMin === null) return `${capitalise(notEstimated(t.unestimatedModes, copy))}${waiting}`;
  if (t.highMin === 0 && t.walkOnly && !t.partial) return copy.noWalking; // only 0 m walks: nothing to estimate
  const walk = t.walkOnly ? copy.walkSuffix : "";
  const partial = t.partial ? copy.partialSep(notEstimated(t.unestimatedModes, copy)) : "";
  return `${copy.estimatePrefix}${formatRange(t.lowMin, t.highMin, copy)}${walk}${waiting}${partial}`;
}

/** "Peak hours: slower (06:00–08:00)", or null off-peak. */
export function formatPeakNote(t: EtaTotal, copy: Dict["eta"] = en.eta): string | null {
  if (!t.peak) return null;
  return copy.peakNote(t.peakWindows.map((w) => `${w.start}–${w.end}`).join(", "));
}

/** "≈ 14–18 min walk", "≈ 12–18 min ride", or "Tricycle time not estimated" (the leg's mode). */
export function formatLeg(l: EtaLeg, copy: Dict["eta"] = en.eta): string {
  if (!l.estimated || l.lowMin === null || l.highMin === null) return capitalise(notEstimated([l.mode === "walk" ? "tricycle" : l.mode], copy));
  if (l.kind === "walk" && l.lowMin === 0 && l.highMin === 0) return copy.noWalking;
  const range = formatRange(l.lowMin, l.highMin, copy);
  return l.kind === "walk" ? copy.legWalk(range) : copy.legRide(range);
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
export function formatRemaining(r: { lowMin: number; highMin: number }, kind: RemainingKind, copy: Dict["eta"] = en.eta): string {
  const range = formatRange(r.lowMin, r.highMin, copy);
  return kind === "riding" ? copy.remainingRiding(range) : copy.remainingTrip(range);
}
