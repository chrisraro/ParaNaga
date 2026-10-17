"use client";

// Home screen S1 (/app): the Naga-locked map, the "Location ± N m" pill, and the trip sheet.
// Anyone, inside Naga or not, can set a start and destination by GPS (only a fresh, inside-city,
// not-coarse fix) or by pinning in crosshair mode. Coordinates stay in React state only (and in
// the device database when the user saves a trip or a place).
//
// A saved trip reopened from Saved (requestTrip) restores both ends and re-plans on the current
// data. While that plan loads (or fails, offline) the saved option shows as saved, labelled with
// its data date; once the plan is in, the same option opens ("Re-planned on the current data" when
// the revision changed), or the options show under "Changed since saved".
//
// Guidance (Task 10): "Start trip" in Trip detail starts a session; while it runs the sheet shows
// the Walk / Ride / Transfer / Arrive step instead of the planner, the tab bar is hidden, the map
// highlights the current leg's stops, keeps the trip's lines drawn (walking dotted, rides solid, the
// current leg emphasised) with the current ride's stops as pins, and shows the user dot only when
// guidance uses location (its own watch, from a tap). A reload resumes the step from
// sessionStorage. "End guidance" puts the trip back in the options; Arrive → "Done" clears it;
// a missed stop plans again from the current fix (or asks where you are on the map).

import "./home-screen.css";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react";
import { useGeolocation } from "@/client/geo/use-geolocation";
import { useStopsInView } from "@/client/map/use-stops-in-view";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import { offlinePlanChip, offlinePlanNote } from "@/domain/pwa/offline-copy";
import type { PlanResponse } from "@/domain/api/plan";
import type { StopPin } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import { assessFix, type LocationFix } from "@/domain/geo/location-fix";
import { NAGA_DEFAULT_CENTER } from "@/domain/geo/naga";
import type { Bounds, LatLng } from "@/domain/geo/types";
import type { Endpoint } from "@/domain/trip/endpoints";
import { SAME_PLACE_M } from "@/domain/planner/labels";
import type { SavedPlaceSource, SavedTrip } from "@/domain/saved/saved";
import { SAME_PLACE_TITLE, planAnnouncement } from "@/domain/trip/present";
import {
  endpointLabel,
  endpointsReducer,
  initialEndpointsState,
  isReadyToPlan,
  type EndpointWhich,
  type EndpointsState,
} from "@/domain/trip/endpoints";
import { useAppFrame, useApplyOnce, useHideTabBar } from "@/ui/app-shell/app-frame-context";
import { Guidance } from "@/ui/guidance/guidance";
import { NagaMap, type HighlightStop } from "@/ui/map/naga-map";
import { TripDetail, type TripEnds } from "@/ui/trip/trip-detail";
import { previewIndex } from "@/domain/trip/option-card";
import { OPTIONS_TOGGLE_ID, OptionsPeek, TripOptions, optionDomId } from "@/ui/trip/trip-options";
import { TripError, TripLoading, TripNoCoverage } from "@/ui/trip/trip-status";
import { planLookups } from "@/ui/trip/trip-parts";
import { PEEK_NOTE_VISIBLE, PEEK_OPTIONS_VISIBLE, PEEK_VISIBLE, TINY_SHEET, mapInsetFor, useSheet, type Snap } from "@/ui/app-shell/bottom-sheet";
import { EndpointSheet, endpointRowMainId } from "./endpoint-sheet";
import { HomeSearchBar } from "./home-search-bar";
import { applyIfAccepted, gpsEndpointKey, shouldKeepWatching } from "./gps-policy";
import {
  LocationStatus,
  formatAccuracy,
  formatFixAge,
  locationStatusCopy,
  type LocationStatusCopy,
} from "./location-status";
import { NearbyStops } from "./nearby-stops";
import { homeGuidanceActions, useHomeGuidance } from "./use-home-guidance";
import { useSavedTripReopen } from "./use-saved-trip-reopen";
import { historyDepth, screenState, stepOut, tabBarHidden } from "./screen-state";
import { useStepHistory } from "./use-step-history";
import { useWalkGraph } from "@/client/network/use-walk-graph";
import { rideEnds } from "@/domain/trip/ride-ends";
import { enrichOptionWalks } from "@/domain/trip/enrich";
import { useLines } from "@/client/network/use-lines";
import { useSnapshot } from "@/client/network/use-snapshot";
import { updateLayers, usePrefs } from "@/client/prefs/use-prefs";
import { LayersSheet, SelectedRouteCard, distinctRoutesFromLines, filterMapTerminals } from "@/ui/map/layers-sheet";
import type { MapTerminal } from "@/ui/map/terminals-layer";
import { collectRouteLegendItems, filterOverviewLines } from "@/ui/map/route-lines-layer";
import {
  TRIP_LINES_MISSING_NOTE,
  TRIP_LINES_OVERVIEW_NOTE,
  legendVisualKeys,
  mapLayerPolicy,
  overviewLinesForTrip,
} from "@/ui/map/map-layer-policy";
import { ridePathsFor } from "@/domain/guidance/ride-paths";
import { routeFitPoints } from "@/ui/map/route-fit";
import { buildTripLinesData } from "@/ui/map/trip-lines-layer";

/** Pins while a trip detail is open: the layer stays mounted (one canvas for the session), just empty. */
const NO_PINS: readonly StopPin[] = [];

const NAME: Record<EndpointWhich, string> = { start: "Start", destination: "Destination" };

const SAME_PLACE_HINT = "Move the pin.";

/** Which row to offer next after `which` was just set. */
function nextFocus(state: EndpointsState, which: EndpointWhich): EndpointWhich | null {
  if (which === "start") return state.destination ? null : "destination";
  return state.start ? null : "start";
}

/** Boarding and getting-off stops of an option's ride legs, for the map (markers only). */
export function highlightsFor(data: PlanResponse, optionId: string): HighlightStop[] {
  const option = data.plan.options.find((o) => o.id === optionId);
  if (!option) return [];
  const lookups = planLookups(data);
  return option.legs.flatMap((leg, i) => {
    // The access option's tricycle ends at a named loading point (not the last leg): a named stop to get off at.
    if (leg.kind === "tricycle" && i < option.legs.length - 1 && leg.to.name) {
      return [{ id: `tricycle:${i}`, lat: leg.to.lat, lng: leg.to.lng, role: "alight" as const, label: leg.to.name }];
    }
    if (leg.kind !== "ride") return [];
    const ends = rideEnds(leg);
    if (!ends) return [];
    const { board, alight } = ends;
    return [
      { id: board.id, lat: board.lat, lng: board.lng, role: "board" as const, label: lookups.stopName(board.id, board.name) },
      { id: alight.id, lat: alight.lat, lng: alight.lng, role: "alight" as const, label: lookups.stopName(alight.id, alight.name) },
    ];
  });
}

/** A trip end as saved or shared: a GPS fix becomes a fixed point ("Pinned location"). */
function endFor(endpoint: Endpoint): TripEnds["start"] {
  return {
    label: endpoint.source === "gps" ? "Pinned location" : endpoint.label,
    point: { ...endpoint.point },
    ...(endpoint.place ? { place: endpoint.place } : {}),
  };
}

function toPoint(fix: LocationFix): LatLng {
  return { lat: fix.lat, lng: fix.lng };
}

/** Height of an element, kept current with a ResizeObserver (callback ref). */
function useMeasuredHeight(): [number, (el: HTMLElement | null) => (() => void) | undefined] {
  const [height, setHeight] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [height, ref];
}

function PillMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <path d="M32 90 V30 L60 60" fill="none" stroke="var(--pn-mark-teal)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 60 L88 90 V30" fill="none" stroke="var(--pn-mark-coral)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A start or destination refused for being on top of the other end (not a GPS status). */
function SamePlaceNotice({ which, onChooseOnMap }: { which: EndpointWhich; onChooseOnMap: () => void }) {
  return (
    <div className="pn-status pn-status--warn" data-testid="same-place-notice">
      <svg className="pn-status__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8v5M12 16h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="pn-status__body">
        <p className="pn-status__title">
          {SAME_PLACE_TITLE}. {SAME_PLACE_HINT}
        </p>
        <button type="button" className="pn-status__action" onClick={onChooseOnMap}>
          {which === "start" ? "Choose start on map" : "Choose destination on map"}
        </button>
      </div>
    </div>
  );
}

const ATTRIBUTION_VAR = "--naga-map-attribution-bottom";

/**
 * Map chrome that rides the sheet's edge reads ATTRIBUTION_VAR in CSS and carries
 * data-sheet-follower (tests/unit/sheet-followers.test.ts fails if a consumer lacks it). While the
 * sheet is dragged the value goes on those elements, found once per drag; the root gets it when
 * the settle starts (so followers that mount mid-drag just inherit the final value).
 */
function createSheetFollow() {
  let followers: HTMLElement[] | null = null;
  return (root: HTMLElement | null, value: string, dragging: boolean) => {
    if (!root) return;
    if (dragging) {
      followers ??= [...root.querySelectorAll<HTMLElement>("[data-sheet-follower]")];
      for (const el of followers) el.style.setProperty(ATTRIBUTION_VAR, value);
      return;
    }
    root.style.setProperty(ATTRIBUTION_VAR, value);
    for (const el of followers ?? []) el.style.removeProperty(ATTRIBUTION_VAR);
    followers = null;
  };
}

export function HomeScreen() {
  const frame = useAppFrame();
  const geo = useGeolocation();
  const home = useHomeGuidance();
  const { guidance, guiding, pickPrompt, setPickPrompt } = home;
  const [endpoints, dispatch] = useReducer(endpointsReducer, initialEndpointsState);
  const [focused, setFocused] = useState<EndpointWhich | null>("start");
  // The user tapped "Use current location" and no usable fix has arrived yet.
  const [gpsIntent, setGpsIntent] = useState(false);
  // Accuracy of the fix the GPS start was set from, so only better fixes replace it.
  const [gpsStartAccuracy, setGpsStartAccuracy] = useState<number | null>(null);
  const [center, setCenter] = useState<{ point: LatLng; inside: boolean }>({
    point: NAGA_DEFAULT_CENTER,
    inside: true,
  });
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [recenterOnFix, setRecenterOnFix] = useState(false);
  // Where the next recentre goes instead of the user fix (the start pin, for "Move start pin").
  const [recenterTarget, setRecenterTarget] = useState<LatLng | null>(null);
  const [recenterLabel, setRecenterLabel] = useState("the start pin");
  // The last "outside Naga" status card, kept after the watch stops so its copy stays visible.
  const [lastOutcome, setLastOutcome] = useState<LocationStatusCopy | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // An end that was refused for being the same place as the other end (GPS start on the destination).
  const [samePlaceRefused, setSamePlaceRefused] = useState<EndpointWhich | null>(null);
  // The tab bar floats over the sheet's bottom edge (measured; 0 while it is hidden).
  const [pickHeight, pickRef] = useMeasuredHeight();

  const bumpRecenter = (target: LatLng | null = null, label = "the start pin") => {
    setRecenterTarget(target);
    setRecenterLabel(label);
    setRecenterSignal((n) => n + 1);
  };

  const ready = isReadyToPlan(endpoints);
  const picking = endpoints.picking;
  // A trip is being set up once either end is set; until then Home is the bare map (no sheet).
  const tripStarted = ready || endpoints.start !== null || endpoints.destination !== null;
  const atHome = !picking && !guiding && !tripStarted;
  // While placing a pin: the crosshair is within SAME_PLACE_M of the other end.
  const otherEnd = picking ? endpoints[picking === "start" ? "destination" : "start"] : null;
  const pickSamePlace = otherEnd !== null && center.inside && haversineMeters(center.point, otherEnd.point) <= SAME_PLACE_M;
  const pickBlocked = !center.inside || pickSamePlace;
  const plan = useTripPlan(endpoints.start, endpoints.destination);
  // The option whose detail is open, by id: option ids (variant:board:alight) survive a replan for
  // a refined GPS point, so the detail stays open unless the new plan no longer has that option.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const planData = plan.status === "ready" ? plan.data : null;
  const openOption = openedId && planData ? (planData.plan.options.find((o) => o.id === openedId) ?? null) : null;
  const openOptionId = openOption?.id ?? null;
  // A saved trip reopened from Saved (see use-saved-trip-reopen.ts).
  const reopen = useSavedTripReopen({
    tripRequest: frame?.tripRequest ?? null,
    endpoints,
    plan,
    ready,
    onRestore: (card) => restoreTrip(card),
    onMissing: () => (frame?.panelOpen ? setDeferredAnnouncement : setAnnouncement)("That saved trip is no longer on this phone."),
    onOpen: setOpenedId,
  });
  const stored = reopen.stored;
  // Trip options are listed (none open): the sheet rests at peek with the best option's summary.
  const optionsListed =
    ready && !guiding && !picking && !stored && !openOption && planData !== null && planData.plan.coverage === "provisional" && planData.plan.options.length > 0;
  // The two staleness notes also show at the peek (the list below is inert there), one line each.
  const peekNotes: string[] = [];
  if (optionsListed && reopen.changed) peekNotes.push("Changed since saved");
  if (optionsListed && plan.status === "ready" && plan.offline) peekNotes.push(offlinePlanChip(plan.data.revision.publishedAt, plan.offline));
  // The sheet drags without re-rendering this screen: the map chrome that rides its edge is written
  // here directly (same value as attributionBottom below). During the drag the value goes on the
  // followers themselves, not on the root: a custom property on the root re-styles the whole map.
  const homeRef = useRef<HTMLElement>(null);
  // A best-option line that wraps (a long jeepney summary on a narrow phone) grows the peek by its overflow.
  const [peekExtra, setPeekExtra] = useState(0);
  const [follow] = useState(createSheetFollow);
  const sheet = useSheet(1, frame?.tabBarClearance ?? 0, optionsListed ? PEEK_OPTIONS_VISIBLE + PEEK_NOTE_VISIBLE * peekNotes.length + peekExtra : PEEK_VISIBLE, (visible, height, dragging) =>
    follow(homeRef.current, `${Math.round(Math.max(0, visible - mapInsetFor(height)))}px`, dragging),
  );
  // Where focus goes once the results render: the results heading, or an option card.
  const [focusTarget, setFocusTarget] = useState<{ kind: "results" } | { kind: "option"; id: string } | null>(null);
  // No trip, no pending focus move: a stale request must not pull focus once a trip is set again.
  if (plan.status === "idle" && focusTarget !== null) setFocusTarget(null);
  if (openedId !== null && openOption === null && plan.status !== "loading") {
    // The opened option is gone (new plan without it, an error, or the trip was cleared).
    setOpenedId(null);
    if (ready) setFocusTarget({ kind: "results" });
  }
  const storedData = stored?.data ?? null;
  const storedOptionId = stored?.option.id ?? null;
  const guidanceHighlights = home.highlights;
  const highlightStops = useMemo(
    () =>
      guidanceHighlights
        ? guidanceHighlights
        : storedOptionId && storedData
        ? highlightsFor(storedData, storedOptionId)
        : planData && openOptionId
          ? highlightsFor(planData, openOptionId)
          : undefined,
    [planData, openOptionId, storedData, storedOptionId, guidanceHighlights],
  );
  const watching = geo.state === "watching";
  const assessment = geo.assessment;
  const gpsKey = gpsEndpointKey(endpoints);
  const liveCopy = locationStatusCopy(geo.state, assessment, geo.fix?.accuracy ?? null, { gpsEndpointSet: gpsKey !== null });
  const statusCopy = liveCopy ?? lastOutcome;

  /** Sets an endpoint only if the reducer accepts it; announces and moves on only then. */
  const applyEndpoint = (
    which: EndpointWhich,
    point: LatLng,
    source: "gps" | "map" | "search",
    label = "",
    announce: (text: string) => void = setAnnouncement,
    place?: SavedPlaceSource,
  ): boolean => {
    const endpoint: Endpoint = { point, source, label, ...(place ? { place } : {}) };
    const { accepted, next } = applyIfAccepted(endpoints, which, endpoint);
    if (!accepted) {
      if (next.error === "same_place") {
        setSamePlaceRefused(which);
        announce(`${SAME_PLACE_TITLE}. ${SAME_PLACE_HINT}`);
      } else {
        announce("Outside Naga City. Choose a point inside.");
      }
      return false;
    }
    setSamePlaceRefused(null);
    dispatch({ type: "set", which, endpoint });
    setFocused(nextFocus(next, which));
    announce(`${NAME[which]} set: ${endpointLabel(source, label)}`);
    if (isReadyToPlan(next) && sheet.snap === 0) sheet.setSnap(1);
    return true;
  };

  const setStartFromGps = (fix: LocationFix, announce: (text: string) => void = setAnnouncement) => {
    if (!applyEndpoint("start", toPoint(fix), "gps", "", announce)) {
      setGpsIntent(false);
      return;
    }
    setGpsIntent(false);
    setGpsStartAccuracy(fix.accuracy);
    // With a destination set the map fits the whole route instead (no zoom-in on the start).
    if (!endpoints.destination) bumpRecenter();
  };

  // Announce loading, and each settled plan whose outcome changed (a refresh that returns the
  // same options stays quiet), through the persistent home announcer.
  const [seenPlanStatus, setSeenPlanStatus] = useState(plan.status);
  if (plan.status !== seenPlanStatus) {
    setSeenPlanStatus(plan.status);
    if (plan.status === "loading") setAnnouncement("Looking for routes…");
  }
  const planSignature = planData ? `${planData.plan.coverage}|${planData.plan.options.map((o) => o.id).join(",")}` : null;
  const [seenSignature, setSeenSignature] = useState<string | null>(null);
  // The same words twice in a row are no change for a live region: the text alternates by a silent mark.
  const [announceTick, setAnnounceTick] = useState(false);
  if (planSignature !== seenSignature) {
    setSeenSignature(planSignature);
    if (planData) {
      setAnnouncement(planAnnouncement(planData, stored !== null, announceTick));
      setAnnounceTick(!announceTick);
    }
  }

  // React to each new assessment (new fix, or the hook's staleness re-check) during render,
  // React's "adjust state when a prop changes" pattern, so no effect chains are needed.
  const [seenStatusKind, setSeenStatusKind] = useState(statusCopy?.kind ?? null);
  if ((statusCopy?.kind ?? null) !== seenStatusKind) {
    setSeenStatusKind(statusCopy?.kind ?? null);
    if (statusCopy && statusCopy.kind !== "precise") setAnnouncement(statusCopy.title);
  }
  const [seenAssessment, setSeenAssessment] = useState(assessment);
  if (assessment !== seenAssessment) {
    setSeenAssessment(assessment);
    const fix = geo.fix;
    if (assessment && fix) {
      // While the user is placing a pin, a fix must not set the start or move the map.
      const placingPin = endpoints.picking !== null;
      if (!assessment.insideCity) {
        // Outside Naga the fix is never the start and the map stays put. Keep the card's copy
        // (the watch may stop below) and drop the pending requests.
        if (liveCopy?.kind === "outside_city") setLastOutcome(liveCopy);
        setRecenterOnFix(false);
        setGpsIntent(false);
      } else if (lastOutcome) {
        setLastOutcome(null);
      }
      if (!placingPin && recenterOnFix && assessment.insideCity) {
        setRecenterOnFix(false);
        bumpRecenter();
      }
      if (placingPin) {
        // Handled above; nothing else may touch the endpoints while a pin is being placed.
      } else if (gpsIntent) {
        if (assessment.usableAsStart) setStartFromGps(fix);
      } else if (
        gpsKey !== null &&
        endpoints.picking === null &&
        assessment.usableAsStart &&
        gpsStartAccuracy !== null &&
        fix.accuracy < gpsStartAccuracy &&
        // Never refine onto the other end (same place) or outside the city.
        applyIfAccepted(endpoints, gpsKey, { point: toPoint(fix), source: "gps", label: "" }).accepted
      ) {
        // A better fix refines whichever endpoint is GPS-sourced (the destination after a swap).
        dispatch({ type: "set", which: gpsKey, endpoint: { point: toPoint(fix), source: "gps", label: "" } });
        setGpsStartAccuracy(fix.accuracy);
      }
    }
  }
  // A transient "unavailable"/"timeout" keeps the pending request (the watch is still wanted, so a
  // later usable fix completes the tap); a dead end (denied, unsupported, insecure, stopped) drops it.
  const dead = geo.state === "idle" || geo.state === "denied" || geo.state === "unsupported" || geo.state === "insecure";
  if (dead && (gpsIntent || recenterOnFix)) {
    setGpsIntent(false);
    setRecenterOnFix(false);
  }

  // The watch runs only while something needs it (a GPS endpoint, a pending request, or a
  // recentre still waiting for its first fix). Everything else that ends a need just changes state.
  // Guidance has its own watch (from a tap): the planner's watch stops while it runs.
  const watchNeeded = !guiding && shouldKeepWatching(endpoints, gpsIntent, recenterOnFix);
  const geoStop = geo.stop;
  const geoActive = geo.state === "requesting" || geo.state === "watching" || geo.state === "unavailable" || geo.state === "timeout";
  useEffect(() => {
    if (!watchNeeded && geoActive) geoStop();
  }, [watchNeeded, geoActive, geoStop]);

  const handleUseCurrentLocation = (announce: (text: string) => void = setAnnouncement) => {
    setLastOutcome(null);
    if (watching && geo.fix) {
      const now = assessFix(geo.fix, Date.now());
      if (now.usableAsStart) {
        setStartFromGps(geo.fix, announce);
        return;
      }
    }
    setGpsIntent(true);
    setRecenterOnFix(true);
    geo.start();
  };

  const handleLocate = () => {
    if (geo.state !== "watching" && geo.state !== "requesting") {
      setLastOutcome(null);
      setRecenterOnFix(true);
      geo.start();
    }
    bumpRecenter();
  };

  const handleChooseOnMap = (which: EndpointWhich, announce: (text: string) => void = setAnnouncement) => {
    setSamePlaceRefused(null);
    // Placing a pin cancels any pending GPS request, so a late fix can't take over the pick.
    if (which === "start") setGpsIntent(false);
    setRecenterOnFix(false);
    dispatch({ type: "pick", which });
    announce("Move the map to place the pin.");
  };

  // When the pick panel closes, focus returns to the endpoint row that was set (or cancelled).
  const returnFocusTo = useRef<EndpointWhich | null>(null);

  const handleConfirmPick = () => {
    const which = endpoints.picking;
    if (!which || !center.inside) return;
    if (pickSamePlace) {
      setAnnouncement(`${SAME_PLACE_TITLE}. ${SAME_PLACE_HINT}`);
      return;
    }
    const wasGps = gpsEndpointKey(endpoints) === which;
    if (!applyEndpoint(which, center.point, "map")) return;
    returnFocusTo.current = which;
    if (which === "start") setGpsIntent(false);
    if (wasGps) setGpsStartAccuracy(null);
    // The watch effect stops GPS when this pin leaves nothing needing it.
  };

  const handleCancelPick = () => {
    returnFocusTo.current = endpoints.picking;
    dispatch({ type: "cancelPick" });
    setAnnouncement("Pin cancelled");
  };

  const handleClear = (which: EndpointWhich) => {
    setFocusTarget(null);
    // Clearing drops any pending "use current location" (the watch effect stops GPS if unneeded).
    if (gpsEndpointKey(endpoints) === which) setGpsStartAccuracy(null);
    setGpsIntent(false);
    setRecenterOnFix(false);
    setLastOutcome(null);
    setSamePlaceRefused(null);
    dispatch({ type: "clear", which });
    setFocused(which);
    setAnnouncement(`${NAME[which]} cleared`);
  };

  const handleOpenOption = (id: string) => {
    if (!planData) return;
    setFocusTarget(null);
    setOpenedId(id);
    // Back returns to the list as the rider left it (peek, half or full).
    setSnapBeforeDetail(sheet.snap);
    // Half, never full: tapping the option focused it, which lifts a sheet to full, and that
    // would cover the trip's lines and the legend. Full stays the rider's own drag or tap.
    if (sheet.snap !== 1) sheet.setSnap(1);
  };

  // The list's detent before an option opened is restored when the list returns (Back, End guidance).
  // The sheet is forced to peek only when the list appears for new ends; a re-plan of the same ends
  // (retry, GPS refinement, picking a point and cancelling) keeps the rider's detent. Adjusted during
  // render, so the detent is settled in the same commit that shows the list.
  const [snapBeforeDetail, setSnapBeforeDetail] = useState<Snap | null>(null);
  const [wasListed, setWasListed] = useState(false);
  const [peekedFor, setPeekedFor] = useState<string | null>(null);
  const endsSignature = endpoints.start && endpoints.destination ? [endpoints.start.point, endpoints.destination.point].map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join("|") : null;
  if (optionsListed !== wasListed) {
    setWasListed(optionsListed);
    if (optionsListed) {
      if (snapBeforeDetail !== null) sheet.setSnap(snapBeforeDetail);
      else if (peekedFor !== endsSignature) sheet.setSnap(0);
      setPeekedFor(endsSignature);
      setSnapBeforeDetail(null);
    }
  }
  if (!ready && peekedFor !== null) setPeekedFor(null);
  if (snapBeforeDetail !== null && (!ready || plan.status === "loading")) setSnapBeforeDetail(null);

  // "All options" lifts the sheet to full and focuses the list heading; pressed again it returns to
  // the peek with focus staying on the toggle.
  const handleToggleOptions = () => {
    if (sheet.snap === 2) {
      sheet.setSnap(0);
      return;
    }
    sheet.setSnap(2);
    setFocusTarget({ kind: "results" });
  };

  const handleCloseOption = () => {
    if (openedId) setFocusTarget({ kind: "option", id: openedId });
    setOpenedId(null);
    reopen.clearNote();
  };

  // Back from the saved option before the re-plan settled: show the plan's state instead.
  const handleCloseStored = () => {
    reopen.dismissStored();
    setFocusTarget({ kind: "results" });
  };

  const handleRetry = () => {
    setFocusTarget({ kind: "results" });
    plan.retry();
  };

  // A 400 cannot succeed on retry: send the user back to the endpoint rows.
  const handleChangeEndpoints = () => {
    if (sheet.snap === 0) sheet.setSnap(1);
    document.getElementById(endpointRowMainId("start"))?.focus();
  };

  // Move focus once its target has rendered (after a retry, once the request settles). Each
  // request is a fresh object, consumed once.
  const focusDone = useRef<object | null>(null);
  useEffect(() => {
    if (!focusTarget || focusDone.current === focusTarget || plan.status === "loading" || openOption) return;
    let el =
      focusTarget.kind === "option"
        ? document.getElementById(optionDomId(focusTarget.id))
        : document.querySelector<HTMLElement>("[data-results-heading]");
    // The list rests below the screen edge at peek (inert): focus the toggle that opens it.
    if (!el || el.closest("[inert]")) el = document.getElementById(OPTIONS_TOGGLE_ID) ?? el;
    if (!el) return;
    el.focus();
    focusDone.current = focusTarget;
  }, [focusTarget, plan.status, openOption]);

  const handleClearAll = () => {
    setFocusTarget(null);
    setGpsIntent(false);
    setRecenterOnFix(false);
    setLastOutcome(null);
    setGpsStartAccuracy(null);
    setSamePlaceRefused(null);
    dispatch({ type: "clearAll" });
    setFocused("start");
    setAnnouncement("Start and destination cleared");
  };

  // "Move start pin" (approximate fix): open the crosshair centred on the current start point.
  const handleMoveStartPin = () => {
    if (endpoints.start) bumpRecenter(endpoints.start.point);
    handleChooseOnMap("start");
  };

  const handleSwap = () => {
    dispatch({ type: "swap" });
    setAnnouncement("Start and destination swapped");
  };

  const handleCenterChange = useCallback((point: LatLng, inside: boolean) => {
    setCenter({ point, inside });
  }, []);

  // Crosshair mode: move focus to the confirm button; Escape (anywhere) cancels. When the panel
  // closes, focus goes back to the endpoint row that was set or cancelled. A pick requested from
  // another screen starts while that screen still covers the map: focus moves once it closes.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const covered = frame?.panelOpen ?? false;
  // Search lists the same stops itself, so Home steps aside only for it. Any other panel (a stop's)
  // leaves the list mounted, so focus can return to the link that opened it.
  const onSearchRoute = usePathname() === "/app/search";
  const searchCovers = covered && onSearchRoute;
  useEffect(() => {
    if (covered) return undefined;
    if (!picking) {
      const row = returnFocusTo.current;
      returnFocusTo.current = null;
      if (row) document.getElementById(endpointRowMainId(row))?.focus({ preventScroll: true });
      return undefined;
    }
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      // Not while the app is covered (large-screen overlay) and inert.
      if (confirmRef.current?.closest("[inert]")) return;
      returnFocusTo.current = picking;
      dispatch({ type: "cancelPick" });
      setAnnouncement("Pin cancelled");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, covered]);

  // An aged fix (a phone standing still gets no new fixes) stays on screen while it is a trip
  // endpoint, dimmed and with its age; without a GPS endpoint only a fresh fix shows.
  const fixAged = assessment?.stale === true;
  const fixInside = watching && geo.fix !== null && assessment !== null && assessment.insideCity && (!fixAged || gpsKey !== null);
  const fixAge = fixAged && assessment ? formatFixAge(assessment.ageMs) : null;
  const userFix = watching ? geo.fix : null;
  // The status card is about the start; once the user pinned a start it stops nagging.
  const showStatus = statusCopy !== null && statusCopy.kind !== "precise" && (!endpoints.start || endpoints.start.source === "gps");
  const gpsSub = fixAge && gpsKey !== null ? `GPS ${fixAge}` : undefined;
  const startSub =
    gpsIntent && !endpoints.start && statusCopy?.kind === "requesting" ? "Finding your location…" : gpsKey === "start" ? gpsSub : undefined;
  const destinationSub = gpsKey === "destination" ? gpsSub : undefined;

  // The map ends mapInset above the screen bottom (just under the peek sheet's top, 186 px on a
  // phone held upright), so its centre (recentre target, crosshair) is never hidden behind the
  // sheet. The attribution rides the sheet's top edge, measured from the map's bottom.
  const mapInset = atHome ? 0 : mapInsetFor(sheet.height);
  const homeBottom = frame?.tabBarClearance ?? 0;
  const attributionBottom = atHome ? homeBottom : Math.max(0, (picking ? pickHeight : sheet.visible) - mapInset);
  const rootStyle = {
    ["--naga-map-attribution-bottom" as string]: `${Math.round(attributionBottom)}px`,
    ["--pn-map-inset" as string]: `${mapInset}px`,
    ["--pn-home-bottom" as string]: `${homeBottom}px`,
  };

  const pins = guiding
    ? home.destination
      ? { destination: home.destination }
      : {}
    : {
        ...(endpoints.start && picking !== "start" ? { start: endpoints.start.point } : {}),
        ...(endpoints.destination && picking !== "destination" ? { destination: endpoints.destination.point } : {}),
      };

  // Mapped stop pins: shown while exploring and while placing a pin (not tappable then); hidden
  // while a trip detail highlights its own stops. A tap opens the stop panel over the map.
  const router = useRouter();
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const tripDetailOpen = ready && (openOption !== null || stored !== null);
  const stopsInView = useStopsInView(viewBounds, !tripDetailOpen && !guiding);
  const setNearbyStops = frame?.setNearbyStops;
  useEffect(() => {
    setNearbyStops?.({
      stops: stopsInView.stops,
      center: center.point,
      status: stopsInView.status,
      truncated: stopsInView.truncated,
    });
  }, [setNearbyStops, stopsInView.stops, stopsInView.status, stopsInView.truncated, center.point]);
  const markHomeNavigation = frame?.markHomeNavigation;
  const handleStopSelect = useCallback(
    (id: string) => {
      const path = `/app/stops/${id}`;
      markHomeNavigation?.(path);
      router.push(path);
    },
    [router, markHomeNavigation],
  );

  // "Show on map" from a stop panel: centre the map on that stop (adjusted during render).
  useApplyOnce(frame?.mapFocus ?? null, (focus) => bumpRecenter(focus.point, "the stop"));

  // Map lines (Task 12): the trip guide when a trip detail is open, else the routes overview (D16).
  const prefs = usePrefs();
  const layers = prefs.layers;
  const snapshotState = useSnapshot(true);
  const linesState = useLines(snapshotState.snapshot?.revision.revisionId ?? null, true);
  const lines = linesState.lines;
  // Trip lines come from the lines of the PLAN's revision (a stored trip's own revision, the
  // guided trip's own revision), never the snapshot's: the legs' variant ids and measures belong to
  // that revision. They stay drawn while the trip is guided (the current leg emphasised).
  const guidedSession = guidance.session;
  const guidedCard = guidance.card;
  const guidedTrip = useMemo(
    () => (guidedSession && guidedCard ? { option: guidedSession.trip.option, variants: guidedCard.variants, revisionId: guidedCard.revisionId } : null),
    [guidedSession, guidedCard],
  );
  // Options listed, none open: the recommended option is drawn as a preview (not tappable); with none
  // Recommended, the first non-walk option, else no preview (previewIndex).
  const previewOption =
    ready && !guiding && !picking && !stored && !openOption && planData ? (planData.plan.options[previewIndex(planData.plan.options)] ?? null) : null;
  const previewing = previewOption !== null;
  const shownOption = openOption ?? previewOption;
  const tripRevisionId = guidedTrip
    ? guidedTrip.revisionId
    : (stored?.data.revision.revisionId ?? (planData && shownOption ? planData.revision.revisionId : null));
  // The guided walks draw the street path like trip detail, from the walk graph on the phone
  // (a stored copy only when saving data); without it they stay straight dotted lines.
  const guidedWalkGraph = useWalkGraph(guidedTrip?.revisionId ?? null, guidedTrip !== null);
  const guidedOption = useMemo(
    () => (guidedTrip ? enrichOptionWalks(guidedTrip.option, guidedWalkGraph.graph) : null),
    [guidedTrip, guidedWalkGraph.graph],
  );
  const tripLinesState = useLines(tripRevisionId, tripRevisionId !== null);
  const tripRevisionLines = tripLinesState.lines;
  const tripOption = guidedTrip ? guidedTrip.option : stored ? stored.option : shownOption;
  const tripLines = useMemo(() => {
    if (guidedTrip && guidedOption) return buildTripLinesData(guidedOption, guidedTrip.variants, tripRevisionLines);
    if (stored) return buildTripLinesData(stored.option, stored.data.variants, tripRevisionLines);
    if (planData && shownOption) return buildTripLinesData(shownOption, planData.variants, tripRevisionLines);
    return null;
  }, [guidedTrip, guidedOption, stored, planData, shownOption, tripRevisionLines]);
  // Both ends set, options listed, none open: fit the whole route (ends + the previewed path, or
  // the option's stops while its lines load) above the sheet. An open option fits via its highlights.
  const routeFitCoords = useMemo(() => {
    if (!endpoints.start || !endpoints.destination || tripDetailOpen || guiding || picking) return null;
    // No preview (plan loading, no coverage, error): the pins alone are framed.
    if (!previewOption) return routeFitPoints(endpoints.start.point, endpoints.destination.point);
    const path = tripLines && tripLines.allCoords.length > 0 ? tripLines.allCoords : null;
    const stops = path ?? previewOption.legs.flatMap((l) => (l.kind === "ride" ? l.stops.map((st) => ({ lat: st.lat, lng: st.lng })) : []));
    return routeFitPoints(endpoints.start.point, endpoints.destination.point, stops);
  }, [previewOption, tripLines, tripDetailOpen, guiding, picking, endpoints.start, endpoints.destination]);
  // Lines never vanish: the overview stays while picking a point. When the trip's own lines ended
  // without loading (error, or saving data; never while loading) and the trip is on the snapshot's
  // revision, the overview of exactly the trip's ridden variants stands in for the rides, dimmed
  // and not tappable; on another revision only the walks and the legend are drawn.
  const tripLinesStatus = tripLinesState.status === "ready" ? "ready" : tripLinesState.status === "error" || tripLinesState.status === "skipped" ? "failed" : "loading";
  const layerPolicy = mapLayerPolicy({
    guiding,
    tripOpen: tripLines !== null && !previewing,
    previewing,
    picking: picking !== null,
    tripHasRides: tripOption ? tripOption.legs.some((l) => l.kind === "ride") : guiding,
    tripLinesStatus,
    sameRevisionAsOverview: tripRevisionId !== null && tripRevisionId === (snapshotState.snapshot?.revision.revisionId ?? null),
  });
  const showOverview = layerPolicy.overviewInteractive;
  const rideVariantIds = useMemo(
    () => (tripOption ? tripOption.legs.flatMap((l) => (l.kind === "ride" ? [l.variantId] : [])) : []),
    [tripOption],
  );
  const overviewLines = useMemo(() => {
    if (!layerPolicy.overviewLines) return [];
    if (layerPolicy.overviewStandIn) return lines ? overviewLinesForTrip(lines.lines, rideVariantIds) : [];
    return filterOverviewLines(lines, layers);
  }, [layerPolicy.overviewLines, layerPolicy.overviewStandIn, lines, layers, rideVariantIds]);
  const legendNotice = layerPolicy.tripLinesMissing
    ? overviewLines.length > 0
      ? TRIP_LINES_OVERVIEW_NOTE
      : TRIP_LINES_MISSING_NOTE
    : null;
  const [layersOpen, setLayersOpen] = useState(false);
  const layersBtnRef = useRef<HTMLButtonElement>(null);
  const [selectedRouteCode, setSelectedRouteCode] = useState<string | null>(null);
  const selectedRoute = useMemo(
    () => (selectedRouteCode ? (distinctRoutesFromLines(overviewLines).find((r) => r.routeCode === selectedRouteCode) ?? null) : null),
    [selectedRouteCode, overviewLines],
  );
  if (selectedRouteCode !== null && !showOverview) setSelectedRouteCode(null);
  const mapLegend = legendVisualKeys(tripLines?.legendItems ?? null, collectRouteLegendItems(overviewLines));
  // Guidance has its own announcements: the drawn trip is not read out again then.
  const tripAnnouncement = guiding || previewing ? "" : (tripLines?.announcement ?? "");
  const [seenTripAnnouncement, setSeenTripAnnouncement] = useState("");
  if (tripAnnouncement !== seenTripAnnouncement) {
    setSeenTripAnnouncement(tripAnnouncement);
    if (tripAnnouncement) setAnnouncement(tripAnnouncement);
  }
  // Terminals layer (Task 13): only terminals with a coordinate, filtered like the overview (D16).
  const mapTerminals = useMemo<MapTerminal[]>(
    () =>
      showOverview
        ? filterMapTerminals(snapshotState.snapshot?.terminals, layers).map((t) => ({ code: t.code, name: t.name, modes: t.modes, lat: t.lat!, lng: t.lng! }))
        : [],
    [showOverview, snapshotState.snapshot, layers],
  );
  const handleTerminalSelect = useCallback(
    (code: string) => {
      const path = `/app/terminals/${encodeURIComponent(code)}`;
      markHomeNavigation?.(path);
      router.push(path);
    },
    [router, markHomeNavigation],
  );
  const closeLayers = useCallback(() => {
    setLayersOpen(false);
    layersBtnRef.current?.focus();
  }, [setLayersOpen]);

  // The endpoint channel: another screen (search, a place, a saved place) set an end of the trip
  // or asked to choose one on the map, then navigated here. Each request applies once, through
  // the same rules as the sheet (inside Naga, not the same place as the other end). It usually
  // applies while that screen still covers the map (home inert, its live region silent), so the
  // announcement waits until the map is showing again.
  const [deferredAnnouncement, setDeferredAnnouncement] = useState<string | null>(null);
  // "Use current location" tapped on the search screen: the GPS watch lives here, so the request
  // is recorded during render (state only) and the location request starts in an effect.
  const [gpsRequest, setGpsRequest] = useState(0);
  const handledGpsRequest = useRef(0);
  // While the search panel still covers the map (home inert, its live region silent), a fix that
  // is already usable sets the start at once: its announcement waits like the other requests'.
  const startGpsRequest = useEffectEvent(() => handleUseCurrentLocation(covered ? setDeferredAnnouncement : setAnnouncement));
  useEffect(() => {
    if (gpsRequest === handledGpsRequest.current) return;
    handledGpsRequest.current = gpsRequest;
    startGpsRequest();
  }, [gpsRequest]);
  useApplyOnce(frame?.endpointRequest ?? null, (request) => {
    const announce = covered ? setDeferredAnnouncement : setAnnouncement;
    if (request.kind === "gps") {
      setFocused("start");
      setGpsRequest((n) => n + 1);
      return;
    }
    if (request.kind === "pick") {
      handleChooseOnMap(request.which, announce);
      return;
    }
    const { which, endpoint } = request;
    const wasGps = gpsEndpointKey(endpoints) === which;
    if (applyEndpoint(which, endpoint.point, "search", endpoint.label, announce, endpoint.place)) {
      // Like a pinned point: a pending "use current location" no longer applies to this end.
      if (which === "start") setGpsIntent(false);
      if (wasGps) setGpsStartAccuracy(null);
      // Only a lone end is centred; with both ends set the map fits the whole route.
      if (!endpoints[which === "start" ? "destination" : "start"]) bumpRecenter(endpoint.point, endpoint.label);
      // After the search page closes, focus goes back to this end's row (see the pick effect).
      if (covered) returnFocusTo.current = which;
    }
  });
  // "Open trip" on a saved trip card (loaded by useSavedTripReopen): restore both ends through the
  // same reducer, keeping where each came from, and reset the trip state around them.
  function restoreTrip(card: SavedTrip) {
    const announce = covered ? setDeferredAnnouncement : setAnnouncement;
    setFocusTarget(null);
    setGpsIntent(false);
    setRecenterOnFix(false);
    setLastOutcome(null);
    setGpsStartAccuracy(null);
    setSamePlaceRefused(null);
    dispatch({ type: "clearAll" });
    for (const which of ["start", "destination"] as const) {
      const end = card[which];
      dispatch({ type: "set", which, endpoint: { point: end.point, source: "search", label: end.label, ...(end.place ? { place: end.place } : {}) } });
    }
    setFocused(null);
    setOpenedId(null);
    if (sheet.snap === 0) sheet.setSnap(1);
    announce(`Saved trip: ${card.start.label} to ${card.destination.label}.`);
  }

  if (!covered && deferredAnnouncement !== null) {
    setDeferredAnnouncement(null);
    setAnnouncement(deferredAnnouncement);
  }

  // The screen the map is showing (screen-state.ts). The tab bar belongs to the map alone: it steps
  // aside for placing a pin, planning, a trip's detail and guidance (Back or Clear trip brings it back).
  // About 300 px of height (400 % zoom, a phone on its side): the tab bar would leave no room for
  // the content at half and full, so it steps aside there; collapsing to peek brings it back.
  const flags = { picking: picking !== null, ready, detail: tripDetailOpen, guiding };
  const screen = screenState(flags);
  const tinySheet = !atHome && sheet.height !== null && sheet.height < TINY_SHEET && sheet.snap > 0;
  // The sheet is not mounted on the bare map: it comes back at half, whatever detent it was left at.
  if (atHome && sheet.snap !== 1) sheet.setSnap(1);
  // Leaving the sheet or a pin for the bare map (Clear trip, a cleared end, a cancelled pin) puts focus on the search bar.
  const searchRef = useRef<HTMLAnchorElement>(null);
  const wasAtHome = useRef(atHome);
  useEffect(() => {
    const was = wasAtHome.current;
    wasAtHome.current = atHome;
    if (atHome && !was && !covered) searchRef.current?.focus({ preventScroll: true });
  }, [atHome, covered]);
  useHideTabBar(tabBarHidden(screen) || tinySheet);

  // One step out of the current screen: guidance (asks first), detail, directions. Escape and the
  // browser Back button both come here; the on-screen Back / End / Clear trip buttons do the same.
  const stepOutNow = () => {
    switch (stepOut(screen)) {
      case "cancel-pick":
        handleCancelPick();
        break;
      case "end-guidance":
        document.querySelector<HTMLButtonElement>('[data-testid="guidance-end"]')?.click();
        break;
      case "close-detail":
        if (stored) handleCloseStored();
        else handleCloseOption();
        break;
      case "clear-trip":
        handleClearAll();
        break;
      default:
        break;
    }
  };
  useStepHistory(historyDepth(flags), !covered, stepOutNow);
  const escapeOut = useEffectEvent(stepOutNow);
  useEffect(() => {
    if (covered || screen === "home" || screen === "picking") return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || e.defaultPrevented) return;
      // Not while a dialog or sheet above the map owns the key, or the app is covered and inert.
      if (homeRef.current?.closest("[inert]") || document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      escapeOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, screen]);
  if (!picking && pickPrompt !== null) setPickPrompt(null);

  const guidanceActions = homeGuidanceActions({
    home,
    endpoints,
    dispatch,
    // Guidance opens at half (the map's lines and legend stay in view), also from peek or full.
    liftSheet: () => {
      if (sheet.snap !== 1) sheet.setSnap(1);
    },
    dismissStored: reopen.dismissStored,
    setOpenedId,
    focusResults: () => setFocusTarget({ kind: "results" }),
    clearFocusTarget: () => setFocusTarget(null),
    setFocused,
    announce: setAnnouncement,
    clearAll: handleClearAll,
    resetPending: () => {
      setGpsIntent(false);
      setRecenterOnFix(false);
      setLastOutcome(null);
      setSamePlaceRefused(null);
    },
    setGpsStartAccuracy,
    recenter: () => bumpRecenter(),
  });

  return (
    <main ref={homeRef} className="pn-home" style={rootStyle} data-screen={screen} data-testid="home-screen">
      <h1 className="sr-only" tabIndex={-1} data-home-heading="">
        ParaNaga trip planner
      </h1>
      <div className="pn-home__map" inert={!atHome && sheet.snap === 2 && picking === null}>
        <NagaMap
          userFix={guiding ? (guidance.location.watching ? guidance.location.fix : null) : userFix}
          userStale={guiding ? false : (assessment?.stale ?? false)}
          pins={pins}
          highlightStops={highlightStops}
          highlightPaddingBottom={Math.max(40, Math.round(sheet.visible) - mapInset)}
          refitSignal={sheet.snap}
          fitBoundsCoords={routeFitCoords}
          fitId={previewOption?.id ?? "ends"}
          fitPathReady={tripLines !== null && tripLines.allCoords.length > 0}
          crosshair={picking !== null}
          onCenterChange={handleCenterChange}
          recenterSignal={recenterSignal}
          recenterTarget={recenterTarget}
          recenterTargetLabel={recenterLabel}
          stopPins={atHome || picking !== null ? stopsInView.stops : NO_PINS}
          stopPinsInteractive={atHome}
          onStopSelect={handleStopSelect}
          onBoundsChange={setViewBounds}
          onLocate={handleLocate}
          tripLines={tripLines}
          activeLegIndex={guiding ? home.activeLegIndex : null}
          fitTripLines={!guiding}
          routeLines={overviewLines}
          routeLinesDimmed={layerPolicy.overviewStandIn}
          legendNotice={legendNotice}
          selectedRouteCode={selectedRouteCode}
          onSelectRoute={showOverview ? setSelectedRouteCode : null}
          terminals={mapTerminals}
          onTerminalSelect={picking === null ? handleTerminalSelect : null}
          legend={mapLegend}
          onOpenLayers={showOverview ? () => setLayersOpen(true) : undefined}
          layersButtonRef={layersBtnRef}
        />
        {selectedRoute ? <SelectedRouteCard route={selectedRoute} onClose={() => setSelectedRouteCode(null)} /> : null}
      </div>
      <LayersSheet
        open={layersOpen && showOverview}
        onClose={closeLayers}
        layers={layers}
        onUpdateLayers={updateLayers}
        tracedLines={overviewLines}
        linesLoaded={lines !== null}
        terminals={snapshotState.snapshot?.terminals ?? null}
      />

      {!guiding && fixInside && geo.fix ? (
        <div
          className={`${assessment?.quality === "precise" ? "pn-pill" : "pn-pill pn-pill--approximate"}${fixAge ? " pn-pill--stale" : ""}`}
          data-testid="accuracy-pill"
          data-stale={fixAge ? "true" : undefined}
        >
          <PillMark />
          <span>
            Location {formatAccuracy(geo.fix.accuracy)}
            {fixAge ? ` · ${fixAge}` : null}
          </span>
        </div>
      ) : null}

      {picking ? (
        <section
          ref={pickRef}
          className="pn-pick"
          aria-label={picking === "start" ? "Choose start on map" : "Choose destination on map"}
        >
          <p className="pn-pick__title">
            {picking === "start" ? (pickPrompt ?? "Move the map to your start") : "Move the map to your destination"}
          </p>
          {!center.inside ? (
            <p id="pn-pick-blocked" className="pn-pick__hint pn-pick__hint--warn" data-testid="pick-outside-hint">
              Pin must be in Naga City
            </p>
          ) : pickSamePlace ? (
            <p id="pn-pick-blocked" className="pn-pick__hint pn-pick__hint--warn" data-testid="pick-same-place-hint">
              {SAME_PLACE_TITLE}. {SAME_PLACE_HINT}
            </p>
          ) : (
            <p className="pn-pick__hint">The pin marks the centre of the map.</p>
          )}
          <button
            ref={confirmRef}
            type="button"
            className="pn-btn pn-btn--primary"
            aria-disabled={pickBlocked ? true : undefined}
            aria-describedby={pickBlocked ? "pn-pick-blocked" : undefined}
            onClick={handleConfirmPick}
          >
            {picking === "start" ? "Set start here" : "Set destination here"}
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={handleCancelPick}>
            Cancel
          </button>
        </section>
      ) : atHome ? (
        <>
          <HomeSearchBar searchRef={searchRef} />
          {showStatus && statusCopy ? (
            <div className="pn-home__status">
              <LocationStatus copy={statusCopy} onPickStart={() => (statusCopy.kind === "approximate" ? handleMoveStartPin() : handleChooseOnMap("start"))} />
            </div>
          ) : null}
        </>
      ) : (
        <EndpointSheet
          sheet={sheet}
          endpoints={endpoints}
          focused={focused}
          startSub={startSub}
          destinationSub={destinationSub}
          // Activating a row always shows its options (a first tap on the highlighted row must not hide them).
          onFocus={setFocused}
          onClear={handleClear}
          onSwap={handleSwap}
          onUseCurrentLocation={() => handleUseCurrentLocation()}
          onChooseOnMap={handleChooseOnMap}
          detailOpen={tripDetailOpen || guiding}
          summary={
            optionsListed && planData ? (
              <OptionsPeek data={planData} etaModel={snapshotState.snapshot?.etaModel} expanded={sheet.snap === 2} listShown={sheet.snap !== 0} notes={peekNotes} onToggle={handleToggleOptions} onExtraHeight={setPeekExtra} />
            ) : null
          }
        >
          {guiding ? (
            <Guidance guidance={guidance} covered={covered} onEnd={guidanceActions.end} onDone={guidanceActions.done} onReplan={guidanceActions.replan} />
          ) : stored ? (
            <TripDetail
              data={stored.data}
              option={stored.option}
              onBack={handleCloseStored}
              ends={stored.ends}
              note={stored.note}
              onStart={(walkLengths) => guidanceActions.start(stored.data, stored.option, stored.ends, { etaModel: snapshotState.snapshot?.etaModel ?? null, walkLengths, ridePaths: ridePathsFor(stored.option, tripRevisionLines) })}
              etaModel={snapshotState.snapshot?.etaModel}
              routes={snapshotState.snapshot?.routes}
              terminals={snapshotState.snapshot?.terminals}
            />
          ) : ready && openOption && planData && endpoints.start && endpoints.destination ? (
            <TripDetail
              data={planData}
              option={openOption}
              onBack={handleCloseOption}
              ends={{ start: endFor(endpoints.start), destination: endFor(endpoints.destination) }}
              note={reopen.note ?? (plan.status === "ready" && plan.offline ? { text: offlinePlanNote(planData.revision.publishedAt, plan.offline), tone: "warning" } : null)}
              onStart={(walkLengths) =>
                guidanceActions.start(planData, openOption, { start: endFor(endpoints.start!), destination: endFor(endpoints.destination!) }, { etaModel: snapshotState.snapshot?.etaModel ?? null, walkLengths, ridePaths: ridePathsFor(openOption, tripRevisionLines) })
              }
              etaModel={snapshotState.snapshot?.etaModel}
              routes={snapshotState.snapshot?.routes}
              terminals={snapshotState.snapshot?.terminals}
            />
          ) : ready ? (
            <>
              {reopen.changed ? (
                <p className="pn-trip-reopen pn-trip-reopen--warn" role="status" data-testid="trip-changed-note">
                  Changed since saved
                </p>
              ) : null}
              {plan.status === "ready" && plan.offline ? (
                <p className="pn-trip-reopen pn-trip-reopen--warn" role="status" data-testid="trip-offline-note">
                  {offlinePlanNote(plan.data.revision.publishedAt, plan.offline)}
                </p>
              ) : null}
              {plan.status === "loading" ? <TripLoading /> : null}
              {plan.status === "error" ? <TripError kind={plan.kind} onRetry={handleRetry} onChangeEndpoints={handleChangeEndpoints} /> : null}
              {planData && planData.plan.coverage === "none" ? (
                <TripNoCoverage data={planData} />
              ) : null}
              {planData && planData.plan.coverage === "provisional" ? (
                <TripOptions
                  data={planData}
                  refreshing={plan.status === "ready" && plan.refreshing}
                  onOpen={handleOpenOption}
                  etaModel={snapshotState.snapshot?.etaModel}
                  routes={snapshotState.snapshot?.routes}
                />
              ) : null}
              <button type="button" className="pn-text-btn" onClick={handleClearAll}>
                Clear trip
              </button>
            </>
          ) : null}
          {samePlaceRefused && !openOption && !guiding ? (
            <SamePlaceNotice which={samePlaceRefused} onChooseOnMap={() => handleChooseOnMap(samePlaceRefused)} />
          ) : null}
          {showStatus && statusCopy && !openOption && !samePlaceRefused && !guiding ? (
            <LocationStatus copy={statusCopy} onPickStart={() => (statusCopy.kind === "approximate" ? handleMoveStartPin() : handleChooseOnMap("start"))} />
          ) : null}
        </EndpointSheet>
      )}

      {/* The list alternative to the stop pins: out of sight on the map, and listed visibly in Search. */}
      {!picking && !guiding && !tripDetailOpen && !searchCovers ? (
        <div className="pn-home__nearby">
          <NearbyStops onOpen={markHomeNavigation} stops={stopsInView.stops} center={center.point} status={stopsInView.status} truncated={stopsInView.truncated} />
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" data-testid="home-announcer">
        {announcement}
      </p>
    </main>
  );
}
