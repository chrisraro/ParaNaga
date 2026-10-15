"use client";

// Requests a provisional trip plan (POST /api/v1/plan) whenever both endpoints are set.
// Coordinates go only in the request body (never a URL), the response is validated against the
// shared schema, and a superseded request is aborted so a late reply never shows for old pins.
//
// GPS refinements: a GPS-sourced endpoint that moves less than REPLAN_MIN_MOVE_M from the point
// last planned for does not trigger a new plan (a pin placed by hand or from search always
// replans, however small the move), and while a newer plan is in flight the last ready plan stays
// on screen (`refreshing: true`) instead of being replaced by a loading state.

import { useEffect, useState } from "react";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";
import type { EndpointSource } from "@/domain/trip/endpoints";

export const REPLAN_MIN_MOVE_M = 25;

export type PlanErrorKind = "offline" | "server" | "invalid";

export type TripPlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: PlanResponse; refreshing: boolean }
  | { status: "error"; kind: PlanErrorKind };

type Outcome = { status: "ready"; data: PlanResponse } | { status: "error"; kind: PlanErrorKind };
type Settled = { key: string } & Outcome;
export type PlanEnd = { point: LatLng; source: EndpointSource };
type Pair = { origin: PlanEnd; destination: PlanEnd };

const keyOf = (p: Pair, attempt: number) =>
  `${p.origin.point.lat},${p.origin.point.lng}>${p.destination.point.lat},${p.destination.point.lng}#${attempt}`;

/** Whether one end changed enough to plan again: only a GPS refinement under the threshold is ignored. */
function endChanged(prev: PlanEnd, next: PlanEnd): boolean {
  if (prev.point.lat === next.point.lat && prev.point.lng === next.point.lng && prev.source === next.source) return false;
  if (prev.source === "gps" && next.source === "gps") return haversineMeters(prev.point, next.point) >= REPLAN_MIN_MOVE_M;
  return true; // placed by hand or from search (or the source changed): always a deliberate choice
}

/** True when `next` should be planned for instead of `prev`. */
export function shouldReplan(prev: Pair | null, next: Pair): boolean {
  if (!prev) return true;
  return endChanged(prev.origin, next.origin) || endChanged(prev.destination, next.destination);
}

async function requestPlan(pair: Pair, signal: AbortSignal): Promise<Outcome> {
  const origin = pair.origin.point;
  const destination = pair.destination.point;
  let response: Response;
  try {
    response = await fetch("/api/v1/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } }),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    // A network failure: say "offline" only when the browser knows it is.
    return { status: "error", kind: navigator.onLine === false ? "offline" : "server" };
  }
  if (response.status >= 500 || response.status === 404) return { status: "error", kind: "server" };
  if (!response.ok) return { status: "error", kind: "invalid" };
  const parsed = planResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { status: "ready", data: parsed.data } : { status: "error", kind: "server" };
}

export function useTripPlan(origin: PlanEnd | null, destination: PlanEnd | null): TripPlanState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  // The last ready plan, kept on screen while a newer request is in flight.
  const [lastReady, setLastReady] = useState<PlanResponse | null>(null);
  // The pair actually planned for; small moves of an end keep it (no replan).
  const [planned, setPlanned] = useState<Pair | null>(null);

  // "Adjust state while rendering": track the endpoints, dropping everything when one is cleared.
  if (!origin || !destination) {
    if (planned !== null) setPlanned(null);
    if (lastReady !== null) setLastReady(null);
  } else {
    const next = { origin, destination };
    if (shouldReplan(planned, next)) setPlanned(next);
  }

  const key = planned ? keyOf(planned, attempt) : null;

  useEffect(() => {
    if (!planned || key === null) return undefined;
    const controller = new AbortController();
    requestPlan(planned, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSettled({ key, ...result });
        setLastReady(result.status === "ready" ? result.data : null);
      },
      () => undefined, // aborted: a newer request owns the state
    );
    return () => controller.abort();
    // `planned` is captured through `key`, which encodes it exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = () => setAttempt((n) => n + 1);
  if (key === null) return { status: "idle", retry };
  if (!settled || settled.key !== key) {
    return lastReady ? { status: "ready", data: lastReady, refreshing: true, retry } : { status: "loading", retry };
  }
  return settled.status === "ready"
    ? { status: "ready", data: settled.data, refreshing: false, retry }
    : { status: "error", kind: settled.kind, retry };
}
