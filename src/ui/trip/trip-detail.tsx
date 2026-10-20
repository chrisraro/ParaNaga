"use client";

// Trip detail (artboard TripDetail) inside the home sheet. Ordered legs:
//   Walk ≈ m to <stop> (code) · path not verified
//   Board Loop A at <stop> · direction · "Signboard unverified" · N stops
//   Get off at <stop> + "Para!" tip (no buzz promise: there is no live tracking)
//   Walk ≈ m to destination · path not verified
// then the fare per ride leg as estimates. Sources and credits are one small link in the top bar
// (U3); the steps carry no source text. The map highlights the boarding/alighting stops only.
//
// Actions (Task 8): Save ("Save" / "Saved", a saved trip on this phone) and Share (the Web Share
// API with a text-only summary, else copy to the clipboard: "Copied"). The summary names places
// and stops only; exact points are added only when "Include exact points" is ticked. "Start
// trip" (Task 10) starts guidance in this sheet. An optional note above the steps says how the trip was
// reopened ("Updated", or that it is shown as saved, offline).

import "./trip.css";

import Link from "next/link";
import { ReportLink } from "@/ui/report/report-link";
import { ViewTransition, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLines } from "@/client/network/use-lines";
import { WALK_GRAPH_DOWNLOAD_LABEL, useWalkGraphDownload } from "@/client/network/use-walk-graph";
import { useSavedTripToggle } from "@/client/saved/use-saved-trip-toggle";
import type { PadyakLegDto, PlanOptionDto, PlanResponse, RideLegDto, TricycleLegDto, WalkLegDto } from "@/domain/api/plan";
import type { EtaModel, NetworkSnapshot } from "@/domain/api/schemas";
import { PATH_LABEL } from "@/domain/api/schemas";
import type { EtaEstimate, EtaLeg } from "@/domain/eta/eta";
import { formatLeg } from "@/domain/eta/format";
import { FARE_NOT_FIXED, isAccessOption, isSpecialTrip, specialFareText, streetCardView, tricycleTerminalLines, viaChipText } from "@/domain/trip/option-card";
import { optionNotesView, type OptionNotesView } from "@/domain/trip/option-notes";
import { rideEnds } from "@/domain/trip/ride-ends";
import { nearestTricycleTerminal } from "@/domain/trip/tricycle-hint";
import { WALK_PATHS_OFFLINE_NOTE } from "@/domain/pwa/offline-copy";
import { WALK_LOADING_LABEL, WALK_OFFLINE_LABEL, type EnrichedWalkLeg } from "@/domain/trip/enrich";
import { LineNotesView } from "@/ui/map/line-notes-view";
import { UNTRACED_RIDE_LABEL, rideTrace, type RideTrace } from "@/ui/map/line-rules";
import { buildSavedTrip, manilaDate, shareText, type SavedEnd } from "@/domain/saved/saved";
import { directionText, fareChipText, formatDistance, isNegligibleWalk, optionTitle, routeChipLabel } from "@/domain/trip/present";
import type { LatLng } from "@/domain/geo/types";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { SheetBar } from "@/ui/app-shell/sheet-bar";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { EtaBasisSheet } from "./eta-basis-sheet";
import { EtaPeakNote, EtaTotalText, SpokenRange, extractWalkLengths, useMinuteTicker, useOptionEta } from "./eta-text";
import { RouteNote } from "./route-note";
import { ServiceWindowNote } from "./service-window-note";
import { FareChip, FarNote, UnverifiedBadge, planLookups, type PlanLookups } from "./trip-parts";

export type TripEnds = { start: SavedEnd; destination: SavedEnd };
export type TripNote = { text: string; tone: "info" | "warning" };

type Props = {
  data: PlanResponse;
  option: PlanOptionDto;
  onBack: () => void;
  /** The trip's ends (labels and points), for Save and Share. Without them there are no actions. */
  ends?: TripEnds | null;
  /** How this trip was reopened from Saved; shown above the steps. */
  note?: TripNote | null;
  /** "Start trip": starts guidance (Task 10) with the walk-graph lengths the estimate used. Without it there is no Start button. */
  onStart?: ((walkLengths: (number | null)[]) => void) | null;
  etaModel?: EtaModel | null;
  /** The snapshot routes (the evidence behind ride notes) and terminals (the nearest tricycle terminal). */
  routes?: NetworkSnapshot["routes"] | null;
  terminals?: NetworkSnapshot["terminals"] | null;
};

const CANDIDATE = "Mapped candidate · not yet verified";

function walkTitle(leg: WalkLegDto, lookups: PlanLookups): string {
  const d = formatDistance(leg.estimateMeters);
  if (leg.to.kind === "destination") return `Walk ${d} to your destination`;
  const name = leg.to.stopId ? lookups.stopName(leg.to.stopId, leg.to.name ?? "the stop") : (leg.to.name ?? "the stop");
  return `Walk ${d} to ${name}`;
}

function Marker({ kind }: { kind: "origin" | "board" | "alight" | "destination" | "walk" }) {
  if (kind === "origin" || kind === "walk") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="7" className={kind === "origin" ? "pn-tl-dot pn-tl-dot--origin" : "pn-tl-dot pn-tl-dot--walk"} strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "board") {
    return (
      <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle cx="17" cy="17" r="12" className="pn-tl-dot pn-tl-dot--board" strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "alight") {
    return (
      <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle cx="17" cy="17" r="11" className="pn-tl-dot pn-tl-dot--alight" strokeWidth="5" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <circle cx="17" cy="17" r="12" className="pn-tl-dot pn-tl-dot--dest" />
      <circle cx="17" cy="17" r="5" fill="#FFFFFF" />
    </svg>
  );
}

type Step = { key: string; marker: Parameters<typeof Marker>[0]["kind"]; rail: "walk" | "ride" | null; body: ReactNode };

/** What the steps need besides the plan: how the person named the ends, the notes and the terminals. */
type StepContext = { start: string; destination: string; notes: OptionNotesView; terminals: NetworkSnapshot["terminals"] | null; planTerminals?: PlanOptionDto["tricycleTerminals"]; showOnMap: ((point: LatLng) => void) | null };

function steps(option: PlanOptionDto, lookups: PlanLookups, traceOf: (leg: RideLegDto) => RideTrace, ctx: StepContext, estimate?: EtaEstimate | null): Step[] {
  const out: Step[] = [];
  const last = option.legs.length - 1;
  const lastRide = option.legs.map((l) => l.kind).lastIndexOf("ride");
  // A free board point with no pin name reads as the place the person is at: the start, or where the last ride got off.
  let here = ctx.start;
  option.legs.forEach((leg, i) => {
    if (leg.kind === "walk" && option.rides > 0 && isNegligibleWalk(leg)) {
      // The point is at the stop itself: no "Walk ≈ 0 m" step. The first such leg becomes a
      // "Start at" step (board here), a transfer one is folded into the next "Board" step, and
      // the last one turns the final step into "Arrive".
      if (i === 0) {
        const name = leg.to.stopId ? lookups.stopName(leg.to.stopId, leg.to.name ?? "the stop") : (leg.to.name ?? "the stop");
        out.push({
          key: `w${i}`,
          marker: "origin",
          rail: "walk",
          body: (
            <>
              <strong className="pn-tl__title">Start at {name}</strong>
            </>
          ),
        });
      } else if (i === last) {
        out.push({ key: `w${i}`, marker: "destination", rail: null, body: <strong className="pn-tl__title">You’re there</strong> });
      }
      return;
    }
    if (leg.kind === "walk") {
      // The final walk carries the destination marker (artboard); a walk-only trip keeps the
      // origin marker and ends with an "Arrive" step.
      const final = i === last && i > 0;
      const etaLeg = estimate?.legs[i];
      out.push({
        key: `w${i}`,
        marker: i === 0 ? "origin" : final ? "destination" : "walk",
        rail: final ? null : "walk",
        body: (
          <>
            <strong className="pn-tl__title">{walkTitle(leg, lookups)}</strong>
            <WalkTime leg={etaLeg} path={(leg as { path?: { kind?: string } }).path?.kind === "path" ? "street" : "straight"} />
            {(leg as { path?: { label?: string } }).path?.label === WALK_OFFLINE_LABEL ? <p className="pn-tl__sub">{WALK_PATHS_OFFLINE_NOTE}</p> : null}
          </>
        ),
      });
      return;
    }
    if (leg.kind === "tricycle" || leg.kind === "padyak") {
      // Not the last leg (the access option): the tricycle ends at its named loading point.
      out.push(...streetSteps(leg, i, i < last ? { ...ctx, toName: leg.to.name ?? "the jeepney" } : ctx));
      // The rider is now at the loading point: an unnamed board point next reads as there, not as the start.
      if (i < last) here = leg.to.name ?? "the jeepney";
      return;
    }
    if (leg.kind !== "ride") return;
    const ride = rideSteps(leg, i, lookups, traceOf(leg), ctx, here, i === lastRide, estimate);
    here = ride.alightName;
    out.push(...ride.steps);
  });
  if (last === 0) out.push({ key: "dest", marker: "destination", rail: null, body: <strong className="pn-tl__title">Arrive</strong> });
  return out;
}

function rideSteps(
  leg: RideLegDto,
  i: number,
  lookups: PlanLookups,
  trace: RideTrace,
  ctx: StepContext,
  here: string,
  isLastRide: boolean,
  estimate?: EtaEstimate | null,
): { steps: Step[]; alightName: string } {
  const ends = rideEnds(leg, isLastRide ? ctx.destination : undefined);
  if (!ends) return { steps: [], alightName: here };
  const { board, alight } = ends;
  const boardNamed = ends.pinned || Boolean(leg.board?.stopId || leg.board?.name);
  const alightNamed = ends.pinned || Boolean(leg.alight?.stopId || leg.alight?.name);
  const boardName = boardNamed ? lookups.stopName(board.id, board.name) : here;
  const alightName = alightNamed ? lookups.stopName(alight.id, alight.name) : isLastRide ? alight.name : "the transfer point";
  const rideNotes = ctx.notes.rides.find((r) => r.legIndex === i)?.notes ?? [];
  const route = routeChipLabel(leg.routeCode, leg.routeName, leg.display);
  const dir = directionText(lookups.direction(leg.variantId), "short", route);
  const count = ends.pinned ? ends.stops.length - 1 : null;
  const pathLabel = trace.untraced ? UNTRACED_RIDE_LABEL : PATH_LABEL;
  const etaLeg = estimate?.legs[i];
  const fleet = leg.fleet;

  const built: Step[] = [
    {
      key: `b${i}`,
      marker: "board",
      rail: "ride",
      body: (
        <div className="pn-tl__stack">
          <div>
            {ends.pinned ? (
              <strong className="pn-tl__title">
                Board {route}{dir ? ` (${dir})` : ""} at {boardName}
              </strong>
            ) : (
              <>
                <strong className="pn-tl__title">Get on near {boardName}</strong>
                <p className="pn-tl__sub pn-tl__sub--gold">{boardNamed ? CANDIDATE : "Stop not marked · confirm with the driver"}</p>
                {dir ? <p className="pn-tl__sub">Direction: {dir}</p> : null}
              </>
            )}
            {fleet.classes.length > 0 ? (
              // Each vehicle class with its evidence label and date (not a nested list: the steps are the list).
              fleet.classes.map((c) => (
                <p key={`${c.vehicleClass}-${c.status}`} className="pn-tl__sub" data-testid="ride-fleet-class">
                  {/* An operating class is its name; any other status keeps its evidence ("reported, not confirmed"). */}
                  {c.status === "operating" ? c.label.split(" · ")[0] : c.label}
                </p>
              ))
            ) : (
              <p className="pn-tl__sub" data-testid="ride-fleet-class">Vehicle type not confirmed</p>
            )}
          </div>
          <p className="pn-tl__sub">
            {count === null ? "Ride along the approximate path" : `${count} ${count === 1 ? "stop" : "stops"}`}
          </p>
          {etaLeg ? <LegTime leg={etaLeg} /> : null}
          <p className="pn-tl__sub pn-tl__sub--path-label" data-testid="ride-path-label">
            {pathLabel}
          </p>
          {leg.stops.length > 0 ? (
            <p className="pn-tl__sub" data-testid="ride-passed-stops">
              Marked stops on the way: {leg.stops.map((s) => lookups.stopName(s.id, s.name)).join(", ")}
            </p>
          ) : null}
          <LineNotesView notes={trace.notes} testIdPrefix="ride" />
          {rideNotes.length > 0 ? (
            <div className="pn-tl__notes" data-testid="ride-route-notes">
              {rideNotes.map((n) => (
                <RouteNote key={n.text} note={n} />
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: `a${i}`,
      marker: "alight",
      rail: "walk",
      body: (
        <div className="pn-tl__stack">
          <div>
            {ends.pinned ? (
              <strong className="pn-tl__title">Get off at {alightName}</strong>
            ) : (
              <>
                <strong className="pn-tl__title">Get off near {alightName}</strong>
                <p className="pn-tl__sub" data-testid="ride-free-alight">
                  Tell the driver &lsquo;para&rsquo; · stop not marked
                </p>
                {alightNamed ? <p className="pn-tl__sub pn-tl__sub--gold">{CANDIDATE}</p> : null}
              </>
            )}
          </div>
          <div className="pn-para">
            <span>Say “Para!” near here</span>
          </div>
        </div>
      ),
    },
  ];
  return { steps: built, alightName };
}

/** A tricycle or padyak step: the destination, how far and on what basis, then the planner notes (rules, fare, "time not estimated"). */
function streetSteps(leg: TricycleLegDto | PadyakLegDto, i: number, ctx: StepContext & { toName?: string }): Step[] {
  const v = streetCardView(leg);
  const terminal = leg.kind === "tricycle" ? nearestTricycleTerminal(leg.from, leg.to, ctx.terminals ?? []) : undefined;
  return [
    {
      key: `s${i}`,
      marker: "board",
      rail: "ride",
      body: (
        <div className="pn-tl__stack">
          <div>
            <strong className="pn-tl__title">
              Take a {leg.kind} to {ctx.toName ?? ctx.destination}
            </strong>
            {v.headline ? (
              <p className="pn-tl__sub pn-tl__sub--gold" data-testid="street-state">
                {v.headline}
              </p>
            ) : null}
            {v.distanceText ? (
              <p className="pn-tl__sub" data-testid="street-distance">
                {v.distanceText}
              </p>
            ) : null}
          </div>
          <div className="pn-tl__notes" data-testid="street-notes">
            {leg.notes.filter((n) => n !== v.headline).map((n) => (
              <p key={n} className="pn-tl__sub">
                {n}
              </p>
            ))}
            {tricycleTerminalLines({ tricycleTerminals: ctx.planTerminals }).map((t) => (
              <p key={t.key} className="pn-tl__sub" data-testid="tricycle-terminal">
                {t.text}
                {t.toda ? <span data-testid="tricycle-toda"> · {t.toda}</span> : null}
              </p>
            ))}
            {terminal && !ctx.planTerminals ? (
              <p className="pn-tl__sub" data-testid="tricycle-terminal">
                Nearest tricycle terminal: {terminal.name}, about {Math.round(terminal.distanceM / 10) * 10} m
                {ctx.showOnMap ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="pn-btn pn-btn--secondary"
                      aria-label={`Show on map: ${terminal.name}`}
                      data-testid="tricycle-terminal-show"
                      onClick={() => ctx.showOnMap?.({ lat: terminal.lat, lng: terminal.lng })}
                    >
                      Show on map
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
  ];
}

/** "≈ 5–7 min walk" (+ " · path not verified" on a walk), the range spoken in words; "Tricycle time not estimated". */
function LegTime({ leg, note, path }: { leg: EtaLeg; note?: string; path?: "street" | "straight" }) {
  const text = leg.estimated && note ? `${formatLeg(leg)} · ${note}` : formatLeg(leg);
  return (
    <p className="pn-tl__sub pn-tl__sub--time" data-testid="leg-time" data-path={path}>
      <SpokenRange text={text} range={leg} />
    </p>
  );
}

const WALK_NOTE = "path not verified";

/** A walk’s one line: the time with "path not verified" (data-path says street path or straight line), or just that note without an estimate. */
function WalkTime({ leg, path }: { leg?: EtaLeg; path: "street" | "straight" }) {
  return leg ? <LegTime leg={leg} note={WALK_NOTE} path={path} /> : <p className="pn-tl__sub" data-path={path}>Path not verified</p>;
}

type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

async function shareOrCopy(text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Not allowed here (no user activation, unsupported data): fall back to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

const SHARE_STATUS: Record<ShareOutcome, string> = {
  shared: "Shared",
  copied: "Copied",
  cancelled: "",
  failed: "Could not share or copy on this phone.",
};

function TripActions({ data, option, ends, exactPoints, etaModel, walkLengths }: { data: PlanResponse; option: PlanOptionDto; ends: TripEnds; exactPoints: boolean; etaModel: EtaModel | null; walkLengths: (number | null)[] }) {
  const [status, setStatus] = useState("");
  const newCard = () => buildSavedTrip({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), data, option, start: ends.start, destination: ends.destination });
  // Saved on this plan's revision, saved on an older one (offer to update the copy), or not saved.
  const { match, kind: state, waiting, unavailable, toggle } = useSavedTripToggle(
    { optionId: option.id, start: ends.start.point, destination: ends.destination.point, revisionId: data.revision.revisionId },
    newCard,
    setStatus,
  );

  const share = async () => {
    setStatus("");
    const text = shareText(
      { start: ends.start, destination: ends.destination, option, stops: data.stops, variants: data.variants, revisionLabel: data.revision.label },
      { exactPoints, etaModel, walkLengths },
    );
    setStatus(SHARE_STATUS[await shareOrCopy(text)]);
  };

  return (
    <div className="pn-trip-actions" data-testid="trip-actions">
      <div className="pn-trip-actions__row">
        {/* Not a pressed-state toggle: the name says what a tap does ("Saved, remove…"). */}
        <button
          type="button"
          className={state === "saved" ? "pn-trip-action pn-trip-action--on" : "pn-trip-action"}
          aria-disabled={waiting || unavailable ? true : undefined}
          onClick={() => void toggle()}
          data-testid="trip-save"
          data-state={state}
          aria-label={state === "saved" ? "Saved, remove from saved trips" : undefined}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={state === "none" ? "none" : "currentColor"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M6 3h12v18l-6-4.5L6 21z" />
          </svg>
          {state === "saved" ? (
            "Saved"
          ) : state === "older" ? (
            "Update saved copy"
          ) : (
            "Save"
          )}
        </button>
        <button type="button" className="pn-trip-action" onClick={() => void share()} data-testid="trip-share">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />
          </svg>
          Share
        </button>
      </div>
      {match?.kind === "older" ? (
        <p className="pn-trip-actions__status" data-testid="trip-save-older">
          Saved copy: {manilaDate(match.trip.publishedAt) ?? `revision ${match.trip.revisionLabel}`}
        </p>
      ) : null}
      {unavailable ? <p className="pn-trip-actions__status">Saving isn’t available on this phone.</p> : null}
      <p className="pn-trip-actions__status" aria-live="polite" data-testid="trip-action-status">
        {status}
      </p>
    </div>
  );
}

export const START_TRIP = "Start trip";

export function TripDetail({ data, option, onBack, ends = null, note = null, onStart = null, etaModel = null, routes = null, terminals = null }: Props) {
  const [basisOpen, setBasisOpen] = useState(false);
  const [exactPoints, setExactPoints] = useState(false);
  const shareId = useId();
  const lookups = planLookups(data);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus the heading when an option opens, and again once the map shows (a trip reopened from
  // Saved mounts while the Saved page still covers the home screen, which is inert then).
  const frame = useAppFrame();
  const covered = frame?.panelOpen ?? false;
  useEffect(() => {
    if (!covered) headingRef.current?.focus();
  }, [option.id, covered]);
  const rides = option.legs.filter((l): l is RideLegDto => l.kind === "ride");
  // Lines only add the one-way caution / terminal access notes; whether a ride is traced comes from
  // the leg itself (rideTrace), so low-data mode (no lines loaded) still says it right.
  const { lines } = useLines(data.revision.revisionId);
  const circular = useMemo(() => new Map(data.variants.map((v) => [v.variantId, v.isCircular])), [data.variants]);
  const traceOf = (leg: RideLegDto) => rideTrace(leg, lines, circular.get(leg.variantId) ?? false);
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);
  const now = useMinuteTicker();
  const notes = useMemo(() => optionNotesView(option, routes, now), [option, routes, now]);
  const stepContext: StepContext = { start: ends?.start.label || "your start", destination: ends?.destination.label || "your destination", notes, terminals, planTerminals: option.tricycleTerminals, showOnMap: frame ? frame.showOnMap : null };
  const noMinutes = estimate !== null && !estimate.legs.some((l) => l.estimated);
  const streets = option.legs.filter((l): l is TricycleLegDto | PadyakLegDto => l.kind === "tricycle" || l.kind === "padyak");
  const access = isAccessOption(option);
  const via = viaChipText(option);

  // Walk legs show "Straight line · loading street paths…" until the walk graph arrives: say so politely.
  const loadingPaths = option.legs.some((l) => l.kind === "walk" && (l as Partial<EnrichedWalkLeg>).path?.kind === "straight" && (l as EnrichedWalkLeg).path.label === WALK_LOADING_LABEL);
  const [sawLoadingPaths, setSawLoadingPaths] = useState(false);
  if (loadingPaths && !sawLoadingPaths) setSawLoadingPaths(true);
  // "Updated" only when a street path really arrived; a failed load says nothing.
  const gotStreetPaths = option.legs.some((l) => l.kind === "walk" && (l as Partial<EnrichedWalkLeg>).path?.kind === "path");
  const pathsStatus = loadingPaths ? "Loading street paths…" : sawLoadingPaths && gotStreetPaths ? "Street paths updated" : "";
  // Low-data opt-in (Task 15 follow-up): the walk graph downloads only on this tap, then stays stored.
  const pathsDownload = useWalkGraphDownload(data.revision.revisionId);
  const downloadPaths = async () => {
    if (pathsDownload.busy) return;
    // The button goes away once the paths arrive: keep focus in the sheet, on the heading.
    if (await pathsDownload.download()) headingRef.current?.focus();
  };

  return (
    <section className="pn-trip pn-trip-detail" aria-labelledby="pn-trip-detail-title" data-testid="trip-detail">
      <ViewTransition name="pn-trip-ends">
        <div className="pn-trip-detail__bar">
          <button type="button" className="pn-trip-back" aria-label="Back to trip options" onClick={onBack}>
            <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M10 2L2 10l8 8" />
            </svg>
          </button>
          <Link href={SOURCES_HREF} className="pn-trip-detail__sources" aria-label="Sources and credits">Sources</Link>
        </div>
      </ViewTransition>
      <div className="pn-trip-detail__header" data-testid="trip-detail-header">
        <h2 id="pn-trip-detail-title" ref={headingRef} tabIndex={-1} className="pn-trip-detail__title">
          {optionTitle(option)}
        </h2>
        <div className="pn-trip-detail__meta">
          {noMinutes && streets[0] ? (
            // A tricycle or padyak trip with no estimated leg: no minutes and no jeepney wait to report.
            <span className="pn-trip-detail__time" data-testid="trip-detail-time">{streetCardView(streets[0]).timeText}</span>
          ) : (
            <EtaTotalText estimate={estimate} className={estimate ? "pn-trip-detail__time" : undefined} testId="trip-detail-time" />
          )}
          <FareChip fare={option.fare} text={specialFareText(option)} />
        </div>
        {estimate?.total.peak ? (
          <p className="pn-trip-detail__peak">
            <EtaPeakNote estimate={estimate} testId="trip-peak-note" />
          </p>
        ) : null}
        {estimate && !noMinutes ? (
          <button type="button" className="pn-trip-detail__basis-btn" onClick={() => setBasisOpen(true)} data-testid="how-times-estimated-btn">
            How times are estimated
          </button>
        ) : null}
        {ends ? <TripActions data={data} option={option} ends={ends} exactPoints={exactPoints} etaModel={etaModel} walkLengths={walkLengths} /> : null}
      </div>
      {via || option.via?.note ? (
        <p className="pn-trip-detail__via" data-testid="detail-via">
          {via}
          {via && option.via?.note ? " · " : null}
          {option.via?.note}
        </p>
      ) : null}
      <FarNote note={data.plan.farNote} options={[option]} />
      {rides.length > 0 ? <UnverifiedBadge /> : null}
      {notes.serviceWindow ? <ServiceWindowNote note={notes.serviceWindow} /> : null}
      {note ? (
        <p className={note.tone === "warning" ? "pn-trip-reopen pn-trip-reopen--warn" : "pn-trip-reopen"} data-testid="trip-reopen-note">
          {note.text}
        </p>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-testid="trip-paths-status">
        {pathsStatus}
      </p>
      {pathsDownload.offer || pathsDownload.failed ? (
        <div className="pn-trip-paths-offer" data-testid="walk-graph-offer">
          <p className="pn-trip-paths-offer__text">Walks shown as straight lines.</p>
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-trip-paths-offer__btn"
            aria-disabled={pathsDownload.busy || undefined}
            onClick={() => void downloadPaths()}
            data-testid="walk-graph-download"
          >
            {pathsDownload.busy ? "Downloading street paths…" : WALK_GRAPH_DOWNLOAD_LABEL}
          </button>
          {pathsDownload.failed ? <p className="pn-trip-paths-offer__text" role="alert">Download failed. Try again.</p> : null}
        </div>
      ) : null}
      <ol className="pn-tl" aria-label="Trip steps">
        {steps(option, lookups, traceOf, stepContext, estimate).map((step) => (
          <li key={step.key} className="pn-tl__step">
            <div className="pn-tl__rail">
              <Marker kind={step.marker} />
              {step.rail ? <span className={step.rail === "ride" ? "pn-tl__line pn-tl__line--ride" : "pn-tl__line pn-tl__line--walk"} /> : null}
            </div>
            <div className="pn-tl__body">{step.body}</div>
          </li>
        ))}
      </ol>

      <section className="pn-fares" aria-labelledby="pn-fares-title">
        <h3 id="pn-fares-title">Fare estimate</h3>
        {rides.length === 0 && streets.length === 0 ? (
          <p className="pn-fares__row">
            <span>Walking only</span>
            <span>{fareChipText(option.fare)}</span>
          </p>
        ) : rides.length === 0 ? (
          streets.map((leg, i) => (
            <p key={i} className="pn-fares__row" data-testid="leg-fare">
              <span>{leg.kind === "tricycle" ? "Tricycle" : "Padyak"}</span>
              <span>{isSpecialTrip(option) ? FARE_NOT_FIXED : fareChipText(leg.fare)} · confirm with the driver</span>
            </p>
          ))
        ) : (
          <>
            {access
              ? streets.map((leg, i) => (
                  <p key={`s${i}`} className="pn-fares__row" data-testid="leg-fare">
                    <span>Tricycle</span>
                    <span>{fareChipText(leg.fare)} · confirm with the driver</span>
                  </p>
                ))
              : null}
            {rides.map((leg, i) => (
              <p key={i} className="pn-fares__row" data-testid="leg-fare">
                <span>{routeChipLabel(leg.routeCode, leg.routeName, leg.display)}</span>
                <span>{fareChipText(leg.fare)}</span>
              </p>
            ))}
            {rides.length > 1 || access ? (
              <p className="pn-fares__row pn-fares__row--total">
                <span>Total</span>
                <span>{specialFareText(option) ?? fareChipText(option.fare)}</span>
              </p>
            ) : null}
            <p className="pn-fares__note">
              {rides.some((leg) => leg.fare.span === "traditional_to_modern") ? "Range spans traditional and modern. " : ""}No discounts.{" "}
              <Link href={`${SOURCES_HREF}#fare-basis`}>How fares are estimated</Link>
            </p>
          </>
        )}
      </section>
      {rides.length > 0 ? <ReportLink entityType="fare" entityId={rides[0]!.routeCode} entityLabel={routeChipLabel(rides[0]!.routeCode, rides[0]!.routeName, rides[0]!.display)} /> : null}
      {ends ? (
        <div className="pn-trip-actions__check">
          <input id={`${shareId}-exact`} type="checkbox" checked={exactPoints} onChange={(e) => setExactPoints(e.target.checked)} data-testid="trip-share-exact" />
          <label htmlFor={`${shareId}-exact`}>Include exact points when sharing</label>
        </div>
      ) : null}
      {onStart ? (
        // In the sheet's footer: pinned to the bottom of the visible sheet at every snap.
        <SheetBar>
          <button type="button" className="pn-btn pn-btn--primary pn-trip-start" onClick={() => onStart(walkLengths)} data-testid="trip-start">
            {START_TRIP}
          </button>
        </SheetBar>
      ) : null}
      <EtaBasisSheet
        open={basisOpen}
        onClose={() => setBasisOpen(false)}
        model={etaModel}
      />
    </section>
  );
}
