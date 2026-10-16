import "server-only";
import { createHmac } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import type { z } from "zod";
import {
  GOOGLE_DAILY_CAP,
  GOOGLE_RATE_LIMIT,
  NAGA_RECTANGLE,
  parseAutocomplete,
  parsePlaceLocation,
  type GoogleSuggestion,
} from "@/domain/places/google";
import type { LatLng } from "@/domain/geo/types";
import { withRequestContext } from "@/server/db/context";
import { serverEnv } from "@/server/env";
import { countRequest, readCache, takeGoogleCall, writeCache } from "@/server/repos/places-guard-repo";

// Google Places API (New), server side only. The key comes from GOOGLE_PLACES_API_KEY and travels
// only in the X-Goog-Api-Key header to the fixed host below; it is never sent to the browser,
// logged or stored. Order per request: rate limit (per address), cache, daily cap, then Google.
// Logs carry an event name and an HTTP status or error class only, never the query or the key.

const GOOGLE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 4000;

/** The key, when Google Places is switched on (PLACES_GOOGLE_ENABLED exactly "true"); else null. */
function googleKey(): string | null {
  const env = serverEnv();
  return env.PLACES_GOOGLE_ENABLED === "true" && env.GOOGLE_PLACES_API_KEY ? env.GOOGLE_PLACES_API_KEY : null;
}

/** Keyed hash (HMAC-SHA-256 under the server key): stored keys never reveal what was typed or who typed it. */
const keyedHash = (key: string, text: string) => createHmac("sha256", key).update(`paranaga-places-v1|${text}`).digest("hex");

export type Guarded<T> = { status: "ok"; value: T } | { status: "capped" | "rate_limited" | "unavailable" };

/**
 * Runs one Google call behind the guard. `cacheText` is what identifies the answer (normalized
 * query + bias, or the place id); `schema` re-validates a cached answer before it is served.
 */
export async function guardedGoogleCall<T>(opts: {
  request: Request;
  requestId: string;
  cacheText: string;
  ttlSeconds: number;
  schema: z.ZodType<T>;
  call: (key: string) => Promise<T | null>;
}): Promise<Guarded<T>> {
  const key = googleKey();
  if (!key) return { status: "unavailable" };
  const ctx = { userId: null, requestId: opts.requestId };
  const addressKey = `places:${keyedHash(key, `ip|${ipAddress(opts.request) ?? "unknown"}`)}`;
  const cacheKey = keyedHash(key, opts.cacheText);

  // Short transaction; the Google call happens outside it so no pooled connection waits on Google.
  const early = await withRequestContext(ctx, async (db): Promise<Guarded<T> | null> => {
    if ((await countRequest(db, addressKey, GOOGLE_RATE_LIMIT.windowSeconds)) > GOOGLE_RATE_LIMIT.max) return { status: "rate_limited" };
    const cached = opts.schema.safeParse(await readCache(db, cacheKey));
    if (cached.success) return { status: "ok", value: cached.data };
    return (await takeGoogleCall(db, GOOGLE_DAILY_CAP)) ? null : { status: "capped" };
  });
  if (early) return early;

  const value = await opts.call(key);
  if (value === null) return { status: "unavailable" };
  await withRequestContext(ctx, (db) => writeCache(db, cacheKey, value, opts.ttlSeconds)).catch(() =>
    console.error(JSON.stringify({ event: "places_cache_write_failed", requestId: opts.requestId })),
  );
  return { status: "ok", value };
}

async function google(url: string, key: string, fieldMask: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "google_places_error", status: response.status }));
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    console.error(JSON.stringify({ event: "google_places_error", error: error instanceof Error ? error.name : "unknown" }));
    return null;
  }
}

/** Autocomplete (New): place suggestions restricted to the Naga rectangle, in one session. */
export async function googleAutocomplete(key: string, query: string, sessionToken: string): Promise<GoogleSuggestion[] | null> {
  const body = { input: query, sessionToken, locationRestriction: { rectangle: NAGA_RECTANGLE }, includedRegionCodes: ["ph"], languageCode: "en" };
  const json = await google(`${GOOGLE}/places:autocomplete`, key, "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json === null ? null : parseAutocomplete(json);
}

/** Place Details (New), field mask `location` only (Essentials SKU); ends the session. */
export async function googlePlaceLocation(key: string, placeId: string, sessionToken: string): Promise<LatLng | null> {
  const json = await google(`${GOOGLE}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, key, "location");
  return json === null ? null : parsePlaceLocation(json);
}
