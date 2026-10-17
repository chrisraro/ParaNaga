import { sql } from "drizzle-orm";
import { withRequestContext } from "@/server/db/context";
import { authorize } from "@/server/auth/authorize";
import { authedRoute, CACHE, readJsonBody, badRequest, tooManyRequests } from "@/server/api/http";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { savedTripsResponseSchema, syncSavedTripsPayloadSchema } from "@/domain/saved/sync-schemas";
import type { SavedTrip } from "@/domain/saved/saved";
import type { PlanOptionDto } from "@/domain/api/plan";

async function getSaved(request: Request, requestId: string) {
  const user = await authorize("account.saved.sync");

  const trips = await withRequestContext({ userId: user.id, requestId }, async (db) => {
    const rows = await db.execute<{
      client_id: string;
      revision_id: string;
      revision_label: string;
      revision_kind: "provisional" | "verified";
      published_at: string | null;
      start_label: string;
      start_place: "osm" | "pin" | "pinned" | "google" | null;
      start_lat: number;
      start_lng: number;
      dest_label: string;
      dest_place: "osm" | "pin" | "pinned" | "google" | null;
      dest_lat: number;
      dest_lng: number;
      option: PlanOptionDto;
      stops: SavedTrip["stops"];
      variants: SavedTrip["variants"];
      saved_at: string;
    }>(sql`
      select client_id, revision_id, revision_label, revision_kind, published_at,
             start_label, start_place,
             extensions.ST_Y(start_point::extensions.geometry) as start_lat,
             extensions.ST_X(start_point::extensions.geometry) as start_lng,
             dest_label, dest_place,
             extensions.ST_Y(dest_point::extensions.geometry) as dest_lat,
             extensions.ST_X(dest_point::extensions.geometry) as dest_lng,
             option, stops, variants, saved_at
        from core.saved_trip
       where user_id = ${user.id}
         and invalidated_at is null
       order by saved_at desc
    `);

    return rows.rows.map((r): SavedTrip => ({
      id: r.client_id,
      revisionId: r.revision_id,
      revisionLabel: r.revision_label,
      revisionKind: r.revision_kind,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
      savedAt: new Date(r.saved_at).toISOString(),
      start: {
        label: r.start_label,
        point: { lat: Number(r.start_lat), lng: Number(r.start_lng) },
        ...(r.start_place ? { place: r.start_place } : {}),
      },
      destination: {
        label: r.dest_label,
        point: { lat: Number(r.dest_lat), lng: Number(r.dest_lng) },
        ...(r.dest_place ? { place: r.dest_place } : {}),
      },
      option: r.option,
      stops: r.stops,
      variants: r.variants,
    }));
  });

  const body = savedTripsResponseSchema.parse({ trips });
  return Response.json(body, {
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}

async function postSaved(request: Request, requestId: string) {
  const user = await authorize("account.saved.sync");
  const raw = await readJsonBody(request, 131072);
  const parsed = syncSavedTripsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid saved trips payload.");
  }

  const allowed = await withRequestContext({ userId: user.id, requestId }, (db) =>
    checkRateLimit(db, request, RATE_LIMITS.mutationPerMinute, user.id),
  );
  if (!allowed) throw tooManyRequests();

  await withRequestContext({ userId: user.id, requestId }, async (db) => {
    for (const trip of parsed.data.trips) {
      await db.execute(sql`
        insert into core.saved_trip (
          user_id, client_id, revision_id, revision_label, revision_kind, published_at,
          start_label, start_point, start_place,
          dest_label, dest_point, dest_place,
          option, stops, variants, saved_at
        )
        values (
          ${user.id},
          ${trip.id},
          ${trip.revisionId}::uuid,
          ${trip.revisionLabel},
          ${trip.revisionKind},
          ${trip.publishedAt ? sql`${trip.publishedAt}::timestamptz` : null},
          ${trip.start.label},
          extensions.ST_SetSRID(extensions.ST_MakePoint(${trip.start.point.lng}, ${trip.start.point.lat}), 4326)::extensions.geography,
          ${trip.start.place ?? null},
          ${trip.destination.label},
          extensions.ST_SetSRID(extensions.ST_MakePoint(${trip.destination.point.lng}, ${trip.destination.point.lat}), 4326)::extensions.geography,
          ${trip.destination.place ?? null},
          ${JSON.stringify(trip.option)}::jsonb,
          ${JSON.stringify(trip.stops)}::jsonb,
          ${JSON.stringify(trip.variants)}::jsonb,
          ${trip.savedAt}::timestamptz
        )
        on conflict (user_id, client_id) do update set
          revision_id = excluded.revision_id,
          revision_label = excluded.revision_label,
          revision_kind = excluded.revision_kind,
          published_at = excluded.published_at,
          start_label = excluded.start_label,
          start_point = excluded.start_point,
          start_place = excluded.start_place,
          dest_label = excluded.dest_label,
          dest_point = excluded.dest_point,
          dest_place = excluded.dest_place,
          option = excluded.option,
          stops = excluded.stops,
          variants = excluded.variants,
          saved_at = excluded.saved_at
      `);
    }
  });

  return Response.json({ ok: true, count: parsed.data.trips.length }, {
    headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId },
  });
}

/** Every path (no session, bad body, DB error) answers the standard error envelope. */
export function GET(request: Request): Promise<Response> {
  return authedRoute(request, "saved-trips-get", (requestId) => getSaved(request, requestId));
}

export function POST(request: Request): Promise<Response> {
  return authedRoute(request, "saved-trips-post", (requestId) => postSaved(request, requestId));
}
