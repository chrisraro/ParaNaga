"use client";

// Home screen S1 (/app): the Naga-locked map, the "Location ± N m" pill, and the trip sheet.
// Anyone, inside Naga or not, can set a start and destination by GPS (only a fresh, inside-city,
// not-coarse fix) or by pinning in crosshair mode. Coordinates stay in React state only.

import "./home-screen.css";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGeolocation } from "@/client/geo/use-geolocation";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import type { PlanResponse } from "@/domain/api/plan";
import { assessFix, type LocationFix } from "@/domain/geo/location-fix";
import { NAGA_DEFAULT_CENTER } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import {
  endpointsReducer,
  initialEndpointsState,
  isReadyToPlan,
  type EndpointWhich,
  type EndpointsState,
} from "@/domain/trip/endpoints";
import { NagaMap, type HighlightStop } from "@/ui/map/naga-map";
import { TripDetail } from "@/ui/trip/trip-detail";
import { TripOptions, optionDomId } from "@/ui/trip/trip-options";
import { TripError, TripLoading, TripNoCoverage } from "@/ui/trip/trip-status";
import { planLookups } from "@/ui/trip/trip-parts";
import { EndpointSheet, useSheet } from "./endpoint-sheet";
import { applyIfAccepted, gpsEndpointKey, shouldKeepWatching } from "./gps-policy";
import {
  LocationStatus,
  formatAccuracy,
  locationStatusCopy,
  type LocationStatusCopy,
} from "./location-status";

/** Peek sheet height (214) minus its 28px corner radius; keep in sync with home-screen.css. */
const MAP_BOTTOM_INSET = 186;

const NAME: Record<EndpointWhich, string> = { start: "Start", destination: "Destination" };

/** Which row to offer next after `which` was just set. */
function nextFocus(state: EndpointsState, which: EndpointWhich): EndpointWhich | null {
  if (which === "start") return state.destination ? null : "destination";
  return state.start ? null : "start";
}

/** Boarding and getting-off stops of an option's ride legs, for the map (markers only). */
function highlightsFor(data: PlanResponse, optionId: string): HighlightStop[] {
  const option = data.plan.options.find((o) => o.id === optionId);
  if (!option) return [];
  const lookups = planLookups(data);
  return option.legs.flatMap((leg) => {
    if (leg.kind !== "ride") return [];
    const board = leg.stops[0]!;
    const alight = leg.stops[leg.stops.length - 1]!;
    return [
      { id: board.id, lat: board.lat, lng: board.lng, role: "board" as const, label: lookups.stopName(board.id, board.name) },
      { id: alight.id, lat: alight.lat, lng: alight.lng, role: "alight" as const, label: lookups.stopName(alight.id, alight.name) },
    ];
  });
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

export function HomeScreen() {
  const geo = useGeolocation();
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
  // The last "outside Naga" status card, kept after the watch stops so its copy stays visible.
  const [lastOutcome, setLastOutcome] = useState<LocationStatusCopy | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sheet = useSheet(1);
  const [pickHeight, pickRef] = useMeasuredHeight();

  const bumpRecenter = (target: LatLng | null = null) => {
    setRecenterTarget(target);
    setRecenterSignal((n) => n + 1);
  };

  const ready = isReadyToPlan(endpoints);
  const plan = useTripPlan(endpoints.start?.point ?? null, endpoints.destination?.point ?? null);
  // The option whose detail is open, tied to the plan it came from: a new plan closes it.
  const [opened, setOpened] = useState<{ data: PlanResponse; id: string } | null>(null);
  const planData = plan.status === "ready" ? plan.data : null;
  const openOption = opened && planData === opened.data ? (planData.plan.options.find((o) => o.id === opened.id) ?? null) : null;
  const openOptionId = openOption?.id ?? null;
  const highlightStops = useMemo(
    () => (planData && openOptionId ? highlightsFor(planData, openOptionId) : undefined),
    [planData, openOptionId],
  );
  // After "Back to trip options", focus returns to the card that was opened.
  const returnToOption = useRef<string | null>(null);
  const watching = geo.state === "watching";
  const assessment = geo.assessment;
  const liveCopy = locationStatusCopy(geo.state, assessment, geo.fix?.accuracy ?? null);
  const statusCopy = liveCopy ?? lastOutcome;

  /** Sets an endpoint only if the reducer accepts it; announces and moves on only then. */
  const applyEndpoint = (which: EndpointWhich, point: LatLng, source: "gps" | "map"): boolean => {
    const endpoint = { point, source, label: "" };
    const { accepted, next } = applyIfAccepted(endpoints, which, endpoint);
    if (!accepted) {
      setAnnouncement("That spot is outside Naga City. Choose a point inside Naga City.");
      return false;
    }
    dispatch({ type: "set", which, endpoint });
    setFocused(nextFocus(next, which));
    setAnnouncement(`${NAME[which]} set: ${source === "gps" ? "Your location" : "Pinned location"}`);
    if (isReadyToPlan(next) && sheet.snap === 0) sheet.setSnap(1);
    return true;
  };

  const setStartFromGps = (fix: LocationFix) => {
    if (!applyEndpoint("start", toPoint(fix), "gps")) {
      setGpsIntent(false);
      return;
    }
    setGpsIntent(false);
    setGpsStartAccuracy(fix.accuracy);
    bumpRecenter();
  };

  // Announce each settled plan once.
  const [seenPlan, setSeenPlan] = useState<PlanResponse | null>(null);
  if (planData !== seenPlan) {
    setSeenPlan(planData);
    if (planData) {
      const n = planData.plan.options.length;
      setAnnouncement(
        planData.plan.coverage === "none" ? "No provisional route nearby yet" : `${n} provisional trip ${n === 1 ? "option" : "options"} found. Unverified route — confirm with the driver.`,
      );
    }
  }

  // React to each new assessment (new fix, or the hook's staleness re-check) during render,
  // React's "adjust state when a prop changes" pattern, so no effect chains are needed.
  const gpsKey = gpsEndpointKey(endpoints);
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
        fix.accuracy < gpsStartAccuracy
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
  const watchNeeded = shouldKeepWatching(endpoints, gpsIntent, recenterOnFix);
  const geoStop = geo.stop;
  const geoActive = geo.state === "requesting" || geo.state === "watching" || geo.state === "unavailable" || geo.state === "timeout";
  useEffect(() => {
    if (!watchNeeded && geoActive) geoStop();
  }, [watchNeeded, geoActive, geoStop]);

  const handleUseCurrentLocation = () => {
    setLastOutcome(null);
    if (watching && geo.fix) {
      const now = assessFix(geo.fix, Date.now());
      if (now.usableAsStart) {
        setStartFromGps(geo.fix);
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

  const handleChooseOnMap = (which: EndpointWhich) => {
    // Placing a pin cancels any pending GPS request, so a late fix can't take over the pick.
    if (which === "start") setGpsIntent(false);
    setRecenterOnFix(false);
    dispatch({ type: "pick", which });
    setAnnouncement(`Move the map to place the ${which === "start" ? "start" : "destination"} pin.`);
  };

  // When the pick panel closes, focus returns to the endpoint row that was set (or cancelled).
  const returnFocusTo = useRef<EndpointWhich | null>(null);

  const handleConfirmPick = () => {
    const which = endpoints.picking;
    if (!which || !center.inside) return;
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
    // Clearing drops any pending "use current location" (the watch effect stops GPS if unneeded).
    if (gpsEndpointKey(endpoints) === which) setGpsStartAccuracy(null);
    setGpsIntent(false);
    setRecenterOnFix(false);
    setLastOutcome(null);
    dispatch({ type: "clear", which });
    setFocused(which);
    setAnnouncement(`${NAME[which]} cleared`);
  };

  const handleOpenOption = (id: string) => {
    if (!planData) return;
    setOpened({ data: planData, id });
    if (sheet.snap === 0) sheet.setSnap(1);
  };

  const handleCloseOption = () => {
    returnToOption.current = opened?.id ?? null;
    setOpened(null);
  };

  useEffect(() => {
    if (openOption || returnToOption.current === null) return;
    document.getElementById(optionDomId(returnToOption.current))?.focus();
    returnToOption.current = null;
  }, [openOption]);

  const handleClearAll = () => {
    setGpsIntent(false);
    setRecenterOnFix(false);
    setLastOutcome(null);
    setGpsStartAccuracy(null);
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
  // closes, focus goes back to the endpoint row that was set or cancelled.
  const picking = endpoints.picking;
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!picking) {
      const row = returnFocusTo.current;
      returnFocusTo.current = null;
      if (row) document.querySelector<HTMLElement>(`[data-testid="endpoint-${row}"] .pn-endpoint__main`)?.focus();
      return undefined;
    }
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocusTo.current = picking;
      dispatch({ type: "cancelPick" });
      setAnnouncement("Pin cancelled");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const fixInside = watching && geo.fix !== null && assessment !== null && assessment.insideCity && !assessment.stale;
  const userFix = watching ? geo.fix : null;
  // The status card is about the start; once the user pinned a start it stops nagging.
  const showStatus = statusCopy !== null && statusCopy.kind !== "precise" && (!endpoints.start || endpoints.start.source === "gps");
  const startSub = gpsIntent && !endpoints.start && statusCopy?.kind === "requesting" ? "Finding your location…" : undefined;

  // The map ends MAP_BOTTOM_INSET above the screen bottom (just under the peek sheet's top), so
  // its centre (recentre target, crosshair) is never hidden behind the sheet. The attribution
  // rides the sheet's top edge, measured from the map's bottom.
  const attributionBottom = Math.max(0, (picking ? pickHeight : sheet.visible) - MAP_BOTTOM_INSET);
  const rootStyle = { ["--naga-map-attribution-bottom" as string]: `${Math.round(attributionBottom)}px` };

  const pins = {
    ...(endpoints.start && picking !== "start" ? { start: endpoints.start.point } : {}),
    ...(endpoints.destination && picking !== "destination" ? { destination: endpoints.destination.point } : {}),
  };

  return (
    <div className="pn-home" style={rootStyle} data-testid="home-screen">
      <h1 className="sr-only">ParaNaga trip planner</h1>
      <div className="pn-home__map">
        <NagaMap
          userFix={userFix}
          userStale={assessment?.stale ?? false}
          pins={pins}
          highlightStops={highlightStops}
          crosshair={picking !== null}
          onCenterChange={handleCenterChange}
          recenterSignal={recenterSignal}
          recenterTarget={recenterTarget}
          onLocate={handleLocate}
        />
      </div>

      {fixInside && geo.fix ? (
        <div
          className={assessment?.quality === "precise" ? "pn-pill" : "pn-pill pn-pill--approximate"}
          data-testid="accuracy-pill"
        >
          <PillMark />
          <span>Location {formatAccuracy(geo.fix.accuracy)}</span>
        </div>
      ) : null}

      {picking ? (
        <section
          ref={pickRef}
          className="pn-pick"
          aria-label={picking === "start" ? "Choose start on map" : "Choose destination on map"}
        >
          <p className="pn-pick__title">
            {picking === "start" ? "Move the map to your starting point" : "Move the map to your destination"}
          </p>
          {center.inside ? (
            <p className="pn-pick__hint">The pin marks the centre of the map.</p>
          ) : (
            <p id="pn-pick-outside" className="pn-pick__hint pn-pick__hint--warn" data-testid="pick-outside-hint">
              Move the pin inside Naga City
            </p>
          )}
          <button
            ref={confirmRef}
            type="button"
            className="pn-btn pn-btn--primary"
            aria-disabled={center.inside ? undefined : true}
            aria-describedby={center.inside ? undefined : "pn-pick-outside"}
            onClick={handleConfirmPick}
          >
            {picking === "start" ? "Set start here" : "Set destination here"}
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={handleCancelPick}>
            Cancel
          </button>
        </section>
      ) : (
        <EndpointSheet
          sheet={sheet}
          endpoints={endpoints}
          focused={focused}
          startSub={startSub}
          onFocus={(which) => setFocused((f) => (f === which ? null : which))}
          onClear={handleClear}
          onSwap={handleSwap}
          onUseCurrentLocation={handleUseCurrentLocation}
          onChooseOnMap={handleChooseOnMap}
          detailOpen={ready && openOption !== null}
        >
          {ready && openOption && planData ? (
            <TripDetail data={planData} option={openOption} onBack={handleCloseOption} />
          ) : ready ? (
            <>
              {plan.status === "loading" ? <TripLoading /> : null}
              {plan.status === "error" ? <TripError kind={plan.kind} onRetry={plan.retry} /> : null}
              {planData && planData.plan.coverage === "none" ? <TripNoCoverage data={planData} /> : null}
              {planData && planData.plan.coverage === "provisional" ? <TripOptions data={planData} onOpen={handleOpenOption} /> : null}
              <button type="button" className="pn-text-btn" onClick={handleClearAll}>
                Clear start and destination
              </button>
            </>
          ) : null}
          {showStatus && statusCopy && !openOption ? (
            <LocationStatus copy={statusCopy} onPickStart={() => (statusCopy.kind === "approximate" ? handleMoveStartPin() : handleChooseOnMap("start"))} />
          ) : null}
        </EndpointSheet>
      )}

      <p className="sr-only" aria-live="polite" data-testid="home-announcer">
        {announcement}
      </p>
    </div>
  );
}
