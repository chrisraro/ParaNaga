// POST /api/v1/plan: request validation, the response schema, and the response builder. Pure.
//
// The request is two points, both inside Naga City. Error messages never echo coordinates.
// The response wraps the planner's TripPlan with the revision it was planned on, the source code
// of every stop it names (e.g. "A1"), and each ridden variant's loop direction derived from the
// order of its mapped pins (never presented as verified).
import { z } from "zod";
import { isInsideNaga } from "../geo/naga";
import { PLAN_LABELS } from "../planner/labels";
import type { TripPlan } from "../planner/plan";
import { ringDirection } from "../trip/present";
import { revisionMetaSchema, verificationSchema, type NetworkSnapshot, type Parsed } from "./schemas";

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
    ruleCodes: z.tuple([z.literal("F01"), z.literal("F02")]).readonly(),
  }),
});

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
    reason: z.enum(["outside_city", "no_stop_near_origin", "no_stop_near_destination", "walk_shorter", "no_route"]).nullable(),
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
      } else {
        variantIds.add(leg.variantId);
        for (const s of leg.stops) stopIds.add(s.id);
      }
    }
  }
  const byId = new Map(snapshot.stops.map((s) => [s.id, s]));
  return {
    revision: snapshot.revision,
    plan,
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
