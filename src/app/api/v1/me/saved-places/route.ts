import { sql, eq } from "drizzle-orm";
import { savedPlace } from "@/server/db/schema";
import { withRequestContext, type Db } from "@/server/db/context";
import { authorize } from "@/server/auth/authorize";
import { CACHE, readJsonBody, badRequest } from "@/server/api/http";
import { safeRequestId } from "@/server/request-id";
import { savedPlacesResponseSchema, syncSavedPlacesPayloadSchema } from "@/domain/saved/sync-schemas";
import type { SavedPlace } from "@/domain/saved/saved";

export async function GET(request: Request) {
  const user = await authorize("account.saved.sync");
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));

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

export async function POST(request: Request) {
  const user = await authorize("account.saved.sync");
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  const raw = await readJsonBody(request, 65536);
  const parsed = syncSavedPlacesPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid saved places payload.");
  }

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
