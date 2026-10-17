import { authorize } from "@/server/auth/authorize";
import { authedRoute, badRequest, CACHE, readJsonBody, tooManyRequests } from "@/server/api/http";
import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { createMediaSlotPayloadSchema, createMediaSlotResponseSchema } from "@/domain/media/schemas";
import { createMediaSlot } from "@/server/media/service";

/**
 * Commuters and contributors request a presigned quarantine upload slot.
 */
export function POST(request: Request): Promise<Response> {
  return authedRoute(request, "media-slot", async (requestId) => {
    const user = await authorize("media.upload");

    const raw = await readJsonBody(request, 16384);
    const parsed = createMediaSlotPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw badRequest("Invalid media slot payload.");
    }

    const allowed = await withRequestContext({ userId: user.id, requestId }, async (db) => {
      for (const limit of [RATE_LIMITS.mutationPerMinute, RATE_LIMITS.mediaSlotPerHour]) {
        if (!(await checkRateLimit(db, request, limit, user.id))) return false;
      }
      return true;
    });
    if (!allowed) throw tooManyRequests();

    const slot = await createMediaSlot(user.id, parsed.data.purpose, parsed.data.expectedBytes, parsed.data.mime);

    const body = createMediaSlotResponseSchema.parse({ slot });
    return Response.json(body, {
      status: 201,
      headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
    });
  });
}
