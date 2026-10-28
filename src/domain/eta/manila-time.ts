// Asia/Manila wall-clock minutes and peak-window overlap (D9). Pure.
//
// Manila is fixed UTC+8 with no daylight saving, so its time of day is computed from the UTC
// epoch alone: the host's time zone (Date#getHours, Intl) is never consulted.

export const MANILA_UTC_OFFSET_MIN = 480;
const DAY_MIN = 1440;

/** A peak window in Manila clock time, "HH:MM". */
export type ClockWindow = { start: string; end: string };

/** Minutes since Manila midnight, in [0, 1440), fractional below a minute. Throws on an invalid date. */
export function manilaMinutesOfDay(date: Date): number {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("invalid date");
  const m = (ms / 60_000 + MANILA_UTC_OFFSET_MIN) % DAY_MIN;
  return m < 0 ? m + DAY_MIN : m;
}

/** "HH:MM" → minutes since midnight. */
export function clockMinutes(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) throw new RangeError(`not a clock time: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The windows that the trip interval [departure, departure + durHighMin] touches, each once, in
 * the given order. A window is [start, end): a trip that ends exactly at a window's start counts
 * (conservative), one that starts exactly at its end does not. Windows recur every day (A3), so a
 * trip that runs past midnight reaches the next day's windows; a window whose end is not after its
 * start is read as crossing midnight.
 */
export function peakWindowsHit(departure: Date, durHighMin: number, windows: readonly ClockWindow[]): ClockWindow[] {
  if (!Number.isFinite(durHighMin) || durHighMin < 0) throw new RangeError("duration must be a non-negative number");
  const from = manilaMinutesOfDay(departure);
  const to = from + durHighMin;
  const lastDay = Math.floor(to / DAY_MIN);
  return windows.filter((w) => {
    const s = clockMinutes(w.start);
    let e = clockMinutes(w.end);
    if (e <= s) e += DAY_MIN;
    for (let day = -1; day <= lastDay; day++) {
      const off = day * DAY_MIN;
      if (from < e + off && to >= s + off) return true;
    }
    return false;
  });
}

/** "3:45 PM": the Manila wall-clock time of an instant (epoch ms), to the minute. Same in every language. */
export function formatManilaClock(epochMs: number): string {
  const total = Math.floor(manilaMinutesOfDay(new Date(epochMs)));
  const h24 = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, "0");
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** True when [departure, departure + durHighMin] touches any peak window (see peakWindowsHit). */
export function inPeakWindow(departure: Date, durHighMin: number, windows: readonly ClockWindow[]): boolean {
  return peakWindowsHit(departure, durHighMin, windows).length > 0;
}
