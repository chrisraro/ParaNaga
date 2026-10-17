import { authorize } from "@/server/auth/authorize";
import { badRequest, CACHE, readJsonBody } from "@/server/api/http";
import { safeRequestId } from "@/server/request-id";
import { createMediaSlotPayloadSchema, createMediaSlotResponseSchema } from "@/domain/media/schemas";
import { createMediaSlot } from "@/server/media/service";

export const dynamic = "force-dynamic";

/**
 * Commuters and contributors request a presigned quarantine upload slot.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await authorize("media.upload");
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));

  const raw = await readJsonBody(request, 16384);
  const parsed = createMediaSlotPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid media slot payload.");
  }

  const slot = await createMediaSlot(
    user.id,
    parsed.data.purpose,
    parsed.data.expectedBytes,
    parsed.data.mime,
  );

  const body = createMediaSlotResponseSchema.parse({ slot });
  return Response.json(body, {
    status: 201,
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}
