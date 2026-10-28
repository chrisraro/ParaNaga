// The words for a trip status (trip-status.ts): the progress bar's texts and the arrival line. Pure.
//
// The arrival line is always a range ("≈ 8–12 min · arrive about 3:45 PM"), starting with "≈" so a
// duration is never shown bare. A trip with a leg that has no time on file (a tricycle) shows the
// range of the rest, says which mode is not estimated, and gives no clock time. With no estimate at
// all it says so; it never shows a precise-looking number it does not have.
import type { Dict } from "@/i18n/dict";
import { formatManilaClock } from "../eta/manila-time";
import { formatRange } from "../eta/format";
import { formatDistance } from "../trip/present";
import type { TripStatus } from "./trip-status";

export type TripStatusText = {
  /** aria-valuetext of the bar. */
  valueText: string;
  /** "42% done · ≈ 1.2 km left". */
  progressText: string;
  /** "≈ 8–12 min · arrive about 3:45 PM", or why there is none. */
  etaText: string;
  /** The basis of the estimate, with the unknown wait when a boarding is ahead. */
  caption: string;
};

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function tripStatusText(status: TripStatus, copy: Dict["guidance"], shared: Pick<Dict, "eta" | "geo">): TripStatusText {
  const left = status.remainingMeters === null ? null : formatDistance(status.remainingMeters, shared.geo);
  const progressText = left ? copy.progressLeft(status.percent, left) : copy.progressDone(status.percent);
  const valueText = left ? copy.progressSpokenLeft(status.percent, left.replace(/^≈\s*/, "")) : copy.progressSpoken(status.percent);

  const missing = status.unestimatedModes.length > 0 ? shared.eta.notEstimated(status.unestimatedModes.map((m) => shared.eta.modeName[m]).join(shared.eta.modesJoin)) : null;
  let etaText: string;
  if (status.eta) {
    const range = formatRange(status.eta.lowMin, status.eta.highMin, shared.eta);
    etaText = status.eta.arriveAtMs !== null ? copy.etaLine(range, formatManilaClock(status.eta.arriveAtMs)) : copy.etaPartial(range, missing ?? shared.eta.timeNotAvailable);
  } else {
    etaText = missing ? capitalise(missing) : shared.eta.timeNotAvailable;
  }
  const basis = status.paceUsed ? copy.etaCaptionPace : copy.etaCaption;
  const caption = status.waitPending ? `${basis} ${copy.etaWaitNote}` : basis;
  return { valueText, progressText, etaText, caption };
}
