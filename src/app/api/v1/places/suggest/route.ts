import {
  GOOGLE_SUGGEST_TTL_SECONDS,
  NAGA_RECTANGLE,
  PLACES_BODY_MAX_BYTES,
  googleSuggestionsSchema,
  suggestRequestSchema,
  suggestResponseSchema,
} from "@/domain/places/google";
import { badRequest, CACHE, publicPost, readJsonBody } from "@/server/api/http";
import { googleAutocomplete, guardedGoogleCall } from "@/server/places/google-places";

const BIAS = JSON.stringify(NAGA_RECTANGLE);

// Google place suggestions for a typed query (Task 15). POST so the query never sits in a URL or an
// access log; it is not stored (the cache key is a keyed hash) and never logged. Every outcome is
// HTTP 200 with a status: "capped" (daily budget spent), "rate_limited", "unavailable" (off or failed).
export function POST(request: Request) {
  return publicPost(request, "places_suggest", suggestResponseSchema, async ({ requestId }) => {
    const parsed = suggestRequestSchema.safeParse(await readJsonBody(request, PLACES_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Send a query of 3 to 80 characters and a session token.");
    const { query, sessionToken } = parsed.data;
    const outcome = await guardedGoogleCall({
      request,
      requestId,
      cacheText: `suggest|${query}|${BIAS}`,
      ttlSeconds: GOOGLE_SUGGEST_TTL_SECONDS,
      schema: googleSuggestionsSchema,
      call: (key) => googleAutocomplete(key, query, sessionToken),
    });
    const body = outcome.status === "ok" ? { status: "ok" as const, suggestions: outcome.value } : { status: outcome.status };
    return { body, cacheControl: CACHE.none };
  });
}
