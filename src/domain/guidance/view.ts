// What the Walk / Ride / Transfer / Arrive screens show for a session and the latest fix. Pure.
//
// Honest by construction (global constraints, copy rules §6.5): distances are straight-line
// estimates ("≈"), stops are counted by provisional pin order, a time is only ever
// a range labelled "(estimate)" from the snapshot's model (never a clock time or
// "arriving"), nothing says "live", and there is no curb, crossing, boarding side, signboard
// text or entrance, because none of them exists in the data; the artboards' versions of those lines
// are replaced by a plain "not mapped / not on file" note with a next step. "Para! Next stop is
// yours" is a suggestion shown only on a ride the person confirmed boarding, by the single rule
// `paraSuggested` (progress.ts): they said their stop is next, or a precise (<= 30 m) fix put them,
// in pin order, at the stop before the alighting pin or within 300 m of it; it is the only
// assertive announcement. The ride screen reads the session only: every usable fix must be
// dispatched to the session as a `fix` event (so progress survives a reload); the `fix` argument
// here feeds the walk screens. GPS proposes ("Close to …"), the person
// confirms with the buttons, whose events the session reducer applies.
// Increment E: a pinless ride (free board/alight points) whose Lines path is on the phone shows
// "About {m} m of riding left (approximate)" from the fix projected on the path (stateless, so it
// reads the `fix` argument), "Get ready…" within 300 m, and an off-path note instead of progress more
// than 100 m away. A tricycle or padyak trip is one `street_ride` screen: the step, the planner's
// notes, "… time not estimated", and "I've arrived"; it never uses the location.
import { STALE_MS, type LocationFix } from "../geo/location-fix";
import { COMPASS_WORDS } from "../geo/bearing";
import { decodePolyline } from "../geo/polyline";
import { UNVERIFIED_ROUTE_BADGE } from "../planner/labels";
import { directionText, fareChipText, formatDistance, freeAlightText } from "../trip/present";
import { estimateOption, type EtaLeg, type EtaOptionInput } from "../eta/eta";
import { TIME_NOT_AVAILABLE, formatLeg, formatRemaining } from "../eta/format";
import { paraSuggested, pathRideProgress, usableFix, walkProgress, type PathRideProgress, type WalkProgress } from "./progress";
import { reduceSession, sessionSteps, type GuidanceEvent, type GuidanceSession, type RideState } from "./session";
import {
  UNNAMED_DESTINATION,
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

export const GUIDANCE_COPY = {
  keepOpen: "Keep this screen open.",
  endGuidance: "End guidance",
  atStop: "I'm at the stop",
  boarded: (chip: string) => `I boarded ${chip}`,
  arrived: "I've arrived",
  nextStopIsMine: "My stop is next",
  paraAck: "I said “Para”",
  gotOff: "I got off",
  missedStop: "I missed my stop",
  done: "Done",
  boardingSideUnknown: () => "Ask where it stops.",
  signboardUnknown: (chip: string) => `Signboard unverified. Ask the driver: “${chip}?”`,
  entranceUnknown: "Entrance not mapped.",
  locationApproximate: (accuracy: number) => `Location too rough (± ${Math.round(accuracy)} m): distance hidden.`,
  locationStale: "Location is stale: distance hidden.",
  locationImprecise: "Location too rough: distance hidden.",
  noMarkedStops: "This route has no marked stops. Watch for your stop, and tell the driver “para” when you are near.",
  offPath: "Your location is away from the approximate path. The jeepney may use another street; watch for your stop.",
  metresLeft: (m: number) => `About ${Math.round(m / 10) * 10} m of riding left (approximate)`,
  getReady: (place: string) => `Get ready to get off near ${place}`,
  stopsByPinOrder: "Approximate; watch for your stop.",
  paraTitle: "Para! Next stop is yours",
  paraBody: (stop: string) => `Get off at ${stop}. Say “Para” to the driver when you see it.`,
  paraAckTitle: "Getting off at the next stop",
  paraAckBody: (stop: string) => `Step off when the jeepney stops at ${stop}, then tap “I got off”.`,
  stopIsNext: "Your stop is next",
  arrivedTitle: "You've arrived",
  arrivedBody: (destination: string | null) => `${destination ? `${destination}.` : "You're at your destination."} Location use stopped.`,
  undo: "Undo",
  missedTitle: "Missed your stop?",
  missedBody: "Get off when the jeepney next stops, then plan again from where you are.",
} as const;

export type GuidanceAction = { event: Exclude<GuidanceEvent["type"], "fix">; label: string; kind: "primary" | "secondary" };
export type LiveMessage = { politeness: "polite" | "assertive"; text: string };

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
  live: LiveMessage;
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
  /** Show the Report-a-driver entry (MyNaga, decision D9). */
  reportDriver: true;
  keepOpen: string;
  actions: GuidanceAction[];
  /** Undo the last confirmation (a mis-tap); null when there is nothing to undo. */
  undo: GuidanceAction | null;
  live: LiveMessage;
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
  usesLocation: false;
};

export type GuidanceView = WalkView | RideView | ArriveView | MissedView | EndedView | StreetRideView;

const END: GuidanceAction = { event: "end", label: GUIDANCE_COPY.endGuidance, kind: "secondary" };
const stopsCount = (n: number) => (n === 1 ? "1 stop" : `${n} stops`);

function undoAction(session: GuidanceSession): GuidanceAction | null {
  return reduceSession(session, { type: "back" }) === session ? null : { event: "back", label: GUIDANCE_COPY.undo, kind: "secondary" };
}

function stepLabel(index: number, total: number, kind: GuidanceStep["kind"]): string {
  const name = kind === "ride" ? "Ride" : kind === "transfer" ? "Transfer" : "Walk";
  return `Step ${index + 1} of ${total} · ${name}`;
}

function locationNote(fix: LocationFix | null, now: number): string | null {
  if (!fix || usableFix(fix, now)) return null;
  if (![fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite) || fix.accuracy < 0) return GUIDANCE_COPY.locationImprecise;
  if (now - fix.timestamp > STALE_MS) return GUIDANCE_COPY.locationStale;
  return GUIDANCE_COPY.locationApproximate(fix.accuracy);
}

const gpsMeters = (progress: WalkProgress) => (progress.distanceMeters < 10 ? "Under 10 m" : `≈ ${progress.distanceMeters} m`);

// Spoken live text: no "≈" (read as "almost equal to"), and the straight-line basis stays in it.
const spokenMeters = (progress: WalkProgress) => (progress.distanceMeters < 10 ? "Under 10 m" : `About ${progress.distanceMeters} m`);

function distanceLine(progress: WalkProgress | null, estimateMeters: number, negligible: boolean): string | null {
  if (progress) {
    return `${gpsMeters(progress)} · straight-line`;
  }
  return negligible ? null : formatDistance(estimateMeters);
}

// ---- time left (Task 14): the snapshot's model through the eta domain, never a hand-set speed.
// The estimate covers the rest of the trip from now (the current leg's remainder + the later legs),
// so the peak test spans [now, now + the remaining trip]; the current leg's range is shown.
// Walks: a GPS remainder is a straight line, so it is ×1.3 like the plan's estimates; without GPS
// the plan's walk (its graph path length when one was on file, else its ×1.3 estimate).

/** Shown after a ride's time left when no path measures exist and the ride is split by stop count. */
export const BY_STOP_COUNT = "split by stop count";

type CurrentLeg = EtaOptionInput["legs"][number];

/** The current leg's estimated range, with the rest of the trip after it (peak test over both). */
function currentLegEstimate(trip: GuidanceTrip, legIndex: number, current: CurrentLeg, currentWalkLength: number | null, now: number): EtaLeg | null {
  const later = trip.option.legs.slice(legIndex + 1);
  const lengths = [currentWalkLength, ...later.map((_, i) => trip.walkLengths?.[legIndex + 1 + i] ?? null)];
  const res = estimateOption({ legs: [current, ...later] }, lengths, trip.etaModel, new Date(now));
  return res.ok ? res.estimate.legs[0]! : null;
}

function walkRemainingTime(trip: GuidanceTrip, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, progress: WalkProgress | null, now: number): string | null {
  if (step.negligible || step.legIndex === null) return null;
  if (progress && progress.distanceMeters < 15) return null;
  if (!trip.etaModel || !(now > 0)) return TIME_NOT_AVAILABLE;
  const current: CurrentLeg = { kind: "walk", estimateMeters: progress ? Math.round(progress.distanceMeters * 1.3) : step.estimateMeters };
  const length = progress ? null : (trip.walkLengths?.[step.legIndex] ?? null);
  const leg = currentLegEstimate(trip, step.legIndex, current, length, now);
  if (!leg || leg.lowMin === null || leg.highMin === null) return TIME_NOT_AVAILABLE;
  return formatRemaining({ lowMin: leg.lowMin, highMin: leg.highMin }, "trip");
}

/** The ride still ahead: measure(alight) − measure(last passed stop), else split by stop count. */
function rideMetersLeft(step: RideStep, passedIndex: number): { meters: number; byStopCount: boolean } {
  const alightIndex = step.stops.length - 1;
  const m = step.stopMeasuresM;
  if (m) return { meters: Math.max(0, m[alightIndex]! - m[passedIndex]!), byStopCount: false };
  if (passedIndex === 0 || step.stopsToRide === 0) return { meters: step.distanceMeters, byStopCount: false };
  return { meters: (step.distanceMeters * (alightIndex - passedIndex)) / step.stopsToRide, byStopCount: true };
}

function rideRemainingTime(trip: GuidanceTrip, step: RideStep, ride: RideState, now: number): string | null {
  const alightIndex = step.stops.length - 1;
  if (alightIndex - ride.passedIndex <= 0) return null;
  if (!trip.etaModel || !(now > 0)) return TIME_NOT_AVAILABLE;
  const { meters, byStopCount } = rideMetersLeft(step, ride.passedIndex);
  const current: CurrentLeg = { kind: "ride", mode: step.mode, distanceMeters: meters, distanceBasis: step.distanceBasis };
  const leg = currentLegEstimate(trip, step.legIndex, current, null, now);
  if (!leg) return TIME_NOT_AVAILABLE;
  if (leg.lowMin === null || leg.highMin === null) return formatLeg(leg);
  const text = formatRemaining({ lowMin: leg.lowMin, highMin: leg.highMin }, "riding");
  return byStopCount ? `${text} · ${BY_STOP_COUNT}` : text;
}

function nextRideInfo(ride: RideRef) {
  return { chip: ride.routeChip, routeName: ride.routeName, direction: directionText(ride.loopDirection, "short"), badge: UNVERIFIED_ROUTE_BADGE };
}

function walkView(session: GuidanceSession, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, total: number, fix: LocationFix | null, now: number): WalkView {
  const toDestination = step.kind === "walk_to_destination";
  const targetName = toDestination ? step.target.name : step.target.label;
  const progress = walkProgress(step.target, fix, now);
  const distanceText = distanceLine(progress, step.estimateMeters, step.negligible);
  const remainingTime = walkRemainingTime(session.trip, step, progress, now);
  const directionTextValue = progress?.bearing ? COMPASS_WORDS[progress.bearing] : null;

  let title: string;
  let subtitle: string | null = null;
  let notes: string[];
  let checklist: WalkView["checklist"] = null;
  let nextRide: WalkView["nextRide"] = null;
  let actions: GuidanceAction[];
  let proposal: string | null = null;

  if (toDestination) {
    title = step.negligible
      ? step.from
        ? `Your destination is at ${step.from.label}`
        : `You're at ${targetName}`
      : `Walk to ${targetName}`;
    notes = [GUIDANCE_COPY.entranceUnknown];
    actions = [{ event: "arrived", label: GUIDANCE_COPY.arrived, kind: "primary" }, END];
    if (progress?.nearTarget) proposal = `Close to ${targetName}. Tap “${GUIDANCE_COPY.arrived}”.`;
  } else {
    const chip = step.nextRide.routeChip;
    const at = session.atStop;
    if (at) title = `Wait for ${chip} at ${step.target.label}`;
    else if (step.kind === "transfer") {
      title = !step.negligible
        ? `Walk to ${step.target.label}`
        : step.from.stopId === step.target.stopId
          ? `Change at ${step.from.label}`
          : `Change to ${chip} at ${step.target.label}`;
    }
    else title = step.negligible ? `Start at ${step.target.label}` : `Walk to ${step.target.label}`;
    if (step.kind === "transfer") {
      subtitle = `${step.from.label} → ${step.target.label}`;
      checklist = [
        { text: `Got off at ${step.from.label}`, done: true },
        { text: `Walk to ${step.target.label}`, done: at || step.negligible },
        { text: `Wait for ${chip} at ${step.target.label}`, done: false },
      ];
    }
    notes = at ? [GUIDANCE_COPY.boardingSideUnknown(), GUIDANCE_COPY.signboardUnknown(chip)] : [GUIDANCE_COPY.boardingSideUnknown()];
    nextRide = nextRideInfo(step.nextRide);
    const board: GuidanceAction = { event: "boarded", label: GUIDANCE_COPY.boarded(chip), kind: at ? "primary" : "secondary" };
    actions = at ? [board, END] : [{ event: "atStop", label: GUIDANCE_COPY.atStop, kind: "primary" }, board, END];
    if (!at && progress?.nearTarget) proposal = `Close to ${step.target.label}. Tap “${GUIDANCE_COPY.atStop}”.`;
  }

  return {
    screen: "walk",
    stepKind: step.kind,
    stepLabel: stepLabel(step.index, total, step.kind),
    title,
    subtitle,
    distanceText,
    directionText: directionTextValue,
    remainingTime,
    locationNote: locationNote(fix, now),
    notes,
    checklist,
    nextRide,
    keepOpen: GUIDANCE_COPY.keepOpen,
    actions,
    undo: undoAction(session),
    live: { politeness: "polite", text: proposal ?? (progress ? `${spokenMeters(progress)} to ${targetName}, straight line` : title) },
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

function rideView(session: GuidanceSession, ride: RideState, step: RideStep, total: number, fix: LocationFix | null, now: number): RideView {
  const alightIndex = step.stops.length - 1;
  // A GPS-backed count only while GPS still supports it (countLost: the jeepney is past the window).
  const gps = ride.gpsSeen && !ride.countLost;
  const suggested = paraSuggested(ride);
  const stopsRemaining = Math.max(0, alightIndex - ride.passedIndex);
  const alight = step.alight.label;
  const chip = step.ride.routeChip;
  const remainingTime = rideRemainingTime(session.trip, step, ride, now);
  const onPath = pathProgress(session.trip, step, fix, now);

  let title: string;
  if (ride.paraAcknowledged) title = GUIDANCE_COPY.paraAckTitle;
  else if (suggested) title = GUIDANCE_COPY.stopIsNext;
  else if (gps && step.pinned) title = `${stopsCount(stopsRemaining)} to go`;
  else if (onPath && !onPath.offPath && onPath.getReady) title = GUIDANCE_COPY.getReady(alight);
  else title = `Ride to ${alight}`;

  const para = ride.paraAcknowledged
    ? { title: GUIDANCE_COPY.paraAckTitle, body: GUIDANCE_COPY.paraAckBody(alight), acknowledged: true }
    : suggested
      ? { title: GUIDANCE_COPY.paraTitle, body: GUIDANCE_COPY.paraBody(alight), acknowledged: false }
      : null;

  const gotOff = (kind: GuidanceAction["kind"]): GuidanceAction => ({ event: "gotOff", label: GUIDANCE_COPY.gotOff, kind });
  const missed: GuidanceAction = { event: "missedStop", label: GUIDANCE_COPY.missedStop, kind: "secondary" };
  const actions: GuidanceAction[] = ride.paraAcknowledged
    ? [gotOff("primary"), missed, END]
    : suggested
      ? [{ event: "paraAcknowledged", label: GUIDANCE_COPY.paraAck, kind: "primary" }, gotOff("secondary"), missed, END]
      : [{ event: "nextStopIsMine", label: GUIDANCE_COPY.nextStopIsMine, kind: "secondary" }, gotOff("secondary"), missed, END];

  return {
    screen: "ride",
    stepLabel: stepLabel(step.index, total, "ride"),
    title,
    subtitle: chip,
    badge: UNVERIFIED_ROUTE_BADGE,
    alightText: step.pinned ? (title.startsWith("Ride to") ? null : `Get off · ${alight}`) : freeAlightText(alight),
    countText: !step.pinned
      ? onPath?.offPath
        ? GUIDANCE_COPY.offPath
        : onPath
          ? GUIDANCE_COPY.metresLeft(onPath.remainingM)
          : `Ride along the approximate path to ${alight}`
      : gps
      ? `${ride.passedIndex} of ${stopsCount(step.stopsToRide)}`
      : `${stopsCount(step.stopsToRide)} after ${step.board.label}`,
    countNote: step.pinned ? GUIDANCE_COPY.stopsByPinOrder : GUIDANCE_COPY.noMarkedStops,
    remainingTime,
    stops: step.stops.map((s: StopRef, i) => ({
      label: s.label,
      state: i === 0 ? "boarded" : i === alightIndex ? "alight" : gps && i <= ride.passedIndex ? "passed" : "ahead",
    })),
    para,
    reportDriver: true,
    keepOpen: GUIDANCE_COPY.keepOpen,
    actions,
    undo: undoAction(session),
    live: para && !para.acknowledged ? { politeness: "assertive", text: GUIDANCE_COPY.paraTitle } : { politeness: "polite", text: title },
    usesLocation: true,
  };
}

function arriveView(session: GuidanceSession, steps: GuidanceStep[]): ArriveView {
  const option = session.trip.option;
  const last = steps.at(-1);
  const named = (last?.kind === "walk_to_destination" || last?.kind === "street_ride") && last.target.name !== UNNAMED_DESTINATION ? last.target.name : null;
  const title = GUIDANCE_COPY.arrivedTitle;
  return {
    screen: "arrive",
    stepLabel: `Step ${steps.length} of ${steps.length}`,
    title,
    body: GUIDANCE_COPY.arrivedBody(named),
    summary: {
      walkText: `${formatDistance(option.walkEstimateMeters)} walk`,
      rides: steps.flatMap((s) =>
        s.kind === "ride" ? [{ chip: s.ride.routeChip, stopsText: s.pinned ? stopsCount(s.stopsToRide) : "along the path" }]
        : s.kind === "street_ride" ? [{ chip: modeTitle(s.mode), stopsText: "along streets" }]
        : []),
      fareText: fareChipText(option.fare),
    },
    actions: [{ event: "end", label: GUIDANCE_COPY.done, kind: "primary" }],
    undo: undoAction(session),
    live: { politeness: "polite", text: title },
    usesLocation: false,
  };
}

export function guidanceView(session: GuidanceSession, fix: LocationFix | null, now: number): GuidanceView {
  if (session.status === "ended") return { screen: "ended", usesLocation: false };
  if (session.status === "missed_stop") {
    return {
      screen: "missed",
      title: GUIDANCE_COPY.missedTitle,
      body: GUIDANCE_COPY.missedBody,
      replan: true,
      usesLocation: false,
      actions: [{ event: "end", label: GUIDANCE_COPY.endGuidance, kind: "primary" }],
      undo: undoAction(session),
      live: { politeness: "polite", text: GUIDANCE_COPY.missedTitle },
    };
  }
  const steps = sessionSteps(session);
  if (session.status === "arrived") return arriveView(session, steps);
  const step = steps[session.stepIndex];
  if (!step) return { screen: "ended", usesLocation: false }; // a malformed option with no steps
  if (step.kind === "ride") return rideView(session, session.ride!, step, steps.length, fix, now);
  if (step.kind === "street_ride") return streetView(session, step, steps.length);
  return walkView(session, step, steps.length, fix, now);
}

const modeTitle = (mode: StreetRideStep["mode"]) => (mode === "tricycle" ? "Tricycle" : "Padyak");

function streetView(session: GuidanceSession, step: StreetRideStep, total: number): StreetRideView {
  const title = `Take a ${step.mode} to ${step.target.name}`;
  return {
    screen: "street_ride",
    mode: step.mode,
    stepLabel: `Step ${step.index + 1} of ${total} · ${modeTitle(step.mode)}`,
    title,
    // The title already says "Take a … to …": the instruction is the rest (distance, route state, fare).
    instruction: step.text.startsWith(`${title} · `) ? step.text.slice(title.length + 3) : step.text,
    notes: step.notes,
    remainingTime: `${modeTitle(step.mode)} time not estimated`,
    keepOpen: GUIDANCE_COPY.keepOpen,
    actions: [{ event: "arrived", label: GUIDANCE_COPY.arrived, kind: "primary" }, END],
    undo: undoAction(session),
    live: { politeness: "polite", text: title },
    usesLocation: false,
  };
}
