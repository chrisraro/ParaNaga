// Throttle for the guidance screens' polite live region. Pure.
//
// GPS changes the walk view's `live` text on every fix, and under jitter it flips between the
// distance, "Close to …" and the step title (a fix crossing the 50 m usability gate or
// the near-target radius). A screen reader must not be flooded, so within a step (the announcer is
// reset whenever focus moves to the step heading, which reads the title):
//  - a fall-back to the title is never announced (the heading already said it);
//  - the first "Close to …" is announced at once, then latched: never again in the step;
//  - a distance is announced only once ANNOUNCE_MS have passed since the last announcement (or
//    the step start) AND it moved by DISTANCE_ANNOUNCE_M since the last announced distance;
//  - any other change (a GPS stop count) at most once per ANNOUNCE_MS.
// So after the first proposal no two announcements are ever closer than ANNOUNCE_MS. The
// assertive "Para! Next stop is yours" never goes through here: it is its own role="alert".

import type { GuidanceView } from "./view";

export const ANNOUNCE_MS = 15_000;
/** Kept for the brief's wording: distance updates at most every 15 s. */
export const DISTANCE_ANNOUNCE_MS = ANNOUNCE_MS;
export const DISTANCE_ANNOUNCE_M = 50;

export type LiveKind = "fallback" | "proposal" | "distance" | "change";

export type Announcer = {
  /** When the last announcement (or the step start) happened. */
  at: number;
  /** The last text announced (or recorded at the step start). */
  text: string | null;
  /** The last announced walk distance in this step. */
  distance: number | null;
  proposalSaid: boolean;
};

const DISTANCE = /^(?:≈ (\d+)|Under 10) m to (.+)$/;

/** The metres of a straight-line walk distance line (0 for "Under 10 m"), else null. */
export function walkDistanceOf(text: string): number | null {
  const m = DISTANCE.exec(text);
  if (!m) return null;
  return m[1] === undefined ? 0 : Number(m[1]);
}

/** What kind of polite change a view's live text is. */
export function liveKind(view: GuidanceView): LiveKind {
  if (view.screen === "ended") return "change";
  const text = view.live.text;
  if (view.screen === "walk") {
    if (text === view.title) return "fallback";
    if (text.startsWith("Close to")) return "proposal";
    if (walkDistanceOf(text) !== null) return "distance";
  }
  return "change";
}

/** A new step (focus moved to its heading): `text` was read through the heading, so only recorded. */
export function resetAnnouncer(text: string | null, now: number): Announcer {
  return { at: now, text, distance: text === null ? null : walkDistanceOf(text), proposalSaid: false };
}

/** The announcer after `text`, and what to say now (null: stay quiet). */
export function nextPolite(state: Announcer, text: string, kind: LiveKind, now: number): { state: Announcer; say: string | null } {
  const quiet = { state, say: null };
  if (text === state.text || kind === "fallback") return quiet;
  if (kind === "proposal") {
    if (state.proposalSaid) return quiet;
    return { state: { ...state, at: now, text, proposalSaid: true }, say: text };
  }
  if (now - state.at < ANNOUNCE_MS) return quiet;
  if (kind === "distance") {
    const meters = walkDistanceOf(text)!;
    if (state.distance !== null && Math.abs(meters - state.distance) < DISTANCE_ANNOUNCE_M) return quiet;
    return { state: { ...state, at: now, text, distance: meters }, say: text };
  }
  return { state: { ...state, at: now, text }, say: text };
}
