// Recent searches (Home redesign T4; decision D3: device-local only, never sent to a server).
// Pure: the schema and the cap/dedupe helper for the last 8 place or stop picks on this phone.

import { z } from "zod";
import { SAVED_PLACE_SOURCES } from "../saved/saved";

export const RECENT_SEARCH_LIMIT = 8;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const pointSchema = z.object({ lat: latitude, lng: longitude });

export const recentSearchEntrySchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  point: pointSchema,
  place: z.enum(SAVED_PLACE_SOURCES).optional(),
  pickedAt: z.iso.datetime({ offset: true }),
});
export type RecentSearchEntry = z.infer<typeof recentSearchEntrySchema>;

export const recentSearchesSchema = z.object({
  entries: z.array(recentSearchEntrySchema).max(RECENT_SEARCH_LIMIT),
});
export type RecentSearchesRecord = z.infer<typeof recentSearchesSchema>;

const SAME_POINT_EPSILON = 1e-5;

function samePick(a: RecentSearchEntry, b: RecentSearchEntry): boolean {
  if (a.key === b.key) return true;
  return (
    a.label === b.label &&
    Math.abs(a.point.lat - b.point.lat) <= SAME_POINT_EPSILON &&
    Math.abs(a.point.lng - b.point.lng) <= SAME_POINT_EPSILON
  );
}

/**
 * Inserts `next` at the front of `entries`, removing any earlier pick of the same place or stop,
 * and caps the list at `limit` (default 8).
 */
export function recordRecentSearchEntry(
  entries: readonly RecentSearchEntry[],
  next: RecentSearchEntry,
  limit = RECENT_SEARCH_LIMIT,
): RecentSearchEntry[] {
  const valid = recentSearchEntrySchema.parse(next);
  const rest = entries.filter((entry) => !samePick(entry, valid));
  return [valid, ...rest].slice(0, Math.max(0, limit));
}

/** Stable key for a picked trip endpoint when no search-result key is available. */
export function recentKeyForEndpoint(
  endpoint: { label: string; point: { lat: number; lng: number }; place?: string },
  explicitKey?: string,
): string {
  if (explicitKey && explicitKey.trim() !== "") return explicitKey;
  return `${endpoint.place ?? "point"}:${endpoint.label}:${endpoint.point.lat.toFixed(5)},${endpoint.point.lng.toFixed(5)}`;
}
