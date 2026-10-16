"use client";

// Trip detail (artboard TripDetail) inside the home sheet. Ordered legs:
//   Walk ≈ m to <stop> (code) · path not verified
//   Board Loop A at <stop> · direction (from pin order) · "Signboard not yet verified" · ride N stops
//   Get off at <stop> + "Para!" tip (no buzz promise: there is no live tracking)
//   Walk ≈ m to destination · path not verified
// then the fare per ride leg as estimates, and a plain "Corrections open soon." note (no
// correction flow yet, so no link and nothing that looks like a control). The map highlights the boarding/alighting stops only.
//
// Actions (Task 8): Save ("Save" / "Saved", a saved trip on this phone) and Share (the Web Share
// API with a text-only summary, else copy to the clipboard: "Copied"). The summary names places
// and stops only; exact points are added only when "Include exact points" is ticked. "Start
// trip" (Task 10) starts guidance in this sheet. An optional note above the steps says how the trip was
// reopened ("Re-planned on the current data", or that it is shown as saved, offline).

import "./trip.css";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLines } from "@/client/network/use-lines";
import { WALK_GRAPH_DOWNLOAD_LABEL, useWalkGraphDownload } from "@/client/network/use-walk-graph";
import { useSavedTripToggle } from "@/client/saved/use-saved-trip-toggle";
import type { PlanOptionDto, PlanResponse, RideLegDto, WalkLegDto } from "@/domain/api/plan";
import type { EtaModel } from "@/domain/api/schemas";
import { PATH_LABEL } from "@/domain/api/schemas";
import type { EtaEstimate, EtaLeg } from "@/domain/eta/eta";
import { formatLeg } from "@/domain/eta/format";
import { WALK_LOADING_LABEL, type EnrichedWalkLeg } from "@/domain/trip/enrich";
import { LineNotesView } from "@/ui/map/line-notes-view";
import { UNTRACED_RIDE_LABEL, rideTrace, type RideTrace } from "@/ui/map/line-rules";
import { buildSavedTrip, manilaDate, shareText, type SavedEnd } from "@/domain/saved/saved";
import { directionText, distanceBasisText, fareChipText, formatDistance, isNegligibleWalk, legFareText, rideFleetText, routeChipLabel } from "@/domain/trip/present";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { EtaBasisSheet } from "./eta-basis-sheet";
import { EtaPeakNote, EtaTotalText, SpokenRange, extractWalkLengths, useOptionEta } from "./eta-text";
import { FareChip, LoopChip, UnverifiedBadge, planLookups, type PlanLookups } from "./trip-parts";

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

function steps(option: PlanOptionDto, lookups: PlanLookups, traceOf: (leg: RideLegDto) => RideTrace, estimate?: EtaEstimate | null): Step[] {
  const out: Step[] = [];
  const last = option.legs.length - 1;
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
              <p className="pn-tl__sub">Board here</p>
            </>
          ),
        });
      } else if (i === last) {
        out.push({ key: `w${i}`, marker: "destination", rail: null, body: <strong className="pn-tl__title">Arrive: your destination is at this stop</strong> });
      }
      return;
    }
    if (leg.kind === "walk") {
      // The final walk carries the destination marker (artboard); a walk-only trip keeps the
      // origin marker and ends with an "Arrive" step.
      const final = i === last && i > 0;
      const walkPath = (leg as { path?: { kind?: string; label?: string } }).path;
      const pathLabel = walkPath?.label ?? "Estimate · path not verified";
      const etaLeg = estimate?.legs[i];
      out.push({
        key: `w${i}`,
        marker: i === 0 ? "origin" : final ? "destination" : "walk",
        rail: final ? null : "walk",
        body: (
          <>
            <strong className="pn-tl__title">{walkTitle(leg, lookups)}</strong>
            {etaLeg ? <LegTime leg={etaLeg} basis={etaLeg.basis === "graph_path" ? "along streets (approximate)" : "straight line"} /> : null}
            <p className="pn-tl__sub">{pathLabel.includes("path not verified") ? pathLabel : `${pathLabel} · path not verified`}</p>
          </>
        ),
      });
      return;
    }
    out.push(...rideSteps(leg, i, lookups, traceOf(leg), estimate));
  });
  if (last === 0) out.push({ key: "dest", marker: "destination", rail: null, body: <strong className="pn-tl__title">Arrive at your destination</strong> });
  return out;
}

function rideSteps(leg: RideLegDto, i: number, lookups: PlanLookups, trace: RideTrace, estimate?: EtaEstimate | null): Step[] {
  const board = leg.stops[0]!;
  const alight = leg.stops[leg.stops.length - 1]!;
  const boardName = lookups.stopName(board.id, board.name);
  const alightName = lookups.stopName(alight.id, alight.name);
  const route = routeChipLabel(leg.routeCode, leg.routeName);
  const dir = directionText(lookups.direction(leg.variantId), "long");
  const count = leg.stops.length - 1;
  const pathLabel = trace.untraced ? UNTRACED_RIDE_LABEL : PATH_LABEL;
  const etaLeg = estimate?.legs[i];
  const fleet = leg.fleet;

  return [
    {
      key: `b${i}`,
      marker: "board",
      rail: "ride",
      body: (
        <div className="pn-tl__stack">
          <div>
            <strong className="pn-tl__title">
              Board {route} at {boardName}
            </strong>
            <p className="pn-tl__sub pn-tl__sub--gold">{CANDIDATE}</p>
            {dir ? <p className="pn-tl__sub">Direction: {dir}</p> : null}
            <p className="pn-tl__sub" data-testid="ride-fleet">{rideFleetText(leg.mode, fleet)}</p>
            {fleet.classes.length > 0 ? (
              // Each vehicle class with its evidence label and date (not a nested list: the steps are the list).
              fleet.classes.map((c) => (
                <p key={`${c.vehicleClass}-${c.status}`} className="pn-tl__sub" data-testid="ride-fleet-class">
                  {c.label}
                </p>
              ))
            ) : (
              <p className="pn-tl__sub" data-testid="ride-fleet-class">Vehicle type not confirmed</p>
            )}
          </div>
          <div className="pn-sign">
            <span className="pn-sign__kicker">Signboard</span>
            <span className="pn-sign__text">Signboard not yet verified</span>
            <LoopChip leg={leg} />
          </div>
          <p className="pn-tl__sub">
            Ride {count} {count === 1 ? "stop" : "stops"} · {distanceBasisText(leg.distanceMeters, leg.distanceBasis)}
          </p>
          {etaLeg ? <LegTime leg={etaLeg} basis={leg.distanceBasis === "approximate_path" ? "along the approximate path" : "stop to stop (straight line)"} /> : null}
          <p className="pn-tl__sub pn-tl__sub--path-label" data-testid="ride-path-label">
            {pathLabel}
          </p>
          <LineNotesView notes={trace.notes} testIdPrefix="ride" />
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
            <strong className="pn-tl__title">Get off at {alightName}</strong>
            <p className="pn-tl__sub pn-tl__sub--gold">{CANDIDATE}</p>
          </div>
          <div className="pn-para">
            <span className="pn-para__word">Para!</span>
            <span>Say it to the driver as you near this stop.</span>
          </div>
        </div>
      ),
    },
  ];
}

/** "≈ 5–7 min walk · along streets (approximate)", the range spoken in words; "Tricycle time not estimated". */
function LegTime({ leg, basis }: { leg: EtaLeg; basis: string }) {
  const text = leg.estimated ? `${formatLeg(leg)} · ${basis}` : formatLeg(leg);
  return (
    <p className="pn-tl__sub pn-tl__sub--time" data-testid="leg-time">
      <SpokenRange text={text} range={leg} />
    </p>
  );
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

function TripActions({ data, option, ends, etaModel, walkLengths }: { data: PlanResponse; option: PlanOptionDto; ends: TripEnds; etaModel: EtaModel | null; walkLengths: (number | null)[] }) {
  const id = useId();
  const [exactPoints, setExactPoints] = useState(false);
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
          Your saved copy uses data from {manilaDate(match.trip.publishedAt) ?? `revision ${match.trip.revisionLabel}`}.
        </p>
      ) : null}
      {unavailable ? <p className="pn-trip-actions__status">Saving needs storage on this phone, which is not available.</p> : null}
      <div className="pn-trip-actions__check">
        <input id={`${id}-exact`} type="checkbox" checked={exactPoints} onChange={(e) => setExactPoints(e.target.checked)} data-testid="trip-share-exact" />
        <label htmlFor={`${id}-exact`}>Include exact points when sharing</label>
      </div>
      <p className="pn-trip-actions__status" aria-live="polite" data-testid="trip-action-status">
        {status}
      </p>
    </div>
  );
}

export const START_TRIP = "Start trip";

export function TripDetail({ data, option, onBack, ends = null, note = null, onStart = null, etaModel = null }: Props) {
  const [basisOpen, setBasisOpen] = useState(false);
  const lookups = planLookups(data);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus the heading when an option opens, and again once the map shows (a trip reopened from
  // Saved mounts while the Saved page still covers the home screen, which is inert then).
  const covered = useAppFrame()?.panelOpen ?? false;
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

  // Walk legs show "Straight line · loading street paths…" until the walk graph arrives: say so politely.
  const loadingPaths = option.legs.some((l) => l.kind === "walk" && (l as Partial<EnrichedWalkLeg>).path?.kind === "straight" && (l as EnrichedWalkLeg).path.label === WALK_LOADING_LABEL);
  const [sawLoadingPaths, setSawLoadingPaths] = useState(false);
  if (loadingPaths && !sawLoadingPaths) setSawLoadingPaths(true);
  const pathsStatus = loadingPaths ? "Loading street paths…" : sawLoadingPaths ? "Street paths updated" : "";
  // Low-data opt-in (Task 15 follow-up): the walk graph downloads only on this tap, then stays stored.
  const pathsDownload = useWalkGraphDownload(data.revision.revisionId);
  const downloadPaths = async () => {
    if (pathsDownload.busy) return;
    // The button goes away once the paths arrive: keep focus in the sheet, on the heading.
    if (await pathsDownload.download()) headingRef.current?.focus();
  };

  return (
    <section className="pn-trip pn-trip-detail" aria-labelledby="pn-trip-detail-title" data-testid="trip-detail">
      <div className="pn-trip-detail__bar">
        <button type="button" className="pn-trip-back" aria-label="Back to trip options" onClick={onBack}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 2L2 10l8 8" />
          </svg>
        </button>
      </div>
      <h2 id="pn-trip-detail-title" ref={headingRef} tabIndex={-1} className="pn-trip-detail__title">
        To your destination
      </h2>
      <p className="pn-trip-detail__labels">{option.labels.join(" · ")}</p>
      <div className="pn-trip-detail__meta">
        <EtaTotalText estimate={estimate} className={estimate ? "pn-trip-detail__time" : undefined} testId="trip-detail-time" />
        <FareChip fare={option.fare} />
      </div>
      {estimate?.total.peak ? (
        <p className="pn-trip-detail__peak">
          <EtaPeakNote estimate={estimate} testId="trip-peak-note" />
        </p>
      ) : null}
      {estimate ? (
        <button
          type="button"
          className="pn-trip-detail__basis-btn"
          onClick={() => setBasisOpen(true)}
          data-testid="how-times-estimated-btn"
        >
          How times are estimated
        </button>
      ) : null}
      {rides.length > 0 ? <UnverifiedBadge /> : null}
      {note ? (
        <p className={note.tone === "warning" ? "pn-trip-reopen pn-trip-reopen--warn" : "pn-trip-reopen"} data-testid="trip-reopen-note">
          {note.text}
        </p>
      ) : null}
      {onStart ? (
        <button type="button" className="pn-btn pn-btn--primary pn-trip-start" onClick={() => onStart(walkLengths)} data-testid="trip-start">
          {START_TRIP}
        </button>
      ) : null}
      {ends ? <TripActions data={data} option={option} ends={ends} etaModel={etaModel} walkLengths={walkLengths} /> : null}

      <p className="sr-only" role="status" aria-live="polite" data-testid="trip-paths-status">
        {pathsStatus}
      </p>
      {pathsDownload.offer || pathsDownload.failed ? (
        <div className="pn-trip-paths-offer" data-testid="walk-graph-offer">
          <p className="pn-trip-paths-offer__text">Low-data mode: walks are shown as straight lines. Street paths download only if you ask.</p>
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-trip-paths-offer__btn"
            aria-disabled={pathsDownload.busy || undefined}
            onClick={() => void downloadPaths()}
            data-testid="walk-graph-download"
          >
            {pathsDownload.busy ? "Downloading street paths…" : WALK_GRAPH_DOWNLOAD_LABEL}
          </button>
          {pathsDownload.failed ? <p className="pn-trip-paths-offer__text" role="alert">Street paths could not be downloaded. Try again.</p> : null}
        </div>
      ) : null}
      <ol className="pn-tl" aria-label="Trip steps">
        {steps(option, lookups, traceOf, estimate).map((step) => (
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
        {rides.length === 0 ? (
          <p className="pn-fares__row">
            <span>Walking only</span>
            <span>{fareChipText(option.fare)}</span>
          </p>
        ) : (
          <>
            {rides.map((leg, i) => (
              <p key={i} className="pn-fares__row" data-testid="leg-fare">
                <span>{routeChipLabel(leg.routeCode, leg.routeName)}</span>
                <span>{legFareText(leg.fare)}</span>
              </p>
            ))}
            {rides.length > 1 ? (
              <p className="pn-fares__row pn-fares__row--total">
                <span>Total</span>
                <span>{fareChipText(option.fare)}</span>
              </p>
            ) : null}
            <p className="pn-fares__note">Vehicle class unknown, so each range spans the traditional and modern jeepney minimums. Discounts not applied.</p>
          </>
        )}
      </section>
      <p className="pn-trip-detail__soon">Corrections open soon.</p>
      <EtaBasisSheet
        open={basisOpen}
        onClose={() => setBasisOpen(false)}
        model={etaModel}
      />
    </section>
  );
}
