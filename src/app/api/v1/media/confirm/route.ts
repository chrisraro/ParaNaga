import { authorize } from "@/server/auth/authorize";
import { badRequest, CACHE, readJsonBody } from "@/server/api/http";
import { safeRequestId } from "@/server/request-id";
import { confirmMediaPayloadSchema, confirmMediaResponseSchema } from "@/domain/media/schemas";
import { confirmMediaSlot } from "@/server/media/service";

export const dynamic = "force-dynamic";

/**
 * Commuter confirms uploaded media slot by slot ID (never by key).
 * Performs server verification and promotes object.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await authorize("media.upload");
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));

  const raw = await readJsonBody(request, 8192);
  const parsed = confirmMediaPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid media confirm payload.");
  }

  try {
    const media = await confirmMediaSlot(user.id, parsed.data.slotId);
    const body = confirmMediaResponseSchema.parse({ media });
    return Response.json(body, {
      status: 200,
      headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Media confirmation failed.";
    throw badRequest(message);
  }
}
