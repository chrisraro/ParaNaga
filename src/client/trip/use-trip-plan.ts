"use client";

// Requests a provisional trip plan (POST /api/v1/plan) whenever both endpoints are set.
// Coordinates go only in the request body (never a URL), the response is validated against the
// shared schema, and a superseded request is aborted so a late reply never shows for old pins.

import "@/client/zod-jitless"; // must precede the schema import below
import { useEffect, useState } from "react";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import type { LatLng } from "@/domain/geo/types";

export type PlanErrorKind = "offline" | "server" | "invalid";

export type TripPlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: PlanResponse }
  | { status: "error"; kind: PlanErrorKind };

type Outcome = { status: "ready"; data: PlanResponse } | { status: "error"; kind: PlanErrorKind };
type Settled = { key: string } & Outcome;

const keyOf = (o: LatLng, d: LatLng, attempt: number) => `${o.lat},${o.lng}>${d.lat},${d.lng}#${attempt}`;

async function requestPlan(origin: LatLng, destination: LatLng, signal: AbortSignal): Promise<Outcome> {
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

export function useTripPlan(origin: LatLng | null, destination: LatLng | null): TripPlanState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = origin && destination ? keyOf(origin, destination, attempt) : null;

  useEffect(() => {
    if (!origin || !destination || key === null) return undefined;
    const controller = new AbortController();
    requestPlan(origin, destination, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setSettled({ key, ...result });
      },
      () => undefined, // aborted: a newer request owns the state
    );
    return () => controller.abort();
    // origin/destination are captured through `key`, which encodes them exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = () => setAttempt((n) => n + 1);
  if (key === null) return { status: "idle", retry };
  if (!settled || settled.key !== key) return { status: "loading", retry };
  return settled.status === "ready" ? { status: "ready", data: settled.data, retry } : { status: "error", kind: settled.kind, retry };
}
