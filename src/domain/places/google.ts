// Google Places suggestions (Increment E2, Task 15): the pure half of the cost guard. OpenStreetMap
// search on the phone comes first; Google is asked only when it finds fewer than 3 results (or the
// rider taps "Search more places"), through our server, which holds the key. Google results are
// third-party text suggestions, never verified; a pick resolves to a point on our map.
//
// Cost (Google pricing page, read 2026-10-17): Autocomplete Requests $2.83 per 1,000 (10,000 free
// a month); Place Details Essentials $5.00 per 1,000 (10,000 free a month). The details field mask
// is `location` only (Essentials); the name comes from the suggestion, because `displayName` would
// make it Place Details Pro ($17.00 per 1,000).
import { z } from "zod";
import { en } from "@/i18n/dict";
import { NAGA_BOUNDS } from "../geo/naga";
import type { LatLng } from "../geo/types";

/** Google calls (autocomplete + details) per Manila day, at most. Enforced in SQL (migration 0012). */
export const GOOGLE_DAILY_CAP = 300;
export const GOOGLE_QUERY_MIN = 3;
export const GOOGLE_QUERY_MAX = 80;
/** Fewer local (OpenStreetMap, saved, pins…) results than this: ask Google on its own. */
export const GOOGLE_MIN_LOCAL_RESULTS = 3;
export const GOOGLE_DEBOUNCE_MS = 400;
export const GOOGLE_MAX_SUGGESTIONS = 5;
/** Per address: at most this many requests per window (both routes together). */
export const GOOGLE_RATE_LIMIT = { max: 30, windowSeconds: 600 } as const;
export const GOOGLE_SUGGEST_TTL_SECONDS = 86_400;
/** Google allows caching place ids indefinitely and coordinates for up to 30 days. */
export const GOOGLE_PLACE_TTL_SECONDS = 30 * 86_400;
export const PLACES_BODY_MAX_BYTES = 1024;

/**
 * What the per-address rate limit counts: an IPv4 address as is, an IPv6 address by its /64 prefix
 * (one subscriber usually holds a whole /64), an IPv4-mapped IPv6 address as its IPv4 address.
 */
export function rateLimitAddress(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const bare = ip.split("%")[0]!.toLowerCase();
  const [head = "", tail] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => (Number.parseInt(g || "0", 16) || 0).toString(16)).join(":")}::/64`;
}

/** Suggestions are biased (restricted) to the Naga City bounding box, never to the rider. */
export const NAGA_RECTANGLE = {
  low: { latitude: NAGA_BOUNDS.south, longitude: NAGA_BOUNDS.west },
  high: { latitude: NAGA_BOUNDS.north, longitude: NAGA_BOUNDS.east },
} as const;

export const GOOGLE_SUGGESTION_LABEL = en.search.googleSuggestion;
export const GOOGLE_ATTRIBUTION = en.search.googleAttribution;

/** NFKC, trimmed, inner spaces collapsed, lower case: the cache key and what Google is sent. */
export function normalizeGoogleQuery(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const length = (s: string) => [...s].length;

export function shouldAskGoogle(query: string, localResults: number): boolean {
  return localResults < GOOGLE_MIN_LOCAL_RESULTS && length(normalizeGoogleQuery(query)) >= GOOGLE_QUERY_MIN;
}

/** Google place ids: letters, digits, `_` and `-` only, so one can never change the request URL. */
export const PLACE_ID = z.string().regex(/^[A-Za-z0-9_-]{1,300}$/);
const sessionToken = z.uuid();

export const suggestRequestSchema = z.strictObject({
  query: z
    .string()
    .max(400)
    .transform(normalizeGoogleQuery)
    .refine((q) => length(q) >= GOOGLE_QUERY_MIN && length(q) <= GOOGLE_QUERY_MAX),
  sessionToken,
});
export const resolveRequestSchema = z.strictObject({ placeId: PLACE_ID, sessionToken });

const text = z.string().min(1).max(200);
export const googleSuggestionSchema = z.strictObject({ placeId: PLACE_ID, title: text, subtitle: text.nullable() });
export type GoogleSuggestion = z.infer<typeof googleSuggestionSchema>;
export const googleSuggestionsSchema = z.array(googleSuggestionSchema).max(GOOGLE_MAX_SUGGESTIONS);

const pointSchema = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const fallback = z.strictObject({ status: z.enum(["capped", "rate_limited", "unavailable"]) });
export const suggestResponseSchema = z.union([z.strictObject({ status: z.literal("ok"), suggestions: googleSuggestionsSchema }), fallback]);
export type SuggestResponse = z.infer<typeof suggestResponseSchema>;
export const resolveResponseSchema = z.union([
  z.strictObject({ status: z.literal("ok"), point: pointSchema }),
  z.strictObject({ status: z.literal("outside") }),
  fallback,
]);
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

const clip = (s: string) => [...s.trim()].slice(0, 200).join("");

const autocompleteSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            structuredFormat: z.object({ mainText: z.object({ text: z.string() }), secondaryText: z.object({ text: z.string() }).optional() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/** Place suggestions from an Autocomplete (New) answer: id, title, subtitle; null if malformed. */
export function parseAutocomplete(json: unknown): GoogleSuggestion[] | null {
  const parsed = autocompleteSchema.safeParse(json);
  if (!parsed.success) return null;
  const out: GoogleSuggestion[] = [];
  for (const s of parsed.data.suggestions ?? []) {
    const p = s.placePrediction;
    const title = p?.structuredFormat ? clip(p.structuredFormat.mainText.text) : "";
    if (!p || !title || !PLACE_ID.safeParse(p.placeId).success) continue;
    const subtitle = p.structuredFormat?.secondaryText ? clip(p.structuredFormat.secondaryText.text) : "";
    out.push({ placeId: p.placeId, title, subtitle: subtitle || null });
    if (out.length === GOOGLE_MAX_SUGGESTIONS) break;
  }
  return out;
}

const detailsSchema = z.object({ location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }) });

/** The point of a Place Details (New) answer (field mask `location`), or null. */
export function parsePlaceLocation(json: unknown): LatLng | null {
  const parsed = detailsSchema.safeParse(json);
  return parsed.success ? { lat: parsed.data.location.latitude, lng: parsed.data.location.longitude } : null;
}
