// Throttle for the guidance screens' polite live region. Pure.
//
// The walk distance with GPS changes on every fix; a screen reader must not be flooded with it.
// A distance update (the same "≈ N m to {stop} in a straight line" line with another N) is
// announced only once DISTANCE_ANNOUNCE_MS have passed AND it moved by DISTANCE_ANNOUNCE_M since
// the last announced distance. Any other change (a new step, a proposal such as "You look
// close to …", a stop count) is announced at once. The assertive "Para! Next stop is yours" never
// goes through here: it is its own role="alert".

export const DISTANCE_ANNOUNCE_MS = 15_000;
export const DISTANCE_ANNOUNCE_M = 50;

export type Announcement = { text: string; at: number };

const DISTANCE = /^(?:≈ (\d+)|Under 10) m to (.+) in a straight line$/;

/** The metres of a straight-line walk distance line (0 for "Under 10 m"), else null. */
export function walkDistanceOf(text: string): number | null {
  const m = DISTANCE.exec(text);
  if (!m) return null;
  return m[1] === undefined ? 0 : Number(m[1]);
}

const distanceTarget = (text: string): string | null => DISTANCE.exec(text)?.[2] ?? null;

/** What to announce now, or null to stay quiet (same text, or a distance update held back). */
export function nextPoliteAnnouncement(prev: Announcement | null, text: string, now: number): Announcement | null {
  if (prev && prev.text === text) return null;
  const meters = walkDistanceOf(text);
  const prevMeters = prev ? walkDistanceOf(prev.text) : null;
  if (prev && meters !== null && prevMeters !== null && distanceTarget(text) === distanceTarget(prev.text)) {
    if (now - prev.at < DISTANCE_ANNOUNCE_MS || Math.abs(meters - prevMeters) < DISTANCE_ANNOUNCE_M) return null;
  }
  return { text, at: now };
}
