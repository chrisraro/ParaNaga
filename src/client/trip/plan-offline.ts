"use client";

// Offline planning (Task 12): when POST /api/v1/plan cannot reach the server, the same pure planner
// the server runs (src/domain/planner/plan.ts) plans the trip in the browser on the snapshot this
// phone holds (kept by the service worker). The two points never leave the device. The result is
// marked so the screen says which data it came from ("Planned offline from data of …").

import { loadSnapshot, heldSnapshot } from "@/client/network/use-snapshot";
import { buildPlanResponse, parsePlanRequest, planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import { isCompleteSnapshot } from "@/domain/api/schemas";
import type { LatLng } from "@/domain/geo/types";
import { planTrip } from "@/domain/planner/plan";

export type OfflinePlan = { status: "ready"; data: PlanResponse } | { status: "invalid" } | { status: "unavailable" };

export async function planOffline(origin: LatLng, destination: LatLng): Promise<OfflinePlan> {
  const snapshot = heldSnapshot() ?? (await loadSnapshot());
  if (!snapshot || !isCompleteSnapshot(snapshot)) return { status: "unavailable" };
  const parsed = parsePlanRequest({ origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } });
  if (!parsed.ok) return { status: "invalid" };
  // Task 7 passes the Lines and street graph this phone holds.
  const plan = planTrip(snapshot, { lines: null, streets: null }, parsed.value.origin, parsed.value.destination, { now: new Date() });
  const data = planResponseSchema.safeParse(buildPlanResponse(snapshot, plan));
  return data.success ? { status: "ready", data: data.data } : { status: "unavailable" };
}
