import { authorize } from "@/server/auth/authorize";
import { authedRoute, badRequest, CACHE, notFound, readJsonBody, tooManyRequests, unavailable } from "@/server/api/http";
import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { confirmMediaPayloadSchema, confirmMediaResponseSchema } from "@/domain/media/schemas";
import { confirmMediaSlot, MediaConfirmError } from "@/server/media/service";

/**
 * Commuter confirms uploaded media slot by slot ID (never by key).
 * Performs server verification and promotes object. Errors are fixed messages: a slot that is
 * missing and one that belongs to someone else both answer 404 (no existence oracle).
 */
export function POST(request: Request): Promise<Response> {
  return authedRoute(request, "media-confirm", async (requestId) => {
    const user = await authorize("media.upload");

    const raw = await readJsonBody(request, 8192);
    const parsed = confirmMediaPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw badRequest("Invalid media confirm payload.");
    }

    const allowed = await withRequestContext({ userId: user.id, requestId }, (db) =>
      checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id),
    );
    if (!allowed) throw tooManyRequests();

    try {
      const media = await confirmMediaSlot(user.id, parsed.data.slotId);
      const body = confirmMediaResponseSchema.parse({ media });
      return Response.json(body, {
        status: 200,
        headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
      });
    } catch (err: unknown) {
      if (err instanceof MediaConfirmError) {
        if (err.kind === "not_found") throw notFound("This upload was not found.");
        if (err.kind === "rejected") throw badRequest("This file could not be accepted. Check the file type and size, then try again.");
        throw unavailable("The upload could not be saved. Please try again.");
      }
      throw err;
    }
  });
}
