// What the Walk / Ride / Transfer / Arrive screens show for a session and the latest fix. Pure.
//
// Honest by construction (global constraints, copy rules §6.5): distances are straight-line
// estimates ("path not verified"), stops are counted by provisional pin order, a time is only ever
// a range labelled "About … (estimate)" from the snapshot's model (never a clock time or
// "arriving"), nothing says "live", and there is no curb, crossing, boarding side, signboard
// text or entrance, because none of them exists in the data; the artboards' versions of those lines
// are replaced by a plain "not mapped / not on file" note with a next step. "Para! Next stop is
// yours" is a suggestion shown only on a ride the person confirmed boarding, by the single rule
// `paraSuggested` (progress.ts): they said their stop is next, or a precise (<= 30 m) fix put them,
// in pin order, at the stop before the alighting pin or within 300 m of it; it is the only
// assertive announcement. The ride screen reads the session only: every usable fix must be
// dispatched to the session as a `fix` event (so progress survives a reload); the `fix` argument
// here feeds the walk screens. GPS proposes ("You look close to …"), the person
// confirms with the buttons, whose events the session reducer applies.
import { STALE_MS, type LocationFix } from "../geo/location-fix";
import { COMPASS_WORDS } from "../geo/bearing";
import { UNVERIFIED_ROUTE_BADGE } from "../planner/labels";
import { directionText, fareChipText, formatDistance } from "../trip/present";
import { estimateOption, type EtaLeg, type EtaOptionInput } from "../eta/eta";
import { formatLeg, formatRange, formatRemaining } from "../eta/format";
import { paraSuggested, usableFix, walkProgress, type WalkProgress } from "./progress";
import { reduceSession, sessionSteps, type GuidanceEvent, type GuidanceSession, type RideState } from "./session";
import {
  UNNAMED_DESTINATION,
  type GuidanceStep,
  type GuidanceTrip,
  type RideRef,
  type RideStep,
  type StopRef,
  type TransferStep,
  type WalkToBoardStep,
  type WalkToDestinationStep,
} from "./steps";

export const GUIDANCE_COPY = {
  keepOpen: "Keep ParaNaga open for guidance.",
  endGuidance: "End guidance",
  atStop: "I'm at the stop",
  boarded: (chip: string) => `I boarded ${chip}`,
  arrived: "I've arrived",
  nextStopIsMine: "My stop is next",
  paraAck: "I said “Para”",
  gotOff: "I got off",
  missedStop: "I missed my stop",
  done: "Done",
  pathEstimate: "straight-line estimate, path not verified",
  boardingSideUnknown: (chip: string) => `Boarding side isn't mapped. Ask the driver or people waiting where ${chip} stops.`,
  signboardUnknown: (chip: string) => `Signboard text isn't on file. Before you get on, ask the driver: “${chip}?”`,
  entranceUnknown: "Entrances aren't mapped. Look for the way in when you get there.",
  locationApproximate: (accuracy: number) => `Your location is approximate (± ${Math.round(accuracy)} m), so distance and direction are hidden.`,
  locationStale: "Your location hasn't updated recently, so distance and direction are hidden.",
  locationImprecise: "Your location isn't precise enough, so distance and direction are hidden.",
  stopsByPinOrder: "Stops are counted by pin order on a provisional route, and jeepneys may stop elsewhere. Watch for your stop too.",
  paraTitle: "Para! Next stop is yours",
  paraBody: (stop: string) => `Get off at ${stop}. Say “Para” to the driver when you see it.`,
  paraAckTitle: "Getting off at the next stop",
  paraAckBody: (stop: string) => `Step off when the jeepney stops at ${stop}, then tap “I got off”.`,
  stopIsNext: "Your stop is next",
  arrivedTitle: "You've arrived",
  arrivedBody: (destination: string | null) =>
    `${destination ? `${destination}.` : "You're at your destination."} Guidance has ended and ParaNaga has stopped using your location.`,
  undo: "Undo last step",
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
  boardedText: string;
  alightText: string;
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

export type GuidanceView = WalkView | RideView | ArriveView | MissedView | EndedView;

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

function distanceLine(progress: WalkProgress | null, name: string, estimateMeters: number, negligible: boolean): string | null {
  if (progress) {
    return progress.distanceMeters < 10 ? `Under 10 m to ${name} in a straight line` : `≈ ${progress.distanceMeters} m to ${name} in a straight line`;
  }
  return negligible ? null : `${formatDistance(estimateMeters)} walk · ${GUIDANCE_COPY.pathEstimate}`;
}

// ---- time left (Task 14): the snapshot's model through the eta domain, never a hand-set speed.
// The estimate covers the rest of the trip from now (the current leg's remainder + the later legs),
// so the peak test spans [now, now + the remaining trip]; the current leg's range is shown.
// Walks: a GPS remainder is a straight line, so it is ×1.3 like the plan's estimates; without GPS
// the plan's walk (its graph path length when one was on file, else its ×1.3 estimate).

export const TIME_NOT_AVAILABLE = "Time not available";
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

function walkRemainingTime(trip: GuidanceTrip, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, progress: WalkProgress | null, targetName: string, now: number): string | null {
  if (step.negligible || step.legIndex === null) return null;
  if (progress && progress.distanceMeters < 15) return null;
  if (!trip.etaModel || !(now > 0)) return TIME_NOT_AVAILABLE;
  const current: CurrentLeg = { kind: "walk", estimateMeters: progress ? Math.round(progress.distanceMeters * 1.3) : step.estimateMeters };
  const length = progress ? null : (trip.walkLengths?.[step.legIndex] ?? null);
  const leg = currentLegEstimate(trip, step.legIndex, current, length, now);
  if (!leg || leg.lowMin === null || leg.highMin === null) return TIME_NOT_AVAILABLE;
  return `About ${formatRange(leg.lowMin, leg.highMin)} to ${targetName} (estimate)`;
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
  return { chip: ride.routeChip, routeName: ride.routeName, direction: directionText(ride.loopDirection, "long"), badge: UNVERIFIED_ROUTE_BADGE };
}

function walkView(session: GuidanceSession, step: WalkToBoardStep | TransferStep | WalkToDestinationStep, total: number, fix: LocationFix | null, now: number): WalkView {
  const toDestination = step.kind === "walk_to_destination";
  const targetName = toDestination ? step.target.name : step.target.label;
  const progress = walkProgress(step.target, fix, now);
  const distanceText = distanceLine(progress, targetName, step.estimateMeters, step.negligible);
  const remainingTime = walkRemainingTime(session.trip, step, progress, targetName, now);
  const directionTextValue = progress?.bearing ? `In a straight line, ${targetName} is to the ${COMPASS_WORDS[progress.bearing]}.` : null;

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
    if (progress?.nearTarget) proposal = `You look close to ${targetName}. Tap “${GUIDANCE_COPY.arrived}” when you're there.`;
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
    notes = at ? [GUIDANCE_COPY.boardingSideUnknown(chip), GUIDANCE_COPY.signboardUnknown(chip)] : [GUIDANCE_COPY.boardingSideUnknown(chip)];
    nextRide = nextRideInfo(step.nextRide);
    const board: GuidanceAction = { event: "boarded", label: GUIDANCE_COPY.boarded(chip), kind: at ? "primary" : "secondary" };
    actions = at ? [board, END] : [{ event: "atStop", label: GUIDANCE_COPY.atStop, kind: "primary" }, board, END];
    if (!at && progress?.nearTarget) proposal = `You look close to ${step.target.label}. Tap “${GUIDANCE_COPY.atStop}” when you're there.`;
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
    live: { politeness: "polite", text: proposal ?? (progress ? distanceText! : title) },
    usesLocation: true,
  };
}

function rideView(session: GuidanceSession, ride: RideState, step: RideStep, total: number, now: number): RideView {
  const alightIndex = step.stops.length - 1;
  // A GPS-backed count only while GPS still supports it (countLost: the jeepney is past the window).
  const gps = ride.gpsSeen && !ride.countLost;
  const suggested = paraSuggested(ride);
  const stopsRemaining = Math.max(0, alightIndex - ride.passedIndex);
  const alight = step.alight.label;
  const chip = step.ride.routeChip;
  const direction = directionText(step.ride.loopDirection, "long");
  const remainingTime = rideRemainingTime(session.trip, step, ride, now);

  let title: string;
  if (ride.paraAcknowledged) title = GUIDANCE_COPY.paraAckTitle;
  else if (suggested) title = GUIDANCE_COPY.stopIsNext;
  else if (gps) title = `${stopsCount(stopsRemaining)} to go`;
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
    subtitle: direction ? `${chip} · ${direction}` : chip,
    badge: UNVERIFIED_ROUTE_BADGE,
    boardedText: `${step.board.label} · boarded`,
    alightText: `Get off · ${alight}`,
    countText: gps
      ? `${ride.passedIndex} of ${stopsCount(step.stopsToRide)} passed, by pin order`
      : `${stopsCount(step.stopsToRide)} after ${step.board.label}, by pin order`,
    countNote: GUIDANCE_COPY.stopsByPinOrder,
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
  const named = last?.kind === "walk_to_destination" && last.target.name !== UNNAMED_DESTINATION ? last.target.name : null;
  const title = GUIDANCE_COPY.arrivedTitle;
  return {
    screen: "arrive",
    stepLabel: `Trip complete · Step ${steps.length} of ${steps.length}`,
    title,
    body: GUIDANCE_COPY.arrivedBody(named),
    summary: {
      walkText: `${formatDistance(option.walkEstimateMeters)} walk · estimate`,
      rides: steps.flatMap((s) => (s.kind === "ride" ? [{ chip: s.ride.routeChip, stopsText: stopsCount(s.stopsToRide) }] : [])),
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
  const step = steps[session.stepIndex]!;
  if (step.kind === "ride") return rideView(session, session.ride!, step, steps.length, now);
  return walkView(session, step, steps.length, fix, now);
}
