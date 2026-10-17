// Far-area data (Increment F): barangay anchors, far zones, route boarding links, Del Rosario via groups and
// tricycle terminals. Reviewed JSON (data/planning/far-areas-2026-10-18.json), validated here; pure.
import { z } from "zod";
import farAreasJson from "../../../data/planning/far-areas-2026-10-18.json";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";

// Source codes are shape-checked only: U03 and later RT codes are added to the modes seed by a later task,
// so the loader must not cross-check them against the seed.
const sourceCode = z.string().regex(/^(U|R[TLPH])[0-9]{2}$/);
/** The modes seed's RULE_EVIDENCE, repeated so the client planner does not bundle the importer (node:crypto); a test keeps them equal. */
export const FAR_EVIDENCE = ["official", "news", "community", "owner_report_unverified"] as const;
const evidence = z.enum(FAR_EVIDENCE);
const routeCode = z.string().regex(/^R[0-9]+(-[A-Z])?$/);
const terminalCode = z.string().regex(/^T[0-9]{2}$/);
const zoneCode = z.string().regex(/^FZ[0-9]{2}$/);
const osmNodeId = z.number().int().positive();

/**
 * A loading point boards a route only when the route path passes within this straight-line distance (controller
 * ruling: the walk from the loading point to the path is shown to the rider as a normal short walk; T10 is 99.93 m
 * from R6 inbound and 101.97 m from R6 outbound).
 */
export const ROUTE_BOARDING_LINK_M = 150;

const FarAreasSchema = z.strictObject({
  header: z.strictObject({
    schemaVersion: z.literal(1),
    preparedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    roadSnapshot: z.string().min(1),
    reviewer: z.string().min(1),
  }),
  barangayAnchors: z.array(
    z.strictObject({
      osmNodeId,
      name: z.string().min(1),
      place: z.enum(["village", "quarter"]),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      /** A far anchor's own zone radius (overrides the zone's radiusM); provisional, owner-reviewed. */
      radiusM: z.number().int().positive().optional(),
    }),
  ),
  farZones: z.array(
    z.strictObject({
      code: zoneCode,
      name: z.string().min(1),
      nodeIds: z.array(osmNodeId).min(1),
      routes: z.array(routeCode).min(1),
      /** A point is in the zone only within this distance of its (nearest) anchor; default FAR_ZONE_RADIUS_M. */
      radiusM: z.number().int().positive().optional(),
      note: z.string().optional(),
      evidence,
      sourceCodes: z.array(sourceCode).min(1),
    }),
  ),
  routeBoarding: z.array(
    z.strictObject({
      routeCode,
      boarding: z.union([z.strictObject({ terminalCode }), z.strictObject({ pathStart: z.literal("outbound") })]),
      /** Measured by the data test: is the terminal within ROUTE_BOARDING_LINK_M of the route path? The planner ignores a false link. */
      pathLinkOk: z.boolean().optional(),
      note: z.string().optional(),
    }),
  ),
  viaGroups: z.array(
    z.strictObject({
      code: z.string().min(1),
      routes: z
        .array(z.strictObject({ routeCode, via: z.string().min(1), aliasNote: z.string().optional() }))
        .min(2),
      /** Barangay anchor nodes at the group's far end: the vias apply only to a trip whose origin or destination is nearest to one. Absent: no geography filter. */
      endAnchors: z.array(osmNodeId).min(1).optional(),
      evidence,
      sourceCodes: z.array(sourceCode).min(1),
      note: z.string().optional(),
    }),
  ),
  tricycleTerminals: z.array(
    z.strictObject({
      terminalCode,
      todas: z.array(z.string()),
      serves: z
        .array(z.union([z.strictObject({ farZone: zoneCode }), z.strictObject({ terminalCode }), z.strictObject({ place: z.string().min(1) })]))
        .min(1),
      nearestJeepTerminal: terminalCode.nullable(),
      evidence,
      sourceCodes: z.array(sourceCode).min(1),
      note: z.string().optional(),
    }),
  ),
});

export type FarAreas = z.infer<typeof FarAreasSchema>;
export type FarZone = FarAreas["farZones"][number];
export type RouteBoarding = FarAreas["routeBoarding"][number];
export type ViaGroup = FarAreas["viaGroups"][number];
export type TricycleTerminal = FarAreas["tricycleTerminals"][number];

/** Parses the far-areas JSON; throws a ZodError on any unknown or malformed field. */
export function parseFarAreas(raw: unknown): FarAreas {
  return FarAreasSchema.parse(raw);
}

/** Default far-zone radius around a far anchor (review I5) when neither the anchor nor its zone sets radiusM. */
export const FAR_ZONE_RADIUS_M = 1500;

/** The far zone code of the barangay anchor nearest to `point`; null when that anchor is in no far zone or `point` is beyond the zone radius. */
export function zoneOf(point: LatLng, data: FarAreas): string | null {
  const id = nearestAnchorId(point, data);
  const zone = id === null ? undefined : data.farZones.find((z) => z.nodeIds.includes(id));
  const anchor = data.barangayAnchors.find((a) => a.osmNodeId === id);
  return zone && anchor && haversineMeters(point, anchor) <= anchorRadiusM(anchor, zone) ? zone.code : null;
}

/** The far radius around an anchor: its own radiusM, else its zone's, else FAR_ZONE_RADIUS_M. */
export function anchorRadiusM(anchor: FarAreas["barangayAnchors"][number], zone: FarZone): number {
  return anchor.radiusM ?? zone.radiusM ?? FAR_ZONE_RADIUS_M;
}

/** The OSM node id of the barangay anchor nearest to `point`, or null with no anchors. */
export function nearestAnchorId(point: LatLng, data: FarAreas): number | null {
  let best: { id: number; d: number } | null = null;
  for (const a of data.barangayAnchors) {
    const d = haversineMeters(point, a);
    if (best === null || d < best.d) best = { id: a.osmNodeId, d };
  }
  return best?.id ?? null;
}

/** The committed far-areas data, bundled so offline planning applies the same rules. */
export const FAR_AREAS: FarAreas = parseFarAreas(farAreasJson);

/** A terminal the planner can locate: published (in the snapshot) with a coordinate. */
export type LocatedTerminal = { code: string; name: string; lat: number; lng: number };

/** Published terminals with a coordinate, by code (special trips now; the T4 access option's loading points next). */
export function locatedTerminals(
  terminals: readonly { code: string; name: string; lat: number | null; lng: number | null }[] | undefined,
): Map<string, LocatedTerminal> {
  return new Map((terminals ?? []).flatMap((t) => (t.lat === null || t.lng === null ? [] : [[t.code, { code: t.code, name: t.name, lat: t.lat, lng: t.lng }] as const])));
}
