import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { savedPlace } from "@/server/db/schema";
import { withRequestContext, type Db } from "@/server/db/context";
import { deleteSavedPlaces } from "@/server/db/saved-delete";
import { authorize } from "@/server/auth/authorize";
import { authedRoute, CACHE, readJsonBody, badRequest, tooManyRequests } from "@/server/api/http";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { savedPlacesResponseSchema, syncSavedPlacesPayloadSchema } from "@/domain/saved/sync-schemas";
import type { SavedPlace } from "@/domain/saved/saved";

async function getSaved(request: Request, requestId: string) {
  const user = await authorize("account.saved.sync");

  const places = await withRequestContext({ userId: user.id, requestId }, async (db) => {
    const rows = await db.execute<{
      client_id: string;
      label: string;
      source: "osm" | "pin" | "pinned" | "google";
      saved_at: string;
      lat: number;
      lng: number;
    }>(sql`
      select client_id, label, source, saved_at,
             extensions.ST_Y(point::extensions.geometry) as lat,
             extensions.ST_X(point::extensions.geometry) as lng
        from core.saved_place
       where user_id = ${user.id}
       order by saved_at desc
    `);

    return rows.rows.map((r): SavedPlace => ({
      id: r.client_id,
      label: r.label,
      source: r.source,
      savedAt: new Date(r.saved_at).toISOString(),
      point: { lat: Number(r.lat), lng: Number(r.lng) },
    }));
  });

  const body = savedPlacesResponseSchema.parse({ places });
  return Response.json(body, {
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}

async function postSaved(request: Request, requestId: string) {
  const user = await authorize("account.saved.sync");
  const raw = await readJsonBody(request, 65536);
  const parsed = syncSavedPlacesPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid saved places payload.");
  }

  const allowed = await withRequestContext({ userId: user.id, requestId }, (db) =>
    checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id),
  );
  if (!allowed) throw tooManyRequests();

  await withRequestContext({ userId: user.id, requestId }, async (db) => {
    for (const place of parsed.data.places) {
      await db.execute(sql`
        insert into core.saved_place (user_id, client_id, label, point, source, saved_at)
        values (
          ${user.id},
          ${place.id},
          ${place.label},
          extensions.ST_SetSRID(extensions.ST_MakePoint(${place.point.lng}, ${place.point.lat}), 4326)::extensions.geography,
          ${place.source},
          ${place.savedAt}::timestamptz
        )
        on conflict (user_id, client_id) do update set
          label = excluded.label,
          point = excluded.point,
          source = excluded.source,
          updated_at = now()
      `);
    }
  });

  return Response.json({ ok: true, count: parsed.data.places.length }, {
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}

const idsSchema = z.object({ ids: z.array(z.string().min(1).max(200)).max(50) });

/** Removes the caller's own items by client id (a removal made on a phone); RLS scopes it to the user. */
async function removeSaved(request: Request, requestId: string) {
  const user = await authorize("account.saved.sync");
  const parsed = idsSchema.safeParse(await readJsonBody(request, 16384));
  if (!parsed.success) throw badRequest("Invalid payload.");

  const allowed = await withRequestContext({ userId: user.id, requestId }, (db) =>
    checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id),
  );
  if (!allowed) throw tooManyRequests();

  if (parsed.data.ids.length > 0) {
    await withRequestContext({ userId: user.id, requestId }, (db) =>
      deleteSavedPlaces(db, user.id, parsed.data.ids),
    );
  }
  return Response.json({ ok: true, count: parsed.data.ids.length }, {
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}

/** Every path (no session, bad body, DB error) answers the standard error envelope. */
export function GET(request: Request): Promise<Response> {
  return authedRoute(request, "saved-places-get", (requestId) => getSaved(request, requestId));
}

export function POST(request: Request): Promise<Response> {
  return authedRoute(request, "saved-places-post", (requestId) => postSaved(request, requestId));
}

export function DELETE(request: Request): Promise<Response> {
  return authedRoute(request, "saved-places-delete", (requestId) => removeSaved(request, requestId));
}
