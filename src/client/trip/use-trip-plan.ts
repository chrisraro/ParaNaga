"use client";

// Requests a provisional trip plan (POST /api/v1/plan) whenever both endpoints are set.
// Coordinates go only in the request body (never a URL), the response is validated against the
// shared schema, and a superseded request is aborted so a late reply never shows for old pins.
//
// Replanning rules live in domain/trip/replan.ts: a GPS refinement under 25 m does not replan; a
// hand pin or search pick always does. Only while a GPS-refinement replan is in flight does the
// last ready plan stay on screen (`refresh: refreshing`); any other replan shows loading, so the
// previous trip's options never appear for a deliberately changed trip. When that refresh fails
// (rate limited, offline without a snapshot), the plan stays on screen marked `refresh: failed`,
// never shown as current, and the refresh is tried again every minute and when the phone is back
// online. A failed first load, or a load for changed endpoints, is an error as before.
//
// Offline (Task 12): when the request cannot reach the server, the plan is made in the browser on
// the snapshot this phone holds (plan-offline.ts) and marked `offline` with that data's published
// date; without a snapshot the error says "offline" (only when the browser knows it is).
//
// Tricycle road rules have hours (domain/walk/rules.ts): an open plan is made again the minute a
// restriction starts or is lifted (keeping the current options on screen while it refreshes), so the
// options never show a tricycle road that has just closed. A guided trip keeps its own copy.

import { useEffect, useMemo, useState } from "react";
import { useWalkGraph } from "@/client/network/use-walk-graph";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import { enrichPlan, type EnrichedPlanResponse, type WalkGraphStatus } from "@/domain/trip/enrich";
import { isGpsRefinement, shouldReplan, type PlanEnd, type PlanPair } from "@/domain/trip/replan";
import { msUntilNextRuleBoundary } from "@/domain/walk/rules";

/** busy: rate limited (429), retry later; invalid: a rejected request (400) that fails the same way again. */
export type PlanErrorKind = "offline" | "server" | "invalid" | "busy";
export type PlannedOnPhone = false | "offline" | "unreachable";

/**
 * How the plan on screen relates to the newest request for this trip. `failed`: that request did
 * not bring a plan, so the options shown may be out of date (say so; never present them as current).
 */
export type PlanRefresh = { status: "current" } | { status: "refreshing" } | { status: "failed"; kind: PlanErrorKind };

const CURRENT: PlanRefresh = { status: "current" };
const REFRESHING: PlanRefresh = { status: "refreshing" };
/** A failed refresh is tried again after this long ("wait a minute" for a rate limit). */
export const REFRESH_RETRY_MS = 60_000;

export type TripPlanState =
  | { status: "idle" }
  | { status: "loading" }
  /**
   * `offline`: planned in the browser from the snapshot on this phone (its published date is in
   * data.revision) because the server could not be reached: "offline" when the browser says it has
   * no connection, "unreachable" otherwise; false for a server plan.
   */
  | {
      status: "ready";
      data: EnrichedPlanResponse;
      refresh: PlanRefresh;
      offline: PlannedOnPhone;
      walkGraphStatus: WalkGraphStatus;
    }
  | { status: "error"; kind: PlanErrorKind };

type Outcome = { status: "ready"; data: PlanResponse; offline: PlannedOnPhone } | { status: "error"; kind: PlanErrorKind };
type Settled = { key: string } & Outcome;
/** The pair planned for, and whether it differs from the previous one only by GPS refinements. */
type Planned = PlanPair & { gpsRefinement: boolean };

const keyOf = (p: PlanPair, attempt: number) =>
  `${p.origin.point.lat},${p.origin.point.lng}>${p.destination.point.lat},${p.destination.point.lng}#${attempt}`;

async function requestPlan(pair: PlanPair, signal: AbortSignal): Promise<Outcome> {
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
    // The server cannot be reached: plan on this phone's snapshot if it has one.
    // Loaded on demand: the planner is in its own chunk (precached by the service worker).
    const offline = await import("./plan-offline")
      .then(({ planOffline }) => planOffline(origin, destination))
      .catch(() => ({ status: "unavailable" as const }));
    if (signal.aborted) throw error;
    if (offline.status === "ready") return { status: "ready", data: offline.data, offline: navigator.onLine === false ? "offline" : "unreachable" };
    if (offline.status === "invalid") return { status: "error", kind: "invalid" };
    // No snapshot either: say "offline" only when the browser knows it is.
    return { status: "error", kind: navigator.onLine === false ? "offline" : "server" };
  }
  if (response.status >= 500 || response.status === 404) return { status: "error", kind: "server" };
  // Rate limited: the trip is fine, a retry in a minute can succeed.
  if (response.status === 429) return { status: "error", kind: "busy" };
  if (!response.ok) return { status: "error", kind: "invalid" };
  const parsed = planResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { status: "ready", data: parsed.data, offline: false } : { status: "error", kind: "server" };
}

export function useTripPlan(origin: PlanEnd | null, destination: PlanEnd | null): TripPlanState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  // The last ready plan, kept on screen only for a GPS-refinement replan (in flight or failed).
  const [lastReady, setLastReady] = useState<{ data: PlanResponse; offline: PlannedOnPhone } | null>(null);
  // The pair actually planned for; small GPS moves of an end keep it (no replan).
  const [planned, setPlanned] = useState<Planned | null>(null);

  // "Adjust state while rendering": track the endpoints, dropping everything when one is cleared.
  if (!origin || !destination) {
    if (planned !== null) setPlanned(null);
    if (lastReady !== null) setLastReady(null);
  } else {
    const next = { origin, destination };
    if (shouldReplan(planned, next)) {
      const gpsRefinement = isGpsRefinement(planned, next);
      setPlanned({ ...next, gpsRefinement });
      // A deliberate change starts fresh: the previous trip's results must never show for it.
      if (!gpsRefinement && lastReady !== null) setLastReady(null);
    }
  }

  // `planned.gpsRefinement` is intentionally not reset after the request settles: it only matters
  // while a request for this pair is in flight, and the next endpoint change recomputes it.
  const key = planned ? keyOf(planned, attempt) : null;

  useEffect(() => {
    if (!planned || key === null) return undefined;
    const controller = new AbortController();
    requestPlan(planned, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSettled({ key, ...result });
        if (result.status === "ready") setLastReady({ data: result.data, offline: result.offline });
        // A failed refresh keeps the plan on screen; any other failure is the error alone, and so
        // is a rejected request (a refined GPS point outside the city: waiting will not fix it).
        else if (!planned.gpsRefinement || result.kind === "invalid") setLastReady(null);
      },
      () => undefined, // aborted: a newer request owns the state
    );
    return () => controller.abort();
    // `planned` is captured through `key`, which encodes it exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The plan to show: this request's own, else (a refresh only) the last ready one. A ready result
  // is stored in `lastReady` in the same update, so `lastReady` is the plan in both cases; it is a
  // stable identity, so the walk enrichment below, and the map's trip-lines memo that keys on its
  // result, rerun only when the plan or the walk graph changes (not on pans, bounds, GPS fixes).
  const gpsRefinement = planned?.gpsRefinement ?? false;
  const outcome = settled && settled.key === key ? settled : null;
  const rawReady = key !== null && (outcome?.status === "ready" || gpsRefinement) ? lastReady : null;
  const refresh: PlanRefresh = !outcome ? REFRESHING : outcome.status === "ready" ? CURRENT : { status: "failed", kind: outcome.kind };
  const refreshFailed = rawReady !== null && refresh.status === "failed";

  // Lazy walk-graph load (Task 10, D18): fetched only once a plan exists.
  const walkGraph = useWalkGraph(rawReady?.data.revision.revisionId ?? null, rawReady !== null);
  const originPoint = planned?.origin.point ?? null;
  const destinationPoint = planned?.destination.point ?? null;
  const enrichedData = useMemo(() => {
    if (!rawReady) return null;
    return enrichPlan(rawReady.data, walkGraph.graph, {
      walkGraphStatus: walkGraph.status,
      ...(originPoint && destinationPoint ? { origin: originPoint, destination: destinationPoint } : {}),
    });
  }, [rawReady, walkGraph.graph, walkGraph.status, originPoint, destinationPoint]);

  // Replan at the next tricycle-rule boundary, the current options staying up as a refresh; after
  // a failed refresh, try again in a minute and as soon as the phone is back online.
  const rules = walkGraph.graph?.rules ?? null;
  const readyData = rawReady?.data ?? null;
  useEffect(() => {
    if (!readyData) return undefined;
    const refreshPlan = () => {
      setPlanned((p) => (p ? { ...p, gpsRefinement: true } : p));
      setAttempt((n) => n + 1);
    };
    if (refreshFailed) {
      const timer = window.setTimeout(refreshPlan, REFRESH_RETRY_MS);
      window.addEventListener("online", refreshPlan);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("online", refreshPlan);
      };
    }
    const ms = rules ? msUntilNextRuleBoundary(rules, new Date()) : null;
    if (ms === null) return undefined;
    const timer = window.setTimeout(refreshPlan, ms);
    return () => window.clearTimeout(timer);
  }, [readyData, rules, refreshFailed]);

  const retry = () => setAttempt((n) => n + 1);
  if (key === null) return { status: "idle", retry };
  if (rawReady && enrichedData) {
    return { status: "ready", data: enrichedData, refresh, offline: rawReady.offline, walkGraphStatus: walkGraph.status, retry };
  }
  return outcome?.status === "error" ? { status: "error", kind: outcome.kind, retry } : { status: "loading", retry };
}
