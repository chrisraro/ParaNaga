// Offline copy (spec §3.11, Task 12). Pure. The date is always the published date of the data
// this phone actually holds (Naga City calendar date), never "today" and never invented: when the
// phone has no data date, the copy says so.
import { publishedDateText } from "../network/present";

/** "Offline — data from Oct 15, 2026. Fares may have changed." (the app frame's banner) */
export function offlineBannerText(publishedAt: string | null | undefined, hasData: boolean): string {
  if (!hasData) return "Offline — no transport data saved on this phone yet.";
  const date = publishedDateText(publishedAt);
  return date ? `Offline — data from ${date}. Fares may have changed.` : "Offline — data from your last visit. Fares may have changed.";
}

/** "Data from Oct 15, 2026. Fares may have changed." (the /offline page) */
export function offlineDataLine(publishedAt: string | null | undefined, hasData: boolean): string {
  if (!hasData) return "No transport data is saved on this phone yet.";
  const date = publishedDateText(publishedAt);
  return date ? `Data from ${date}. Fares may have changed.` : "Data from your last visit. Fares may have changed.";
}

/**
 * The note on a plan made in the browser from the cached snapshot: "offline" when the phone has no
 * connection, "unreachable" when it has one but ParaNaga's server could not be reached.
 */
export function offlinePlanNote(publishedAt: string | null | undefined, reason: "offline" | "unreachable" = "offline"): string {
  const date = publishedDateText(publishedAt);
  if (reason === "unreachable") {
    return date
      ? `Couldn't reach ParaNaga — planned on this phone with data from ${date}. Fares may have changed.`
      : "Couldn't reach ParaNaga — planned on this phone with the data it has. Fares may have changed.";
  }
  return date
    ? `Planned offline from data of ${date}. Fares may have changed.`
    : "Planned offline from the data on this phone. Fares may have changed.";
}

/** A detail panel waiting for the network (useOffline). */
export const OFFLINE_PANEL_TEXT = "You're offline · This opens when you're back online.";
