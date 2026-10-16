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
import { z } from "zod";
import { isInsideNaga } from "../geo/naga";
import { fleetSummary } from "../modes/fleet";
import { PLAN_LABELS } from "../planner/labels";
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
  kind: z.enum(["origin", "destination", "stop"]),
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
});

const measure = z.number().min(0).nullable().default(null);

const rideLegSchema = z.object({
  kind: z.literal("ride"),
  variantId: z.uuid(),
  routeCode: z.string(),
  routeName: z.string(),
  verification: verificationSchema,
  stops: z.array(z.object({ id: z.uuid(), name: z.string(), lat: latitude, lng: longitude })).min(2),
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
}).refine(
  (l) => (l.distanceBasis === "approximate_path") === (l.boardMeasureM !== null && l.alightMeasureM !== null)
    && (l.boardMeasureM === null) === (l.alightMeasureM === null),
  { message: "a path distance comes with both stop measures, a straight-line one with neither" },
).refine(
  (l) => l.stopMeasuresM === null || (l.distanceBasis === "approximate_path" && l.stopMeasuresM.length === l.stops.length
    && l.stopMeasuresM.every((m, i) => i === 0 || m >= l.stopMeasuresM![i - 1]!)),
  { message: "per-stop measures come with a path distance, one per stop, never decreasing" },
);

export const planOptionSchema = z.object({
  id: z.string(),
  labels: z.array(z.enum(PLAN_LABELS)).min(1),
  legs: z.array(z.discriminatedUnion("kind", [walkLegSchema, rideLegSchema])).min(1),
  rides: z.number().int().min(0),
  walkMeters: meters,
  walkEstimateMeters: meters,
  rideMeters: meters,
  score: z.number(),
  fare: z.object({
    minCentavos: centavos,
    maxCentavos: centavos,
    status: z.enum(["estimate", "unavailable", "no_ride"]),
    completeness: z.literal("estimate"),
  }),
  evidence: z.literal("provisional"),
});
export type PlanOptionDto = z.infer<typeof planOptionSchema>;
export type WalkLegDto = z.infer<typeof walkLegSchema>;
export type RideLegDto = z.infer<typeof rideLegSchema>;

export const planResponseSchema = z.object({
  revision: revisionMetaSchema,
  plan: z.object({
    revisionId: z.uuid(),
    coverage: z.enum(["provisional", "none"]),
    reason: z.enum(["outside_city", "same_place", "no_stop_near_origin", "no_stop_near_destination", "walk_shorter", "no_route"]).nullable(),
    directWalkEstimateMeters: meters.nullable(),
    options: z.array(planOptionSchema).max(3),
    notes: z.array(z.string()),
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
export type PlanResponse = z.infer<typeof planResponseSchema>;

export function buildPlanResponse(snapshot: Pick<NetworkSnapshot, "revision" | "stops" | "variants">, plan: TripPlan): z.input<typeof planResponseSchema> {
  const stopIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const option of plan.options) {
    for (const leg of option.legs) {
      if (leg.kind === "walk") {
        if (leg.from.stopId) stopIds.add(leg.from.stopId);
        if (leg.to.stopId) stopIds.add(leg.to.stopId);
      } else if (leg.kind === "ride") {
        variantIds.add(leg.variantId);
        for (const s of leg.stops) stopIds.add(s.id);
      }
    }
  }
  const byId = new Map(snapshot.stops.map((s) => [s.id, s]));
  return {
    revision: snapshot.revision,
    // Task 7 (plan E §D) replaces this cast: the response schema does not yet carry the Task 6 planner's
    // free board/alight points, tricycle and padyak legs, option modes or jeepneyReason.
    plan: plan as unknown as z.input<typeof planResponseSchema>["plan"],
    stops: snapshot.stops.filter((s) => stopIds.has(s.id)).map((s) => ({ id: s.id, name: s.name, code: s.source.code })),
    variants: snapshot.variants
      .filter((v) => variantIds.has(v.variantId))
      .map((v) => {
        const ring = v.stopIds.map((id) => byId.get(id)).filter((s) => s !== undefined);
        return {
          variantId: v.variantId,
          routeCode: v.routeCode,
          routeName: v.routeName,
          isCircular: v.isCircular,
          loopDirection: v.isCircular ? ringDirection(ring) : null,
        };
      }),
  };
}
