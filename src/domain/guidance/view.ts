// What the Walk / Ride / Transfer / Arrive screens show for a session and the latest fix. Pure.
//
// Honest by construction (global constraints, copy rules §6.5): distances are straight-line
// estimates ("≈"), stops are counted by provisional pin order, a time is only ever
// a range labelled "(estimate)" from the snapshot's model (never a clock time or
// "arriving"), nothing says "live", and there is no curb, crossing, boarding side, signboard
// text or entrance, because none of them exists in the data; the artboards' versions of those lines
// are replaced by a plain "not mapped / not on file" note with a next step. "Para! Next stop is
// yours" is a suggestion shown only on a ride the person confirmed boarding, by the single rule
// `paraSuggested` (progress.ts): a precise (<= 30 m) fix put them, in pin order, at the stop before
// the alighting pin or within 300 m of it; it is the only assertive announcement. There is no manual
// stop advance: "I got off" shows only then, otherwise "I got off early" (a re-plan, like a missed
// stop). With a GPS count, 3 and 2 stops before the alighting stop show a "get ready" line and alert
// once each. "I've arrived" (the last walk, or a tricycle / padyak that is the last step) shows only
// once the session saw a usable fix within ARRIVE_NEAR_M of the destination (`nearDestination`);
// until then a note says so. The ride screen reads the session only: every usable fix must be
// dispatched to the session as a `fix` event (so progress survives a reload); the `fix` argument
// here feeds the walk screens. GPS proposes ("Close to …"), the person
// confirms with the buttons, whose events the session reducer applies.
// Increment E: a pinless ride (free board/alight points) whose Lines path is on the phone shows
// "About {m} m of riding left (approximate)" from the fix projected on the path (stateless, so it
// reads the `fix` argument), "Get ready…" within 300 m, and an off-path note instead of progress more
// than 100 m away. A tricycle or padyak trip is one `street_ride` screen: the step, the planner's
// notes, "… time not estimated", and "I've arrived" (needs location when it is the last step).
import { en, type Dict } from "@/i18n/dict";
import { STALE_MS, type LocationFix } from "../geo/location-fix";
import { decodePolyline } from "../geo/polyline";
import { directionText, fareChipText, formatDistance, freeAlightText } from "../trip/present";
import { estimateOption, type EtaLeg, type EtaOptionInput } from "../eta/eta";
import { formatLeg, formatRemaining } from "../eta/format";
import { ARRIVE_NEAR_M, paraSuggested, pathRideProgress, usableFix, walkProgress, type PathRideProgress, type WalkProgress } from "./progress";
import { reduceSession, sessionSteps, type GuidanceEvent, type GuidanceSession, type RideState } from "./session";
import {
  type GuidanceStep,
  type GuidanceTrip,
  type RideRef,
  type RideStep,
  type StopRef,
  type StreetRideStep,
  type TransferStep,
  type WalkToBoardStep,
  type WalkToDestinationStep,
} from "./steps";

/** The English guidance copy (tests compare against it); screens pass the reader's `t.guidance`. */
export const GUIDANCE_COPY = en.guidance;
export type GuidanceCopy = Dict["guidance"];
/** The shared dictionary areas guidance text is built from (trip, time and distance wording); English by default. */
export type SharedCopy = Pick<Dict, "trip" | "eta" | "geo">;

export type GuidanceAction = { event: Exclude<GuidanceEvent["type"], "fix">; label: string; kind: "primary" | "secondary" };
export type LiveMessage = { politeness: "polite" | "assertive"; text: string };

/** A moment to get the rider's attention (vibration, notification); `key` is unique per step and kind. */
export type Attention = { key: string; title: string; body: string };

export type WalkView = {
  screen: "walk";
  stepKind: "walk_to_board" | "transfer" | "walk_to_destination";
  stepLabel: string;
  title: string;
  subtitle: string | null;
  distanceText: string | null;
  directionText: string | null;
  remainingTime: string | null;
  /** Why distance and direction are hidden (an imprecise or stale fix); null with no fix. */
  locationNote: string | null;
  notes: string[];
  /** Transfer only. */
  checklist: { text: string; done: boolean }[] | null;
  nextRide: { chip: string; routeName: string; direction: string | null; badge: string } | null;
  keepOpen: string;
  actions: GuidanceAction[];
  /** Undo the last confirmation (a mis-tap); null when there is nothing to undo. */
  undo: GuidanceAction | null;
  /** The GPS proposal ("Close to …"), also the live text while it shows; else null. */
  proposal: string | null;
  live: LiveMessage;
  attention: Attention | null;
  usesLocation: true;
};

export type RideView = {
  screen: "ride";
  stepLabel: string;
  title: string;
  subtitle: string;
  badge: string;
  /** "Get off · Y" under the rail; null when the title already says "Ride to Y". */
  alightText: string | null;
  countText: string;
  countNote: string;
  remainingTime: string | null;
  stops: { label: string; state: "boarded" | "passed" | "ahead" | "alight" }[];
  para: { title: string; body: string; acknowledged: boolean } | null;
  /** "3 stops to Y. Get ready." at 3 and 2 stops left (GPS count, pinned ride); else null. */
  headsUp: string | null;
  /** Show the Report-a-driver entry (MyNaga, decision D9). */
  reportDriver: true;
  keepOpen: string;
  actions: GuidanceAction[];
  /** Undo the last confirmation (a mis-tap); null when there is nothing to undo. */
  undo: GuidanceAction | null;
  live: LiveMessage;
  attention: Attention | null;
  usesLocation: true;
};

export type ArriveView = {
  screen: "arrive";
  stepLabel: string;
  title: string;
  body: string;
  summary: { walkText: string; rides: { chip: string; stopsText: string }[]; fareText: string };
  actions: GuidanceAction[];
  undo: GuidanceAction | null;
  live: LiveMessage;
  usesLocation: false;
};

export type MissedView = {
  screen: "missed";
  title: string;
  body: string;
  replan: true;
  usesLocation: false;
  actions: GuidanceAction[];
  undo: GuidanceAction | null;
  live: LiveMessage;
};
export type EndedView = { screen: "ended"; usesLocation: false };

/** A tricycle or padyak ride to the destination. */
export type StreetRideView = {
  screen: "street_ride";
  mode: "tricycle" | "padyak";
  stepLabel: string;
  title: string;
  /** The step: "Take a tricycle to … · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver". */
  instruction: string;
  /** The planner's notes (rules applied, fare, franchise zone / area, "… time not estimated"). */
  notes: string[];
  /** "Tricycle time not estimated" / "Padyak time not estimated": never minutes. */
  remainingTime: string;
  keepOpen: string;
  actions: GuidanceAction[];
  undo: GuidanceAction | null;
  live: LiveMessage;
  /** The last step: "I've arrived" waits for a fix near the destination. */
  usesLocation: boolean;
};

export type GuidanceView = WalkView | RideView | ArriveView | MissedView | EndedView | StreetRideView;

const endAction = (copy: GuidanceCopy): GuidanceAction => ({ event: "end", label: copy.endGuidance, kind: "secondary" });

function undoAction(session: GuidanceSession, copy: GuidanceCopy): GuidanceAction | null {
  return reduceSession(session, { type: "back" }) === session ? null : { event: "back", label: copy.undo, kind: "secondary" };
}

function stepLabel(index: number, total: number, kind: GuidanceStep["kind"], copy: GuidanceCopy): string {
  const name = kind === "ride" ? copy.stepRide : kind === "transfer" ? copy.stepTransfer : copy.stepWalk;
  return copy.stepLabel(index + 1, total, name);
}

function locationNote(fix: LocationFix | null, now: number, copy: GuidanceCopy): string | null {
  if (!fix || usableFix(fix, now)) return null;
  if (![fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite) || fix.accuracy < 0) return copy.locationImprecise;
  if (now - fix.timestamp > STALE_MS) return copy.locationStale;
  return copy.locationApproximate(Math.round(fix.accuracy));
}

// Spoken live text: no "≈" (read as "almost equal to"), and the straight-line basis stays in it.
const spokenDistance = (progress: WalkProgress, place: string, copy: GuidanceCopy) =>
  progress.distanceMeters < 10 ? copy.liveUnder10(place) : copy.liveAbout(progress.distanceMeters, place);

function distanceLine(progress: WalkProgress | null, estimateMeters: number, negligible: boolean, copy: GuidanceCopy, shared: SharedCopy): string | null {
  if (progress) {
    return copy.straightLine(progress.distanceMeters < 10 ? copy.gpsUnder10 : copy.gpsMeters(progress.distanceMeters));
  }
  return negligible ? null : formatDistance(estimateMeters, shared.geo);
}

// ---- time left (Task 14): the snapshot's model through the eta domain, never a hand-set speed.
// The estimate covers the rest of the trip from now (the current leg's remainder + the later legs),
// so the peak test spans [now, now + the remaining trip]; the current leg's range is shown.
// Walks: a GPS remainder is a straight line, so it is ×1.3 like the plan's estimates; without GPS
// the plan's walk (its graph path length when one was on file, else its ×1.3 estimate).

/** Shown after a ride's time left when no path measures exist and the ride is split by stop count. */
export const BY_STOP_COUNT = en.guidance.byStopCount;

type CurrentLeg = EtaOptionInput["legs"][number];

/** The current leg's estimated range, with the rest of the trip after it (peak test over both). */
function currentLegEstimate(trip: GuidanceTrip, legIndex: number, current: CurrentLeg, currentWalkLength: number | null, now: number): EtaLeg | null {
  const later = trip.option.legs.slice(legIndex + 1);
  const lengths = [currentWalkLength, ...later.map((_, i) => trip.walkLengths?.[legIndex + 1 + i] ?? null)];
  const res = estimateOption({ legs: [current, ...later] }, lengths, trip.etaModel, new Date(now));
  return res.ok ? res.estimate.legs[0]! : null;
}

function walkRemainingTime(trip: GuidanceTrip, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, progress: WalkProgress | null, now: number, shared: SharedCopy): string | null {
  if (step.negligible || step.legIndex === null) return null;
  if (progress && progress.distanceMeters < 15) return null;
  if (!trip.etaModel || !(now > 0)) return shared.eta.timeNotAvailable;
  const current: CurrentLeg = { kind: "walk", estimateMeters: progress ? Math.round(progress.distanceMeters * 1.3) : step.estimateMeters };
  const length = progress ? null : (trip.walkLengths?.[step.legIndex] ?? null);
  const leg = currentLegEstimate(trip, step.legIndex, current, length, now);
  if (!leg || leg.lowMin === null || leg.highMin === null) return shared.eta.timeNotAvailable;
  return formatRemaining({ lowMin: leg.lowMin, highMin: leg.highMin }, "trip", shared.eta);
}

/** The ride still ahead: measure(alight) − measure(last passed stop), else split by stop count. */
function rideMetersLeft(step: RideStep, passedIndex: number): { meters: number; byStopCount: boolean } {
  const alightIndex = step.stops.length - 1;
  const m = step.stopMeasuresM;
  if (m) return { meters: Math.max(0, m[alightIndex]! - m[passedIndex]!), byStopCount: false };
  if (passedIndex === 0 || step.stopsToRide === 0) return { meters: step.distanceMeters, byStopCount: false };
  return { meters: (step.distanceMeters * (alightIndex - passedIndex)) / step.stopsToRide, byStopCount: true };
}

function rideRemainingTime(trip: GuidanceTrip, step: RideStep, ride: RideState, now: number, copy: GuidanceCopy, shared: SharedCopy): string | null {
  const alightIndex = step.stops.length - 1;
  if (alightIndex - ride.passedIndex <= 0) return null;
  if (!trip.etaModel || !(now > 0)) return shared.eta.timeNotAvailable;
  const { meters, byStopCount } = rideMetersLeft(step, ride.passedIndex);
  const current: CurrentLeg = { kind: "ride", mode: step.mode, distanceMeters: meters, distanceBasis: step.distanceBasis };
  const leg = currentLegEstimate(trip, step.legIndex, current, null, now);
  if (!leg) return shared.eta.timeNotAvailable;
  if (leg.lowMin === null || leg.highMin === null) return formatLeg(leg, shared.eta);
  const text = formatRemaining({ lowMin: leg.lowMin, highMin: leg.highMin }, "riding", shared.eta);
  return byStopCount ? `${text} · ${copy.byStopCount}` : text;
}

function nextRideInfo(ride: RideRef, shared: SharedCopy) {
  return { chip: ride.routeChip, routeName: ride.routeName, direction: directionText(ride.loopDirection, "short", ride.routeChip, shared.trip), badge: shared.trip.unverifiedBadge };
}

function walkView(session: GuidanceSession, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, total: number, fix: LocationFix | null, now: number, copy: GuidanceCopy, shared: SharedCopy): WalkView {
  const toDestination = step.kind === "walk_to_destination";
  // A pinned destination is saved as "Near <stop>" (pinnedEndName); inside a sentence it reads "your pin near <stop>".
  const targetName = toDestination ? step.target.name.replace(/^Near ([^]*)$/, (_, stop: string) => copy.pinNear(stop)) : step.target.label;
  const progress = walkProgress(step.target, fix, now);
  const distanceText = distanceLine(progress, step.estimateMeters, step.negligible, copy, shared);
  const remainingTime = walkRemainingTime(session.trip, step, progress, now, shared);
  const directionTextValue = progress?.bearing ? shared.geo.compass[progress.bearing] : null;

  let title: string;
  let subtitle: string | null = null;
  let notes: string[];
  let checklist: WalkView["checklist"] = null;
  let nextRide: WalkView["nextRide"] = null;
  let actions: GuidanceAction[];
  let proposal: string | null = null;
  const END = endAction(copy);

  if (toDestination) {
    title = step.negligible
      ? step.from
        ? copy.destinationAt(step.from.label)
        : copy.youreAt(targetName)
      : copy.walkTo(targetName);
    const near = session.nearDestination;
    notes = near ? [copy.entranceUnknown] : [copy.entranceUnknown, copy.arriveNear(targetName, ARRIVE_NEAR_M)];
    actions = near ? [{ event: "arrived", label: copy.arrived, kind: "primary" }, END] : [END];
    if (near && progress?.nearTarget) proposal = copy.closeTo(targetName, copy.arrived);
  } else {
    const chip = step.nextRide.routeChip;
    const at = session.atStop;
    if (at) title = copy.waitFor(chip, step.target.label);
    else if (step.kind === "transfer") {
      title = !step.negligible
        ? copy.walkTo(step.target.label)
        : step.from.stopId === step.target.stopId
          ? copy.changeAt(step.from.label)
          : copy.changeTo(chip, step.target.label);
    }
    else title = step.negligible ? copy.startAt(step.target.label) : copy.walkTo(step.target.label);
    if (step.kind === "transfer") {
      subtitle = `${step.from.label} → ${step.target.label}`;
      checklist = [
        { text: copy.gotOffAt(step.from.label), done: true },
        { text: copy.walkTo(step.target.label), done: at || step.negligible },
        { text: copy.waitFor(chip, step.target.label), done: false },
      ];
    }
    notes = at ? [copy.boardingSideUnknown(), copy.signboardUnknown(chip)] : [copy.boardingSideUnknown()];
    // AC-7: a fix too rough to measure a distance falls back to a landmark check (the stop's name) before boarding.
    if (!at && locationNote(fix, now, copy) !== null) notes.unshift(copy.checkBeside(step.target.label));
    nextRide = nextRideInfo(step.nextRide, shared);
    const board: GuidanceAction = { event: "boarded", label: copy.boarded(chip), kind: at ? "primary" : "secondary" };
    actions = at ? [board, END] : [{ event: "atStop", label: copy.atStop, kind: "primary" }, board, END];
    if (!at && progress?.nearTarget) proposal = copy.closeTo(step.target.label, copy.atStop);
  }

  return {
    screen: "walk",
    stepKind: step.kind,
    stepLabel: stepLabel(step.index, total, step.kind, copy),
    title,
    subtitle,
    distanceText,
    directionText: directionTextValue,
    remainingTime,
    locationNote: locationNote(fix, now, copy),
    notes,
    checklist,
    nextRide,
    keepOpen: copy.keepOpen,
    actions,
    undo: undoAction(session, copy),
    proposal,
    live: { politeness: "polite", text: proposal ?? (progress ? spokenDistance(progress, targetName, copy) : title) },
    attention: toDestination && progress?.nearTarget && proposal ? { key: `walk:${step.index}:near`, title: copy.almostAt(targetName), body: proposal } : null,
    usesLocation: true,
  };
}

/** Progress along the Lines path for a pinless ride whose path is on the phone; null otherwise. */
function pathProgress(trip: GuidanceTrip, step: RideStep, fix: LocationFix | null, now: number): PathRideProgress | null {
  const path = step.pinned ? undefined : trip.ridePaths?.[step.ride.variantId];
  const m = step.stopMeasuresM;
  if (!path || !m) return null;
  return pathRideProgress(decodePolyline(path.encoded), path.isCircuit, m[0]!, m[m.length - 1]!, fix, now);
}

function rideView(session: GuidanceSession, ride: RideState, step: RideStep, total: number, fix: LocationFix | null, now: number, copy: GuidanceCopy, shared: SharedCopy): RideView {
  const alightIndex = step.stops.length - 1;
  // A GPS-backed count only while GPS still supports it (countLost: the jeepney is past the window).
  const gps = ride.gpsSeen && !ride.countLost;
  const suggested = paraSuggested(ride);
  const stopsRemaining = Math.max(0, alightIndex - ride.passedIndex);
  const alight = step.alight.label;
  const chip = step.ride.routeChip;
  const remainingTime = rideRemainingTime(session.trip, step, ride, now, copy, shared);
  const onPath = pathProgress(session.trip, step, fix, now);

  let title: string;
  if (ride.paraAcknowledged) title = copy.paraAckTitle;
  else if (suggested) title = copy.stopIsNext;
  else if (gps && step.pinned) title = copy.toGo(copy.stopsCount(stopsRemaining));
  else if (onPath && !onPath.offPath && onPath.getReady) title = copy.getReady(alight);
  else title = copy.rideTo(alight);

  const para = ride.paraAcknowledged
    ? { title: copy.paraAckTitle, body: copy.paraAckBody(alight), acknowledged: true }
    : suggested
      ? { title: copy.paraTitle, body: copy.paraBody(alight), acknowledged: false }
      : null;

  const END = endAction(copy);
  const gotOff = (kind: GuidanceAction["kind"]): GuidanceAction => ({ event: "gotOff", label: copy.gotOff, kind });
  const missed: GuidanceAction = { event: "missedStop", label: copy.missedStop, kind: "secondary" };
  const actions: GuidanceAction[] = ride.paraAcknowledged
    ? [gotOff("primary"), missed, END]
    : suggested
      ? [{ event: "paraAcknowledged", label: copy.paraAck, kind: "primary" }, gotOff("secondary"), missed, END]
      : [{ event: "gotOffEarly", label: copy.gotOffEarly, kind: "secondary" }, missed, END];
  const headsUp = gps && step.pinned && !suggested && (stopsRemaining === 3 || stopsRemaining === 2) ? copy.headsUp(stopsRemaining, alight) : null;

  return {
    screen: "ride",
    stepLabel: stepLabel(step.index, total, "ride", copy),
    title,
    subtitle: chip,
    badge: shared.trip.unverifiedBadge,
    alightText: step.pinned ? (title === copy.rideTo(alight) ? null : copy.getOff(alight)) : freeAlightText(alight, shared.trip),
    countText: !step.pinned
      ? onPath?.offPath
        ? copy.offPath
        : onPath
          ? copy.metresLeft(Math.round(onPath.remainingM / 10) * 10)
          : copy.alongPathTo(alight)
      : gps
      ? copy.passedOf(ride.passedIndex, copy.stopsCount(step.stopsToRide))
      : copy.countAfter(copy.stopsCount(step.stopsToRide), step.board.label),
    countNote: step.pinned ? copy.stopsByPinOrder : copy.noMarkedStops,
    remainingTime,
    stops: step.stops.map((s: StopRef, i) => ({
      label: s.label,
      state: i === 0 ? "boarded" : i === alightIndex ? "alight" : gps && i <= ride.passedIndex ? "passed" : "ahead",
    })),
    para,
    headsUp,
    reportDriver: true,
    keepOpen: copy.keepOpen,
    actions,
    undo: undoAction(session, copy),
    live: para && !para.acknowledged ? { politeness: "assertive", text: copy.paraTitle } : { politeness: "polite", text: headsUp ?? title },
    attention:
      para && !para.acknowledged
        ? { key: `ride:${step.index}:para`, title: para.title, body: para.body }
        : headsUp
          ? { key: `ride:${step.index}:ready:${stopsRemaining}`, title: headsUp, body: copy.paraBody(alight) }
          : !para && onPath && !onPath.offPath && onPath.getReady
          ? { key: `ride:${step.index}:ready`, title: copy.getReady(alight), body: copy.paraBody(alight) }
          : null,
    usesLocation: true,
  };
}

function arriveView(session: GuidanceSession, steps: GuidanceStep[], copy: GuidanceCopy, shared: SharedCopy): ArriveView {
  const option = session.trip.option;
  const last = steps.at(-1);
  const named = (last?.kind === "walk_to_destination" || last?.kind === "street_ride") && last.target.name !== copy.unnamedDestination ? last.target.name : null;
  const title = copy.arrivedTitle;
  return {
    screen: "arrive",
    stepLabel: copy.arriveStepLabel(steps.length, steps.length),
    title,
    body: copy.arrivedBody(named),
    summary: {
      walkText: copy.walkSummary(formatDistance(option.walkEstimateMeters, shared.geo)),
      rides: steps.flatMap((s) =>
        s.kind === "ride" ? [{ chip: s.ride.routeChip, stopsText: s.pinned ? copy.stopsCount(s.stopsToRide) : copy.alongThePath }]
        : s.kind === "street_ride" ? [{ chip: copy[s.mode], stopsText: copy.alongStreets }]
        : []),
      fareText: fareChipText(option.fare, shared.trip),
    },
    actions: [{ event: "end", label: copy.done, kind: "primary" }],
    undo: undoAction(session, copy),
    live: { politeness: "polite", text: title },
    usesLocation: false,
  };
}

/** `copy`: the reader's `t.guidance`; `shared`: their `t` for the trip, time and distance wording (English by default). */
export function guidanceView(session: GuidanceSession, fix: LocationFix | null, now: number, copy: GuidanceCopy = en.guidance, shared: SharedCopy = en): GuidanceView {
  if (session.status === "ended") return { screen: "ended", usesLocation: false };
  if (session.status === "missed_stop" || session.status === "got_off_early") {
    // Got off early reuses the missed-stop screen: re-plan from here, or Undo.
    const early = session.status === "got_off_early";
    const title = early ? copy.earlyTitle : copy.missedTitle;
    return {
      screen: "missed",
      title,
      body: early ? copy.earlyBody : copy.missedBody,
      replan: true,
      usesLocation: false,
      actions: [{ event: "end", label: copy.endGuidance, kind: "primary" }],
      undo: undoAction(session, copy),
      live: { politeness: "polite", text: title },
    };
  }
  const steps = sessionSteps(session, copy, shared);
  if (session.status === "arrived") return arriveView(session, steps, copy, shared);
  const step = steps[session.stepIndex];
  if (!step) return { screen: "ended", usesLocation: false }; // a malformed option with no steps
  if (step.kind === "ride") return rideView(session, session.ride!, step, steps.length, fix, now, copy, shared);
  if (step.kind === "street_ride") return streetView(session, step, steps.length, copy);
  return walkView(session, step, steps.length, fix, now, copy, shared);
}

function streetView(session: GuidanceSession, step: StreetRideStep, total: number, copy: GuidanceCopy): StreetRideView {
  const title = copy.streetTitle(step.mode, step.target.name);
  const modeTitle = copy[step.mode];
  const END = endAction(copy);
  const last = step.index === total - 1;
  return {
    screen: "street_ride",
    mode: step.mode,
    stepLabel: copy.stepLabel(step.index + 1, total, modeTitle),
    title,
    // The title already says "Take a … to …": the instruction is the rest (distance, route state, fare).
    instruction: step.text.startsWith(`${title} · `) ? step.text.slice(title.length + 3) : step.text,
    notes: last && !session.nearDestination ? [...step.notes, copy.arriveNear(step.target.name, ARRIVE_NEAR_M)] : step.notes,
    remainingTime: copy.streetTime(modeTitle),
    keepOpen: copy.keepOpen,
    // Not the last step (the access option): the tricycle only takes the rider to the jeep, so the trip goes on.
    actions: !last ? [{ event: "arrived", label: copy.gotOffTricycle, kind: "primary" }, END] : session.nearDestination ? [{ event: "arrived", label: copy.arrived, kind: "primary" }, END] : [END],
    undo: undoAction(session, copy),
    live: { politeness: "polite", text: title },
    usesLocation: last,
  };
}
