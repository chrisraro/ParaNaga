// The jeepney soft service window (plan E §E, E-J7). Pure.
//
// No official or news source gives first/last trips or headways; weak sources put jeepneys at about
// 05:00–21:00 (RH08, RH09, RH01, RH10) and the owner reports some start about 5 am or before (U02).
// So this is one city-wide constant, shown only as unconfirmed: it warns, it never hides an option
// and never promises a trip. The clock is Manila time from the epoch (manila-time.ts), never the
// host's zone.
import { en, type Dict } from "@/i18n/dict";
import { clockMinutes, manilaMinutesOfDay } from "./manila-time";

export const JEEPNEY_SOFT_WINDOW = {
  start: "05:00",
  end: "21:00",
  sourceCodes: ["RH08", "RH09", "RH01", "RH10", "U02"],
  basis: "Weak sources; no official timetable",
} as const;

/** The one-line hint beside the warning (E-J7: a constant, not data). */
export const SERVICE_WINDOW_HINT = en.eta.serviceHint;

/** The last hour before the window's end. */
const LAST_TRIPS_MIN = 60;

export type ServiceWindowNote = { state: "before_start" | "last_trips" | "after_end"; hint: string; lines: string[] };

/** The warning for a jeepney ride starting at `now`, or null inside the usual hours (or an invalid clock). */
export function serviceWindowNote(now: Date, copy: Dict["eta"] = en.eta): ServiceWindowNote | null {
  if (!Number.isFinite(now.getTime())) return null;
  const m = manilaMinutesOfDay(now);
  const start = clockMinutes(JEEPNEY_SOFT_WINDOW.start);
  const end = clockMinutes(JEEPNEY_SOFT_WINDOW.end);
  if (m < start) return { state: "before_start", hint: copy.serviceHint, lines: [copy.serviceOutside, copy.serviceEarly] };
  if (m >= end) return { state: "after_end", hint: copy.serviceHint, lines: [copy.serviceOutside] };
  if (m >= end - LAST_TRIPS_MIN) return { state: "last_trips", hint: copy.serviceHint, lines: [copy.serviceLastTrips] };
  return null;
}

/** The note for an option: only when it rides a jeepney (walk, tricycle, padyak and other modes have no window). */
export function optionServiceWindowNote(option: { legs: readonly { kind: string; mode?: string }[] }, now: Date, copy: Dict["eta"] = en.eta): ServiceWindowNote | null {
  return option.legs.some((l) => l.kind === "ride" && (l.mode ?? "jeepney") === "jeepney") ? serviceWindowNote(now, copy) : null;
}
