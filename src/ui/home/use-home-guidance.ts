"use client";

// Guidance as the home screen runs it (Task 10), kept out of home-screen.tsx:
//  - useHomeGuidance(): the session, what the map shows for it (the current leg's stops only, the
//    trip's destination pin) and the pick panel's "Choose where you are on the map" prompt;
//  - homeGuidanceActions(): Start, End ("Your trip stays in the options"), Done (clear the trip)
//    and Replan after a missed stop. Replan starts from the last guidance fix only when it is at
//    most REPLAN_FIX_MAX_AGE_MS old and usable inside Naga (the fix was taken on a moving
//    jeepney, so an older one would put "Your location" far from where the person got off);
//    otherwise the start is chosen on the map.

import { useMemo, useState, type Dispatch } from "react";
import { useGuidanceSession, type UseGuidanceSession } from "@/client/guidance/use-guidance-session";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
import { assessFix, type LocationFix } from "@/domain/geo/location-fix";
import type { LatLng } from "@/domain/geo/types";
import { currentStep, type GuidanceSession } from "@/domain/guidance/session";
import { guidanceSteps } from "@/domain/guidance/steps";
import { buildSavedTrip, type SavedTrip } from "@/domain/saved/saved";
import { endpointsReducer, initialEndpointsState, type Endpoint, type EndpointWhich, type EndpointsAction, type EndpointsState } from "@/domain/trip/endpoints";
import type { HighlightStop } from "@/ui/map/naga-map";
import type { TripEnds } from "@/ui/trip/trip-detail";
import { applyIfAccepted } from "./gps-policy";

/** Pick-mode prompt after a missed stop with no recent fix. */
export const PICK_WHERE_YOU_ARE = "Choose where you are on the map";
/** A replan starts from the last fix only while it is this fresh. */
export const REPLAN_FIX_MAX_AGE_MS = 10_000;

/** Guidance: the current leg's stops only (where to board, or board and get off on a ride). */
export function guidanceHighlights(session: GuidanceSession): HighlightStop[] {
  if (session.status !== "active") return [];
  const step = currentStep(session);
  if (step.kind === "walk_to_board" || step.kind === "transfer") {
    return [{ id: step.target.stopId, lat: step.target.lat, lng: step.target.lng, role: "board", label: step.target.label }];
  }
  if (step.kind === "ride") {
    return [
      { id: step.board.stopId, lat: step.board.lat, lng: step.board.lng, role: "board", label: step.board.label },
      { id: step.alight.stopId, lat: step.alight.lat, lng: step.alight.lng, role: "alight", label: step.alight.label },
    ];
  }
  return [];
}

/** The trip as guidance needs it (labels, codes, loop directions) and as a saved-trip card. */
export function guidanceTripFor(data: PlanResponse, option: PlanOptionDto, ends: TripEnds) {
  const card = buildSavedTrip({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), data, option, start: ends.start, destination: ends.destination });
  return {
    card,
    trip: {
      option,
      stops: card.stops.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      variants: card.variants.map((v) => ({ variantId: v.variantId, loopDirection: v.loopDirection })),
      destinationLabel: ends.destination.label,
    },
  };
}

/** A saved-trip end back as a trip endpoint (as chosen in search). */
export function endpointFromSaved(end: SavedTrip["start"]): Endpoint {
  return { point: { ...end.point }, source: "search", label: end.label, ...(end.place ? { place: end.place } : {}) };
}

/** The fix a replan may start from: ≤ 10 s old and usable as a start inside Naga, else null. */
export function replanFix(fix: LocationFix | null, now: number): LocationFix | null {
  if (!fix || now - fix.timestamp > REPLAN_FIX_MAX_AGE_MS) return null;
  return assessFix(fix, now).usableAsStart ? fix : null;
}

export type HomeGuidance = {
  guidance: UseGuidanceSession;
  guiding: boolean;
  /** Markers for the current leg (undefined when not guiding). */
  highlights: HighlightStop[] | undefined;
  /** The trip's own destination (the planner's endpoints are gone after a reload). */
  destination: LatLng | null;
  pickPrompt: string | null;
  setPickPrompt: (prompt: string | null) => void;
};

export function useHomeGuidance(): HomeGuidance {
  const guidance = useGuidanceSession();
  const session = guidance.session;
  const [pickPrompt, setPickPrompt] = useState<string | null>(null);
  const highlights = useMemo(() => (session ? guidanceHighlights(session) : undefined), [session]);
  const trip = session?.trip ?? null;
  const destination = useMemo(() => {
    if (!trip) return null;
    const last = guidanceSteps(trip).at(-1);
    return last?.kind === "walk_to_destination" ? { lat: last.target.lat, lng: last.target.lng } : null;
  }, [trip]);
  return { guidance, guiding: session !== null, highlights, destination, pickPrompt, setPickPrompt };
}

/** What the guidance actions need from the home screen (its own setters). */
export type HomeGuidanceContext = {
  home: HomeGuidance;
  endpoints: EndpointsState;
  dispatch: Dispatch<EndpointsAction>;
  liftSheet: () => void;
  dismissStored: () => void;
  setOpenedId: (id: string | null) => void;
  focusResults: () => void;
  clearFocusTarget: () => void;
  setFocused: (which: EndpointWhich | null) => void;
  announce: (text: string) => void;
  clearAll: () => void;
  /** Drops pending GPS requests, the outside-city card and the same-place notice. */
  resetPending: () => void;
  setGpsStartAccuracy: (accuracy: number | null) => void;
  recenter: () => void;
};

export function homeGuidanceActions(ctx: HomeGuidanceContext) {
  const { home, endpoints, dispatch } = ctx;
  const { guidance } = home;

  const start = (data: PlanResponse, option: PlanOptionDto, ends: TripEnds) => {
    const { trip, card } = guidanceTripFor(data, option, ends);
    guidance.start(trip, card);
    ctx.liftSheet();
    ctx.announce("Guidance started.");
  };

  // "End guidance" (confirmed): the trip stays in the options (its ends come back after a reload).
  const end = () => {
    const card = guidance.card;
    guidance.send({ type: "end" });
    if (card && (!endpoints.start || !endpoints.destination)) {
      dispatch({ type: "clearAll" });
      dispatch({ type: "set", which: "start", endpoint: endpointFromSaved(card.start) });
      dispatch({ type: "set", which: "destination", endpoint: endpointFromSaved(card.destination) });
      ctx.setFocused(null);
    }
    ctx.dismissStored();
    ctx.setOpenedId(null);
    ctx.focusResults();
    ctx.announce("Guidance ended. Your trip is in the options.");
  };

  // Arrive → "Done": clear the trip, back to the map.
  const done = () => {
    guidance.send({ type: "end" });
    ctx.dismissStored();
    ctx.setOpenedId(null);
    ctx.clearAll();
    document.querySelector<HTMLElement>("[data-home-heading]")?.focus();
  };

  // Missed stop → plan again to the same destination.
  const replan = () => {
    const card = guidance.card;
    const fix = replanFix(guidance.location.fix, Date.now());
    guidance.send({ type: "end" });
    ctx.dismissStored();
    ctx.setOpenedId(null);
    ctx.clearFocusTarget();
    ctx.resetPending();
    ctx.setGpsStartAccuracy(null);
    dispatch({ type: "clearAll" });
    if (!card) {
      ctx.setFocused("start");
      return;
    }
    const destination = endpointFromSaved(card.destination);
    dispatch({ type: "set", which: "destination", endpoint: destination });
    const withDestination = endpointsReducer(initialEndpointsState, { type: "set", which: "destination", endpoint: destination });
    if (fix) {
      const startEnd: Endpoint = { point: { lat: fix.lat, lng: fix.lng }, source: "gps", label: "" };
      if (applyIfAccepted(withDestination, "start", startEnd).accepted) {
        dispatch({ type: "set", which: "start", endpoint: startEnd });
        ctx.setGpsStartAccuracy(fix.accuracy);
        ctx.setFocused(null);
        ctx.focusResults();
        ctx.liftSheet();
        ctx.recenter();
        ctx.announce("Planning again from your location.");
        return;
      }
    }
    home.setPickPrompt(PICK_WHERE_YOU_ARE);
    dispatch({ type: "pick", which: "start" });
    ctx.announce(`${PICK_WHERE_YOU_ARE}.`);
  };

  return { start, end, done, replan };
}
