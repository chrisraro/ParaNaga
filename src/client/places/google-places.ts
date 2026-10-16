// Calls our Google Places proxy (/api/v1/places/*). POST bodies only, so nothing typed sits in a
// URL. Any failure (offline, error status, unexpected body) reads as "unavailable": the search
// screen then simply shows its on-device (OpenStreetMap) results.
import { resolveResponseSchema, suggestResponseSchema, type ResolveResponse, type SuggestResponse } from "@/domain/places/google";

async function post<T>(path: string, body: unknown, parse: (v: unknown) => T | null, signal?: AbortSignal): Promise<T | { status: "unavailable" }> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) return { status: "unavailable" };
    return parse(await response.json()) ?? { status: "unavailable" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "unavailable" };
  }
}

export const fetchGoogleSuggestions = (query: string, sessionToken: string, signal?: AbortSignal): Promise<SuggestResponse> =>
  post("/api/v1/places/suggest", { query, sessionToken }, (v) => suggestResponseSchema.safeParse(v).data ?? null, signal);

export const resolveGooglePlace = (placeId: string, sessionToken: string): Promise<ResolveResponse> =>
  post("/api/v1/places/resolve", { placeId, sessionToken }, (v) => resolveResponseSchema.safeParse(v).data ?? null);
