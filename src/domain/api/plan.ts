// POST /api/v1/plan: request validation, the response schema, and the response builder. Pure.
//
// The request is two points, both inside Naga City. Error messages never echo coordinates.
// The response wraps the planner's TripPlan with the revision it was planned on, the source code
// of every stop it names (e.g. "A1"), and each ridden variant's loop direction derived from the
// order of its mapped pins (never presented as verified).
//
// Ride legs (Increment D, D13): `distanceBasis` says whether `distanceMeters` runs along the
// approximate path (with the board/alight measures) or is the straight-line stop-to-stop sum;
// `mode` and `fleet` are the route's (no record → "Vehicle type not confirmed"); the fare says
// its span and basis. Bodies cached or saved before these fields existed read as straight-line,
// unconfirmed fleet and the plain rule span (defaults), never as a guessed class or path.
//
// Increment E (plan E section D): additive. Rides board and alight anywhere along the path (free
// `board`/`alight` points; `stops` holds only the named pins passed), walks carry a street `path` and
// `basis`, and `tricycle`/`padyak` legs join walk and ride. Options carry a `mode`, labels may be
// empty, the plan has a `jeepneyReason`. Every new field has a default, so format-1 bodies (saved,
// cached) still parse.
//
// Revision 2026-10-20 (additive, defaults keep older bodies parsing): a ride's `display` ({ letter, title, unverified }:
// the sign letter when confirmed, else null, and the "Centro-…" title), a plain tricycle's `tricycleTerminals`, and the
// jeepneyReasons "roundabout" (every jeepney loops or roams) and "centro" (city-centre trip, no jeepney drops off there).
import { z } from "zod";
import { isInsideNaga } from "../geo/naga";
import { encodePolyline } from "../geo/polyline";
import type { LatLng } from "../geo/types";
import { fleetSummary } from "../modes/fleet";
import { PLAN_LABELS } from "../planner/labels";
import { isCircuitLine, type PlanningLine } from "../planner/paths";
import type { TripPlan } from "../planner/plan";
import { ringDirection } from "../trip/present";
import { fleetSummarySchema, revisionMetaSchema, routeModeSchema, verificationSchema, type NetworkSnapshot, type Parsed } from "./schemas";

/** Two points as JSON is well under 200 bytes; anything past this is refused unread. */
export const PLAN_BODY_MAX_BYTES = 1024;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const pointSchema = z.strictObject({ lat: latitude, lng: longitude });

export const planRequestSchema = z.strictObject({ origin: pointSchema, destination: pointSchema });
export type PlanRequest = z.infer<typeof planRequestSchema>;

export function parsePlanRequest(raw: unknown): Parsed<PlanRequest> {
  const parsed = planRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Send {origin, destination}, each as {lat, lng} finite numbers." };
  }
  const { origin, destination } = parsed.data;
  if (!isInsideNaga(origin)) return { ok: false, message: "origin must be inside Naga City." };
  if (!isInsideNaga(destination)) return { ok: false, message: "destination must be inside Naga City." };
  return { ok: true, value: { origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } } };
}

// ---------------------------------------------------------------- response

const meters = z.number().int().min(0);
const centavos = z.number().int().min(0).nullable();

const placeSchema = z.object({
  kind: z.enum(["origin", "destination", "stop", "point"]),
  lat: latitude,
  lng: longitude,
  stopId: z.uuid().nullable(),
  name: z.string().nullable(),
});

const walkLegSchema = z.object({
  kind: z.literal("walk"),
  from: placeSchema,
  to: placeSchema,
  distanceMeters: meters,
  estimateMeters: meters,
  pathVerified: z.literal(false),
  /** Encoded polyline (precision 5) of the street path; null for an estimate or an older body. */
  path: z.string().nullable().default(null),
  basis: z.enum(["street_graph", "straight_x1_3"]).default("straight_x1_3"),
}).refine((l) => l.path === null || l.basis === "street_graph", {
  message: "only a street-graph walk has a path",
});

const measure = z.number().min(0).nullable().default(null);
/** A board or alight point anywhere along the path, named by a nearby pin or stop when there is one. */
const freePointSchema = z.object({ lat: latitude, lng: longitude, measureM: z.number().min(0), stopId: z.uuid().nullable(), name: z.string().nullable() });

const rideLegSchema = z.object({
  kind: z.literal("ride"),
  variantId: z.uuid(),
  routeCode: z.string(),
  routeName: z.string(),
  verification: verificationSchema,
  /** Free board/alight points (null in bodies from before Increment E). */
  board: freePointSchema.nullable().default(null),
  alight: freePointSchema.nullable().default(null),
  /** The named pins passed, board to alight; empty for routes without pins. */
  stops: z.array(z.object({ id: z.uuid(), name: z.string(), lat: latitude, lng: longitude })).default(() => []),
  distanceMeters: meters,
  approximate: z.literal(true),
  boardingVerified: z.literal(false),
  pathVerified: z.literal(false),
  fare: z.object({
    minCentavos: centavos,
    maxCentavos: centavos,
    status: z.enum(["estimate", "unavailable"]),
    completeness: z.literal("estimate"),
    approximate: z.literal(true),
    discountsApplied: z.literal(false),
    ruleCodes: z.union([z.tuple([z.literal("F01"), z.literal("F02")]), z.tuple([z.literal("F01")]), z.tuple([z.literal("F02")])]).readonly(),
    span: z.enum(["rule_span", "traditional_rule", "modern_rule", "traditional_to_modern"]).default("rule_span"),
    basis: z.enum(["fare_rules", "fare_rules_and_reports"]).default("fare_rules"),
    reportCodes: z.array(z.string()).default(() => []),
  }).refine((f) => (f.basis === "fare_rules_and_reports") === (f.reportCodes.length > 0), {
    message: "rider reports are cited exactly when they set the maximum",
  }).refine((f) => f.basis === "fare_rules" || f.span === "traditional_to_modern", {
    message: "rider reports apply only to a mixed fleet",
  }).refine(
    (f) => f.ruleCodes.join() === (f.span === "traditional_rule" ? "F01" : f.span === "modern_rule" ? "F02" : "F01,F02"),
    { message: "the rules match the span: F01 alone, F02 alone, or both" },
  ),
  mode: routeModeSchema.default("jeepney"),
  fleet: fleetSummarySchema.default(() => fleetSummary([], "jeepney")),
  distanceBasis: z.enum(["approximate_path", "stop_to_stop_straight_line"]).default("stop_to_stop_straight_line"),
  boardMeasureM: measure,
  alightMeasureM: measure,
  /** Path measure at each stop, unwrapped within the ride (guidance's remaining ride); null without a path or on older bodies. */
  stopMeasuresM: z.array(z.number().min(0)).nullable().default(null),
  /** Route notes (near ones first) and the flagged-path note. */
  notes: z.array(z.string()).default(() => []),
  /** Revision 2026-10-20: sign letter (null when not confirmed) and "Centro-…" title; null in older bodies. */
  display: z.object({ letter: z.string().min(1).max(2).nullable(), title: z.string().min(1), unverified: z.boolean() }).nullable().default(null),
}).refine(
  (l) => (l.distanceBasis === "approximate_path") === (l.boardMeasureM !== null && l.alightMeasureM !== null)
    && (l.boardMeasureM === null) === (l.alightMeasureM === null),
  { message: "a path distance comes with both stop measures, a straight-line one with neither" },
).refine(
  (l) => l.stopMeasuresM === null || (l.distanceBasis === "approximate_path" && l.stopMeasuresM.length === l.stops.length
    && l.stopMeasuresM.every((m, i) => i === 0 || m >= l.stopMeasuresM![i - 1]!)),
  { message: "per-stop measures come with a path distance, one per stop, never decreasing" },
).refine(
  (l) => (l.board === null || l.board.measureM === l.boardMeasureM) && (l.alight === null || l.alight.measureM === l.alightMeasureM),
  { message: "board and alight repeat the leg's measures" },
);

const streetLeg = {
  from: placeSchema,
  to: placeSchema,
  distanceMeters: meters.nullable(),
  /** Encoded polyline (precision 5); only on a routed (street_graph) leg. */
  path: z.string().nullable(),
  basis: z.enum(["street_graph", "straight_line", "unavailable"]),
  notes: z.array(z.string()),
  ruleCodes: z.array(z.string()),
};
const streetLegOk = (l: { distanceMeters: number | null; path: string | null; basis: string }) =>
  (l.basis === "street_graph") === (l.path !== null) && (l.basis === "unavailable") === (l.distanceMeters === null);
const streetLegRule = { message: "a routed leg has its path, an unavailable one has no distance, a straight-line one has a distance and no path" };

const tricycleLegSchema = z.object({
  kind: z.literal("tricycle"),
  ...streetLeg,
  fare: z.object({
    minCentavos: centavos,
    maxCentavos: z.null(),
    status: z.enum(["minimum", "unavailable"]),
    ruleCodes: z.tuple([z.literal("F03")]),
    discountsApplied: z.literal(false),
  }).refine((f) => (f.status === "minimum") === (f.minCentavos !== null), { message: "a minimum fare has its amount" }),
}).refine(streetLegOk, streetLegRule);

const padyakLegSchema = z.object({
  kind: z.literal("padyak"),
  ...streetLeg,
  fare: z.object({
    minCentavos: centavos,
    maxCentavos: centavos,
    status: z.enum(["flat_per_passenger", "unavailable"]),
    discountedCentavos: centavos,
    ruleCodes: z.tuple([z.literal("F04")]),
  }).refine((f) => (f.status === "flat_per_passenger") === (f.minCentavos !== null && f.minCentavos === f.maxCentavos), {
    message: "a flat fare has one amount",
  }),
}).refine(streetLegOk, streetLegRule);

const legMode = (kinds: readonly string[]) =>
  kinds.includes("ride") ? "jeepney" : kinds.includes("tricycle") ? "tricycle" : kinds.includes("padyak") ? "padyak" : "walk";

export const planOptionSchema = z.object({
  id: z.string(),
  /** Absent in older bodies: read from the legs. */
  mode: z.enum(["walk", "jeepney", "tricycle", "padyak"]).optional(),
  labels: z.array(z.enum(PLAN_LABELS)),
  legs: z.array(z.discriminatedUnion("kind", [walkLegSchema, rideLegSchema, tricycleLegSchema, padyakLegSchema])).min(1),
  rides: z.number().int().min(0),
  walkMeters: meters,
  walkEstimateMeters: meters,
  rideMeters: meters,
  score: z.number(),
  fare: z.object({
    minCentavos: centavos,
    maxCentavos: centavos,
    status: z.enum(["estimate", "unavailable", "no_ride", "minimum", "flat_per_passenger"]),
    completeness: z.literal("estimate"),
  }),
  evidence: z.literal("provisional"),
  /** Increment F (T5): which via of a shared corridor this one-ride option takes; absent in older bodies and off the corridor. */
  via: z.object({ group: z.string(), routeCode: z.string(), label: z.string(), note: z.string().nullable() }).optional(),
  /** Increment F: a special-trip tricycle (fare not fixed); absent in older bodies and on every other option. */
  specialTrip: z.literal(true).optional(),
  /** Revision 2026-10-20: plain tricycle only, the published tricycle terminal near each end; absent when none and in older bodies. */
  tricycleTerminals: z.array(z.object({
    side: z.enum(["origin", "destination"]), code: z.string(), name: z.string(), distanceM: meters, todas: z.array(z.string()), source: z.string(),
  })).min(1).optional(),
}).transform((o) => ({ ...o, mode: o.mode ?? legMode(o.legs.map((l) => l.kind)) }))
  .refine((o) => o.mode === legMode(o.legs.map((l) => l.kind)), { message: "the mode is the one the legs travel" });
// On the wire a walk leg's `path` is the encoded street path (string | null). The client replaces it
// with the routed WalkLegPath (domain/trip/enrich.ts), so the DTO types it `unknown`: both shapes
// are plans, and only enrich.ts and the walk screens read it.
export type WalkLegDto = Omit<z.infer<typeof walkLegSchema>, "path"> & { path: unknown };
export type RideLegDto = z.infer<typeof rideLegSchema>;
export type TricycleLegDto = z.infer<typeof tricycleLegSchema>;
export type PadyakLegDto = z.infer<typeof padyakLegSchema>;
export type PlanLegDto = WalkLegDto | RideLegDto | TricycleLegDto | PadyakLegDto;
export type PlanOptionDto = Omit<z.infer<typeof planOptionSchema>, "legs"> & { legs: PlanLegDto[] };

/**
 * The option as stored (a saved trip, a guidance session): walk paths back in wire form. The screens
 * hold the routed WalkLegPath object; storage validates against `planOptionSchema`, which wants the
 * encoded string. A routed path keeps its street shape and its routed length (the wire has no other place for it); a straight one goes back to an estimate.
 */
export function toWireOption(option: PlanOptionDto): PlanOptionDto {
  const legs = option.legs.map((leg): PlanLegDto => {
    if (leg.kind !== "walk" || typeof leg.path === "string" || leg.path === null) return leg;
    const p = leg.path as { kind?: string; coords?: LatLng[]; lengthM?: number };
    return p.kind === "path" && p.coords
      ? { ...leg, path: encodePolyline(p.coords), basis: "street_graph", estimateMeters: p.lengthM ?? leg.estimateMeters }
      : { ...leg, path: null, basis: "straight_x1_3" };
  });
  return { ...option, legs };
}

export const planResponseSchema = z.object({
  revision: revisionMetaSchema,
  plan: z.object({
    revisionId: z.uuid(),
    coverage: z.enum(["provisional", "none"]),
    reason: z.enum(["outside_city", "same_place", "no_stop_near_origin", "no_stop_near_destination", "walk_shorter", "no_route"]).nullable(),
    directWalkEstimateMeters: meters.nullable(),
    /** Why there is no jeepney option; null when there is one (and in older bodies). */
    jeepneyReason: z.enum(["no_path_near_origin", "no_path_near_destination", "walk_shorter", "no_route", "roundabout", "centro"]).nullable().default(null),
    options: z.array(planOptionSchema).max(6),
    notes: z.array(z.string()),
    /** Increment F: why no tricycle is suggested when an end is in a far zone; null otherwise and in older bodies. */
    farNote: z.string().nullable().default(null),
  }),
  /** Every stop the plan names, with its source code (e.g. "A1"); null when the pin has none. */
  stops: z.array(z.object({ id: z.uuid(), name: z.string(), code: z.string().nullable() })),
  /** Ridden variants. loopDirection comes from the pin order of a circular variant, else null. */
  variants: z.array(
    z.object({
      variantId: z.uuid(),
      routeCode: z.string(),
      routeName: z.string(),
      isCircular: z.boolean(),
      loopDirection: z.enum(["clockwise", "counterclockwise"]).nullable(),
    }),
  ),
});
type ParsedPlanResponse = z.infer<typeof planResponseSchema>;
export type PlanResponse = Omit<ParsedPlanResponse, "plan"> & { plan: Omit<ParsedPlanResponse["plan"], "options"> & { options: PlanOptionDto[] } };

type PlanLines = { lines: readonly PlanningLine[] } | null;

export function buildPlanResponse(
  snapshot: Pick<NetworkSnapshot, "revision" | "stops" | "variants">,
  plan: TripPlan,
  lines: PlanLines = null,
): z.input<typeof planResponseSchema> {
  const stopIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const option of plan.options) {
    for (const leg of option.legs) {
      if (leg.kind === "walk") {
        if (leg.from.stopId) stopIds.add(leg.from.stopId);
        if (leg.to.stopId) stopIds.add(leg.to.stopId);
      } else if (leg.kind === "ride") {
        variantIds.add(leg.variantId);
        if (leg.board.stopId) stopIds.add(leg.board.stopId);
        if (leg.alight.stopId) stopIds.add(leg.alight.stopId);
        for (const s of leg.stops) stopIds.add(s.id);
      }
    }
  }
  const byId = new Map(snapshot.stops.map((s) => [s.id, s]));
  const pinned = new Map(snapshot.variants.map((v) => [v.variantId, v]));
  const traced = new Map((lines?.lines ?? []).map((l) => [l.variantId, l]));
  return {
    revision: snapshot.revision,
    plan,
    stops: snapshot.stops.filter((s) => stopIds.has(s.id)).map((s) => ({ id: s.id, name: s.name, code: s.source.code })),
    variants: [...variantIds].sort().flatMap((variantId) => {
      const line = traced.get(variantId);
      const pins = pinned.get(variantId);
      const meta = line ?? pins;
      if (!meta) return [];
      const isCircular = line ? isCircuitLine(line) : pins!.isCircular;
      const ring = pins ? pins.stopIds.map((id) => byId.get(id)).filter((x) => x !== undefined) : [];
      return [{ variantId, routeCode: meta.routeCode, routeName: meta.routeName, isCircular, loopDirection: isCircular && ring.length > 0 ? ringDirection(ring) : null }];
    }),
  };
}