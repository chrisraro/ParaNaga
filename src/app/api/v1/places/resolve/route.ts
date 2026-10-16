import { z } from "zod";
import { isInsideNaga } from "@/domain/geo/naga";
import { GOOGLE_PLACE_TTL_SECONDS, PLACES_BODY_MAX_BYTES, resolveRequestSchema, resolveResponseSchema } from "@/domain/places/google";
import { badRequest, CACHE, publicPost, readJsonBody } from "@/server/api/http";
import { googlePlaceLocation, guardedGoogleCall } from "@/server/places/google-places";

const pointSchema = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

// The point of a picked Google suggestion (Task 15): one Place Details call per pick, field mask
// `location` only, cached by place id. A point outside Naga City is refused ("outside").
export function POST(request: Request) {
  return publicPost(request, "places_resolve", resolveResponseSchema, async ({ requestId }) => {
    const parsed = resolveRequestSchema.safeParse(await readJsonBody(request, PLACES_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Send a place id and a session token.");
    const { placeId, sessionToken } = parsed.data;
    const outcome = await guardedGoogleCall({
      request,
      requestId,
      cacheText: `place|${placeId}`,
      ttlSeconds: GOOGLE_PLACE_TTL_SECONDS,
      schema: pointSchema,
      call: (key) => googlePlaceLocation(key, placeId, sessionToken),
    });
    if (outcome.status !== "ok") return { body: { status: outcome.status }, cacheControl: CACHE.none };
    const body = isInsideNaga(outcome.value) ? { status: "ok" as const, point: outcome.value } : { status: "outside" as const };
    return { body, cacheControl: CACHE.none };
  });
}
