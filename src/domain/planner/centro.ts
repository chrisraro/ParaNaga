// City-centre anchors (planner revision 2026-10-20). Reviewed JSON (data/planning/centro-2026-10-20.json), validated
// here; pure. A trip with both ends inside the centre gets the tricycle as its top option (owner, 2026-10-20).
import { z } from "zod";
import centroJson from "../../../data/planning/centro-2026-10-20.json";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";

const CentroSchema = z.strictObject({
  header: z.strictObject({
    schemaVersion: z.literal(1),
    preparedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    placesSnapshot: z.string().min(1),
    reviewer: z.string().min(1),
    rule: z.string().min(1),
  }),
  anchors: z.array(
    z.strictObject({
      code: z.string().regex(/^C[0-9]{2}$/),
      name: z.string().min(1),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusM: z.number().int().positive().max(1000),
      /** Where the coordinate was copied from (an OSM element of the committed places snapshot). */
      source: z.string().min(1),
    }),
  ).min(1),
});

export type Centro = z.infer<typeof CentroSchema>;

export function parseCentro(raw: unknown): Centro {
  return CentroSchema.parse(raw);
}

/** The committed city-centre anchors, bundled so offline planning applies the same rule. */
export const CENTRO: Centro = parseCentro(centroJson);

/** True when `p` lies within an anchor's radius (straight-line). */
export function inCentro(p: LatLng, data: Centro = CENTRO): boolean {
  return data.anchors.some((a) => haversineMeters(p, a) <= a.radiusM);
}
