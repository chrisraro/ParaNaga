// Offline copy (spec §3.11, Task 12). Pure. The date is always the published date of the data
// this phone actually holds (Naga City calendar date), never "today" and never invented: when the
// phone has no data date, the copy says so.
import { en, type Dict } from "@/i18n/dict";
import { publishedDateText } from "../network/present";

/** "Offline — data from Oct 15, 2026. Fares may have changed." (the app frame's banner) */
export function offlineBannerText(publishedAt: string | null | undefined, hasData: boolean, copy: Dict["pwa"] = en.pwa): string {
  if (!hasData) return copy.offlineNoData;
  const date = publishedDateText(publishedAt);
  return date ? copy.offlineFromDate(date) : copy.offlineFromVisit;
}

/** "Data from Oct 15, 2026. Fares may have changed." (the /offline page) */
export function offlineDataLine(publishedAt: string | null | undefined, hasData: boolean, copy: Dict["pwa"] = en.pwa): string {
  if (!hasData) return copy.dataNone;
  const date = publishedDateText(publishedAt);
  return date ? copy.dataFromDate(date) : copy.dataFromVisit;
}

/**
 * The note on a plan made in the browser from the cached snapshot: "offline" when the phone has no
 * connection, "unreachable" when it has one but ParaNaga's server could not be reached.
 */
export function offlinePlanNote(
  publishedAt: string | null | undefined,
  reason: "offline" | "unreachable" = "offline",
  copy: Dict["pwa"] = en.pwa,
): string {
  const date = publishedDateText(publishedAt);
  if (reason === "unreachable") return date ? copy.planUnreachableDate(date) : copy.planUnreachable;
  return date ? copy.planOfflineDate(date) : copy.planOffline;
}

/** The same note as one short line, for the sheet's peek: "Offline plan, data of Oct 15, 2026". */
export function offlinePlanChip(
  publishedAt: string | null | undefined,
  reason: "offline" | "unreachable" = "offline",
  copy: Dict["pwa"] = en.pwa,
): string {
  const date = publishedDateText(publishedAt);
  const base = reason === "unreachable" ? copy.chipUnreachable : copy.chipOffline;
  return date ? copy.chipDate(base, date) : base;
}

/** A detail panel waiting for the network (useOffline). */
export const OFFLINE_PANEL_TEXT = en.pwa.panelOffline;

/**
 * A walk drawn as a straight dotted line because the phone is offline and has never stored the
 * walk graph (Task 15): it is fetched once, the first time a trip is shown online.
 */
export const WALK_PATHS_OFFLINE_NOTE = en.pwa.walkPathsOffline;
