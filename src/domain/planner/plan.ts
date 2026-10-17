// Trip planner (plan E §A–§D). Pure: the network and `now` are arguments; no I/O.
//
// Inputs: the snapshot (stops, pins, fares, routes with fleets and notes), the revision's Lines
// (traced approximate paths; permanent jeepney variants, ok or flagged) and the street graph
// (walk, tricycle and padyak edges). Either may be null (offline before they are cached).
//
// Jeepney options (≤ 2 rides): a ride boards at any approach of a path to the origin and gets off
// at any approach to the destination (paths.ts: 500 m straight-line runs, ≥ 200 m of riding, a
// circuit never a full lap). Access and egress walks are street-graph metres ≤ 750; a transfer is
// one of the network's transfer points (paths within 300 m) with a graph walk ≤ 450. Without a
// graph a walk is round(straight × 1.3), labelled so. Must-save-walking (D14) is applied inside
// the pair selection: a combination is a candidate only when its walk metres are strictly less
// than the direct walk (graph length, or the ×1.3 estimate). The best candidate per variant
// sequence is kept; then the Pareto set on (rides, walk metres, ride metres); at most three:
// the lowest score, "Fewest transfers" and "Least walking" (one option may hold several labels).
// Score: walk + 0.25 × ride + 600 × (rides − 1); ties: rides, walk, ride, id.
//
// Options, in order (at most 6): walk (when the direct walk is < 500 m) → jeepney options by score
// → tricycle (always) → padyak. Exactly one option is "Recommended" (ruling d, review I1):
// ≥ 500 m → the tricycle; < 500 m → the walk, unless the best-score jeepney passes the destination
// (its drop-off within PASSES_DESTINATION_M straight-line), which is then Recommended instead.
// Padyak (both ends in one documented area and a padyak street path
// ≤ 2,000 m; "Short local ride"). Tricycle and padyak are routed with routeStreet on the planner's
// clock (Asia/Manila from the epoch, rules.ts): the 2006 tricycle restrictions are lifted 21:00–05:00.
// A tricycle with no street route (a daytime pocket) gets the straight-line distance, flagged
// "Route not confirmed", never a drawn path. Neither has minutes (D11).
//
// Far areas (Increment F, far-areas.ts): when either end's nearest barangay anchor is in a far zone, that
// end's access/egress cap is FAR_END_WALK_CAP_M, there is no point-to-point tricycle (except a special trip:
// origin not far, within a SPECIAL_TRIP_TERMINAL_WALK_M walk of a published tricycle terminal serving the
// destination zone; never Recommended, fare unavailable), the best-score jeepney is Recommended, and with no
// jeepney the walk card is shown at any length, unlabelled (no Recommended option). The plan carries farNote.
// Access option (T4): destination far, origin not, and every jeepney option shown walks over ACCESS_TRICYCLE_MIN_WALK_M
// to its first boarding point (or there is none): tricycle (over 600 m) to the zone's loading point, walk, one ride, walk; id
// "tri>{ride id}", after the jeepneys; Recommended only when there is no other jeepney option.
// Non-far trips are unchanged.
// Via groups (T5, far-areas viaGroups): when 2+ routes of one group have a one-ride candidate (after must-save-walking),
// the jeepney block is the Pareto picks plus the best candidate of each such route, each carrying `via` (data for a
// chip), within MAX_OPTIONS minus the walk, access, tricycle and padyak options. Trim: non-via extras (worst score
// first), then vias; the best-score option stays; a label on a dropped option goes with it.
//
// Ids: walk "walk", tricycle "tricycle", padyak "padyak:{area}", a ride
// "{variantId}@{round10(board)}-{round10(alight)}", rides joined by ">".
// Coverage is "none" only outside the city or for the same place; `jeepneyReason` says why there
// is no jeepney option. Honesty: every ride is approximate, boarding and the path unverified.
import type { NetworkSnapshot, Verification } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { isInsideNaga } from "../geo/naga";
import { encodePolyline } from "../geo/polyline";
import type { LatLng } from "../geo/types";
import { fleetSummary, type FleetSummary, type RouteMode } from "../modes/fleet";
import { ruleLifted, type StreetRule } from "../walk/rules";
import { boundedDistances, padyakAreas, routeStreet, snapWalk, type StreetRoute, type WalkGraph } from "../walk/walk-graph";
import {
  fareClasses, legFareEstimate, padyakFare, sumFares, tricycleFare, type LegFare, type PadyakFare, type TricycleFare, type TripFare,
} from "./fares";
import { FAR_AREAS, locatedTerminals, nearestAnchorId, ROUTE_BOARDING_LINK_M, zoneOf, type FarZone, type LocatedTerminal, type ViaGroup } from "./far-areas";
import { buildPlanningNetwork, type PlanningNetwork } from "./graph";
import { PLAN_LABELS, SAME_PLACE_M, UNVERIFIED_ROUTE_BADGE, type PlanLabel } from "./labels";
import { rideNotes } from "./notes";
import { projectOnLine } from "../geo/measure";
import { APPROACH_RADIUS_M, approaches, MAX_ACCESS_WALK_GRAPH_M, nameFreePoint, rideMeters, type Approach, type NamedStop, type PathVariant, type PlanningLine } from "./paths";

export { PLAN_LABELS, SAME_PLACE_M, UNVERIFIED_ROUTE_BADGE, type PlanLabel };

export const WALK_CARD_MAX_M = 500;
/** A jeepney "passes the destination" when its drop-off point is this close to it (straight-line metres). */
export const PASSES_DESTINATION_M = 100;
export const MAX_TRANSFER_WALK_GRAPH_M = 450;
export const PADYAK_MAX_M = 2000;
export const MAX_OPTIONS = 6;
/** Fallback only (no street graph, or an end off the street map). */
export const STRAIGHT_WALK_FACTOR = 1.3;
export const RIDE_WEIGHT = 0.25;
export const TRANSFER_PENALTY_M = 600;
/** Access or egress walk cap at an end in a far zone (Increment F), instead of MAX_ACCESS_WALK_GRAPH_M. */
export const FAR_END_WALK_CAP_M = 1500;
/** Approach radius (straight-line) at a far end, so the far-end walk cap can apply: FAR_END_WALK_CAP_M / 1.3. */
export const FAR_END_APPROACH_RADIUS_M = 1150;
/** A special-trip tricycle into a far zone is shown only from within this walk of a tricycle terminal serving it. */
export const SPECIAL_TRIP_TERMINAL_WALK_M = 300;
/** Access option (Increment F, T4): offered when the best zone jeepney's walk to its boarding point is over this, or there is none. */
export const ACCESS_TRICYCLE_MIN_WALK_M = 600;
/** Review I3: offer access when no jeepney option is shown or the shortest first walk among them is over 600 m. */
export const accessWanted = (firstWalksM: readonly number[]) => Math.min(...firstWalksM) > ACCESS_TRICYCLE_MIN_WALK_M;
/** Review I3: an access tricycle of 600 m or less is no better than walking to the loading point. */
export const accessTricycleOk = (tricycleM: number) => tricycleM > ACCESS_TRICYCLE_MIN_WALK_M;
const WALK_RADIUS_M = 1500;
/** Approach-run search step (samples of 25 m) when the projection's walk is over the cap. */
const RUN_STRIDE = 4;

export type Place = { kind: "origin" | "destination" | "stop" | "point"; lat: number; lng: number; stopId: string | null; name: string | null };

export type WalkBasis = "street_graph" | "straight_x1_3";

export type WalkLeg = {
  kind: "walk";
  from: Place;
  to: Place;
  /** Straight-line metres. */
  distanceMeters: number;
  /** The walk: street-graph metres, or round(straight × 1.3) (basis). */
  estimateMeters: number;
  pathVerified: false;
  /** Encoded polyline (precision 5) of the street path; null for an estimate. */
  path: string | null;
  basis: WalkBasis;
};

/** A board or alight point anywhere along the path, named by a nearby pin or stop when there is one. */
export type FreePoint = { lat: number; lng: number; measureM: number; stopId: string | null; name: string | null };

export type RideLeg = {
  kind: "ride";
  variantId: string;
  routeCode: string;
  routeName: string;
  verification: Verification;
  board: FreePoint;
  alight: FreePoint;
  /** Named pins passed, board → alight (Loops A/B); [] for routes without pins. */
  stops: NamedStop[];
  /** Whole metres along the approximate path. */
  distanceMeters: number;
  approximate: true;
  boardingVerified: false;
  pathVerified: false;
  fare: LegFare;
  mode: RouteMode;
  fleet: FleetSummary;
  distanceBasis: "approximate_path";
  boardMeasureM: number;
  alightMeasureM: number;
  /** Route notes (near ones first) and the flagged-path note. */
  notes: string[];
};

/** street_graph: routed; straight_line: no street route found ("Route not confirmed"); unavailable: no graph. */
export type StreetLegBasis = "street_graph" | "straight_line" | "unavailable";

type StreetLeg = { from: Place; to: Place; distanceMeters: number | null; path: string | null; basis: StreetLegBasis; notes: string[]; ruleCodes: string[] };
export type TricycleLeg = StreetLeg & { kind: "tricycle"; fare: TricycleFare };
export type PadyakLeg = StreetLeg & { kind: "padyak"; fare: PadyakFare };

export type PlanLeg = WalkLeg | RideLeg | TricycleLeg | PadyakLeg;
export type OptionMode = "walk" | "jeepney" | "tricycle" | "padyak";

/** Which via of a shared corridor a one-ride jeepney option takes (far-areas viaGroups; Increment F, T5). Data for a chip. */
export type PlanVia = { group: string; routeCode: string; label: string; note: string | null };

export type PlanOption = {
  id: string;
  mode: OptionMode;
  labels: PlanLabel[];
  legs: PlanLeg[];
  rides: number;
  /** Walk metres (graph or ×1.3 estimate), summed; 0 for tricycle and padyak. */
  walkMeters: number;
  walkEstimateMeters: number;
  rideMeters: number;
  score: number;
  fare: TripFare;
  evidence: "provisional";
  /** Present only on a one-ride option of a route in a via group where 2+ of its routes serve the trip. Absent otherwise. */
  via?: PlanVia;
};

/** The planner emits only outside_city and same_place; the others remain for older saved bodies. */
export type NoCoverageReason =
  | "outside_city" | "same_place" | "no_stop_near_origin" | "no_stop_near_destination" | "walk_shorter" | "no_route";
export type JeepneyReason = "no_path_near_origin" | "no_path_near_destination" | "walk_shorter" | "no_route";

export type PlannerNetwork = { lines: { lines: readonly PlanningLine[] } | null; streets: WalkGraph | null };

export type TripPlan = {
  revisionId: string;
  coverage: "provisional" | "none";
  reason: NoCoverageReason | null;
  /** The direct walk: street-graph metres, or round(straight × 1.3); null only outside the city. */
  directWalkEstimateMeters: number | null;
  /** Why there is no jeepney option; null when there is one (or nothing was planned). */
  jeepneyReason: JeepneyReason | null;
  options: PlanOption[];
  notes: string[];
  /** Present only when an end is in a far zone (Increment F): why no tricycle is suggested. Absent otherwise, so
   * non-far plans serialize exactly as before; the response schema reads it as null. */
  farNote?: string;
};

type PlannerSnapshot = Pick<NetworkSnapshot, "revision" | "stops" | "variants" | "fareRules"> & Partial<Pick<NetworkSnapshot, "routes">> & {
  /** Published terminals; only those with a coordinate are used (far-area tricycle terminals). */
  terminals?: readonly { code: string; name: string; lat: number | null; lng: number | null }[];
};

// ---------------------------------------------------------------- planning network memo

const networks = new WeakMap<object, { snapshot: object; net: PlanningNetwork }>();

/** The planning network for these Lines and snapshot, built once per Lines object (immutable per revision). */
export function planningNetwork(snapshot: Pick<NetworkSnapshot, "stops" | "variants">, lines: PlannerNetwork["lines"]): PlanningNetwork {
  if (!lines) return buildPlanningNetwork(snapshot, null);
  const hit = networks.get(lines);
  if (hit?.snapshot === snapshot) return hit.net;
  const net = buildPlanningNetwork(snapshot, lines);
  networks.set(lines, { snapshot, net });
  return net;
}

// ---------------------------------------------------------------- walks

type Walk = { m: number; basis: WalkBasis };
type Walker = (to: LatLng) => Walk | null;

const estimate = (a: LatLng, b: LatLng) => Math.round(haversineMeters(a, b) * STRAIGHT_WALK_FACTOR);

/** Walk lengths from `from` (graph when it snaps, else ×1.3), capped at `capM`. */
function walker(g: WalkGraph | null, from: LatLng, radiusM: number, capM: number): Walker {
  const keep = (w: Walk) => (w.m <= capM ? w : null);
  if (g && snapWalk(g, from)) {
    const d = boundedDistances(g, from, radiusM, "walk");
    return (to) => {
      const m = d(to);
      return m === null ? null : keep({ m: Math.round(m), basis: "street_graph" });
    };
  }
  return (to) => keep({ m: estimate(from, to), basis: "straight_x1_3" });
}

function walkLeg(g: WalkGraph | null, from: Place, to: Place, w: Walk, route?: StreetRoute): WalkLeg {
  const r = w.basis === "street_graph" && g ? (route ?? routeStreet(g, from, to, { mode: "walk", now: new Date(0) })) : null;
  return {
    kind: "walk", from, to, distanceMeters: Math.round(haversineMeters(from, to)), estimateMeters: w.m, pathVerified: false,
    path: r?.kind === "path" ? encodePolyline(r.coords) : null, basis: w.basis,
  };
}

// ---------------------------------------------------------------- jeepney search

type Hop = { v: number; board: Approach; alight: Approach; rideM: number };
type Cand = { hops: Hop[]; walks: Walk[]; walkM: number; rideM: number; score: number; id: string };

const round1 = (m: number) => Math.round(m * 10) / 10;
const round10 = (m: number) => Math.round(m / 10) * 10;

function compare(a: Cand, b: Cand): number {
  return a.score - b.score || a.hops.length - b.hops.length || a.walkM - b.walkM || a.rideM - b.rideM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function dominates(a: Cand, b: Cand): boolean {
  const le = a.hops.length <= b.hops.length && a.walkM <= b.walkM && a.rideM <= b.rideM;
  return le && (a.hops.length < b.hops.length || a.walkM < b.walkM || a.rideM < b.rideM);
}

function search(
  net: PlanningNetwork, g: WalkGraph | null, origin: LatLng, destination: LatLng, directM: number, accessCapM: number, egressCapM: number,
  originFar = false, destinationFar = false,
) {
  const access = walker(g, origin, WALK_RADIUS_M, accessCapM);
  const egress = walker(g, destination, WALK_RADIUS_M, egressCapM);
  // Each approach boards or alights at its straight-line projection. When that walk is over the cap or
  // unreachable (a campus or a river between), it falls back to the run sample with the shortest walk
  // (prod regression: the loops' nearest points to the Ateneo centroid are 820+ m around the campus).
  const ends = (p: LatLng, w: Walker, far: boolean) =>
    net.variants.map((v) => approaches(v, p, far ? FAR_END_APPROACH_RADIUS_M : APPROACH_RADIUS_M).flatMap(({ run, ...a }) => {
      let best: { a: Approach; walk: Walk } | null = null;
      const walk = w(a.point);
      if (walk) best = { a, walk };
      else if (run) {
        // Every 4th sample (100 m), then the samples around the best one.
        let bestK = -1;
        const tryAt = (k: number) => {
          const s = run[k];
          const sw = s ? w(s) : null;
          if (s && sw && (!best || sw.m < best.walk.m)) [best, bestK] = [{ a: { measureM: s.m, point: { lat: s.lat, lng: s.lng }, distM: haversineMeters(s, p) }, walk: sw }, k];
        };
        for (let k = 0; k < run.length; k += RUN_STRIDE) tryAt(k);
        tryAt(run.length - 1);
        const coarse = bestK;
        if (coarse >= 0) for (let k = coarse - RUN_STRIDE + 1; k < coarse + RUN_STRIDE; k++) if (k !== coarse) tryAt(k);
      }
      return best ? [{ a: { ...best.a, measureM: round1(best.a.measureM) }, walk: best.walk }] : [];
    }));
  const boards = ends(origin, access, originFar);
  const alights = ends(destination, egress, destinationFar);
  const transferWalks = new Map<string, Walk | null>();
  const transferWalk = (i: number, k: number): Walk | null => {
    const key = `${i}:${k}`;
    if (!transferWalks.has(key)) {
      const t = net.transfers[i]![k]!;
      const w = t.straightM === 0 ? { m: 0, basis: g ? "street_graph" as const : "straight_x1_3" as const }
        : walker(g, t.from, MAX_TRANSFER_WALK_GRAPH_M, MAX_TRANSFER_WALK_GRAPH_M)(t.to);
      transferWalks.set(key, w);
    }
    return transferWalks.get(key)!;
  };

  const best = new Map<string, Cand>();
  let walkShorter = false;
  const consider = (hops: Hop[], walks: Walk[]) => {
    const walkM = walks.reduce((s, w) => s + w.m, 0);
    if (walkM >= directM) {
      walkShorter = true;
      return;
    }
    const rideM = hops.reduce((s, h) => s + h.rideM, 0);
    const score = walkM + RIDE_WEIGHT * rideM + TRANSFER_PENALTY_M * (hops.length - 1);
    const id = hops.map((h) => `${net.variants[h.v]!.variantId}@${round10(h.board.measureM)}-${round10(h.alight.measureM)}`).join(">");
    const seq = hops.map((h) => net.variants[h.v]!.variantId).join(">");
    const c: Cand = { hops, walks, walkM, rideM, score, id };
    const prior = best.get(seq);
    if (!prior || compare(c, prior) < 0) best.set(seq, c);
  };
  const ride = (v: PathVariant, from: number, to: number) => {
    const d = rideMeters(v, from, to);
    return d === null ? null : Math.round(d);
  };

  net.variants.forEach((v, i) => {
    for (const b of boards[i]!) {
      for (const a of alights[i]!) {
        const r = ride(v, b.a.measureM, a.a.measureM);
        if (r !== null) consider([{ v: i, board: b.a, alight: a.a, rideM: r }], [b.walk, a.walk]);
      }
    }
    if (boards[i]!.length === 0) return;
    net.transfers[i]!.forEach((t, k) => {
      const j = t.toVariant;
      if (alights[j]!.length === 0) return;
      const tw = transferWalk(i, k);
      if (!tw) return;
      const off: Approach = { measureM: round1(t.fromM), point: t.from, distM: 0 };
      const on: Approach = { measureM: round1(t.toM), point: t.to, distM: t.straightM };
      for (const b of boards[i]!) {
        const r1 = ride(v, b.a.measureM, off.measureM);
        if (r1 === null) continue;
        for (const a of alights[j]!) {
          const r2 = ride(net.variants[j]!, on.measureM, a.a.measureM);
          if (r2 !== null) consider([{ v: i, board: b.a, alight: off, rideM: r1 }, { v: j, board: on, alight: a.a, rideM: r2 }], [b.walk, tw, a.walk]);
        }
      }
    });
  });

  const cands = [...best.values()];
  const pareto = cands.filter((a) => !cands.some((b) => b !== a && dominates(b, a))).sort(compare);
  const fewest = [...pareto].sort((a, b) => a.hops.length - b.hops.length || compare(a, b))[0];
  const least = [...pareto].sort((a, b) => a.walkM - b.walkM || compare(a, b))[0];
  const picked = [...new Set([pareto[0], fewest, least])].filter((c): c is Cand => c !== undefined).sort(compare);
  const options = picked.map((c) => ({
    c, labels: [...(c === fewest ? ["Fewest transfers"] : []), ...(c === least ? ["Least walking"] : [])] as PlanLabel[],
  }));
  const reason: JeepneyReason | null = options.length > 0 ? null
    : !boards.some((b) => b.length > 0) ? "no_path_near_origin"
      : !alights.some((a) => a.length > 0) ? "no_path_near_destination"
        : walkShorter ? "walk_shorter" : "no_route";
  return { options, reason, alights, cands };
}

/**
 * Via groups (plan F, T5): a group is active when 2+ of its routes have a one-ride candidate (after must-save-walking,
 * the `best` map). `reps` holds the best candidate of each such route (and, if the group has endAnchors, one end of the trip is at one); `byRoute` says which route is which via.
 */
function activeVias(
  net: PlanningNetwork, cands: Cand[], groups: readonly ViaGroup[], endAnchorIds: readonly (number | null)[],
): { reps: Set<Cand>; byRoute: Map<string, PlanVia> } {
  const reps = new Set<Cand>();
  const byRoute = new Map<string, PlanVia>();
  for (const g of groups) {
    // A group with endAnchors applies only to a trip with an end whose nearest barangay anchor is one of them.
    if (g.endAnchors && !endAnchorIds.some((id) => id !== null && g.endAnchors!.includes(id))) continue;
    const found = g.routes.flatMap((r) => {
      const own = cands.filter((c) => c.hops.length === 1 && net.variants[c.hops[0]!.v]!.routeCode === r.routeCode).sort(compare)[0];
      return own ? [{ r, own }] : [];
    });
    if (found.length < 2) continue;
    for (const { r, own } of found) {
      reps.add(own);
      if (!byRoute.has(r.routeCode)) byRoute.set(r.routeCode, { group: g.code, routeCode: r.routeCode, label: r.via, note: r.aliasNote ?? null });
    }
  }
  return { reps, byRoute };
}

function freePoint(net: PlanningNetwork, v: PathVariant, a: Approach): FreePoint {
  const named = nameFreePoint(net, v, a.measureM, a.point);
  return { lat: a.point.lat, lng: a.point.lng, measureM: a.measureM, stopId: named?.stopId ?? null, name: named?.name ?? null };
}

const pointPlace = (p: FreePoint): Place => ({ kind: "point", lat: p.lat, lng: p.lng, stopId: p.stopId, name: p.name });

function jeepneyOption(
  c: Cand, labels: PlanLabel[], net: PlanningNetwork, g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, destination: LatLng,
): PlanOption {
  const routes = new Map((snapshot.routes ?? []).map((r) => [r.routeId, r]));
  const stopsById = new Map(net.stops.map((s) => [s.id, s]));
  const legs: PlanLeg[] = [];
  const rides: RideLeg[] = [];
  let from: Place = { kind: "origin", lat: origin.lat, lng: origin.lng, stopId: null, name: null };
  c.hops.forEach((h, k) => {
    const v = net.variants[h.v]!;
    const board = freePoint(net, v, h.board);
    const alight = freePoint(net, v, h.alight);
    legs.push(walkLeg(g, from, pointPlace(board), c.walks[k]!));
    const route = routes.get(v.routeId);
    const fleet = route ? route.fleet : fleetSummary([], v.mode);
    const passed = (m: number) => (v.isCircuit ? (((m - board.measureM) % v.lengthM) + v.lengthM) % v.lengthM : m - board.measureM);
    const stops = (net.pins.get(v.variantId) ?? [])
      .map((p) => ({ p, d: passed(p.measureM) }))
      .filter((x) => x.d >= 0 && x.d <= h.rideM)
      .sort((x, y) => x.d - y.d)
      .flatMap((x) => stopsById.get(x.p.stopId) ?? []);
    const leg: RideLeg = {
      kind: "ride", variantId: v.variantId, routeCode: v.routeCode, routeName: v.routeName,
      verification: snapshot.variants.find((x) => x.variantId === v.variantId)?.verification ?? "unverified",
      board, alight, stops, distanceMeters: h.rideM, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFareEstimate(h.rideM, snapshot.fareRules, { classes: fareClasses(fleet.colourKey), reports: route?.fareReports ?? [] }),
      mode: v.mode, fleet, distanceBasis: "approximate_path", boardMeasureM: board.measureM, alightMeasureM: alight.measureM,
      notes: rideNotes(route?.notes ?? [], [board, alight, destination], v.status === "flagged"),
    };
    legs.push(leg);
    rides.push(leg);
    from = pointPlace(alight);
  });
  legs.push(walkLeg(g, from, { kind: "destination", lat: destination.lat, lng: destination.lng, stopId: null, name: null }, c.walks.at(-1)!));
  return {
    id: c.id, mode: "jeepney", labels, legs, rides: c.hops.length, walkMeters: c.walkM, walkEstimateMeters: c.walkM, rideMeters: c.rideM,
    score: c.score, fare: sumFares(rides.map((l) => l.fare)), evidence: "provisional",
  };
}

// ---------------------------------------------------------------- tricycle and padyak

/** "21:00" → "9 pm", "05:30" → "5:30 am". */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

function ruleNote(r: StreetRule, used: boolean, now: Date): string | null {
  const window = r.liftedFrom && r.liftedTo ? `${clock(r.liftedFrom)}–${clock(r.liftedTo)}` : null;
  if (!ruleLifted(r, now)) return `Avoids the restricted roads we could locate (${r.label}${window ? `; allowed ${window}` : ""})`;
  return used ? `Uses roads tricycles may use only ${window} (${r.label})` : null;
}

const peso = (c: number) => `₱${c / 100}`;

function streetLeg(g: WalkGraph | null, origin: LatLng, destination: LatLng, route: StreetRoute | null, toPlace?: Place): StreetLeg {
  const from: Place = { kind: "origin", lat: origin.lat, lng: origin.lng, stopId: null, name: null };
  const to: Place = toPlace ?? { kind: "destination", lat: destination.lat, lng: destination.lng, stopId: null, name: null };
  if (!g || !route || (route.kind === "straight" && route.reason === "no_mode_data")) {
    return { from, to, distanceMeters: null, path: null, basis: "unavailable", notes: ["Street route not available"], ruleCodes: [] };
  }
  if (route.kind === "straight") {
    return {
      from, to, distanceMeters: Math.round(route.straightM), path: null, basis: "straight_line", ruleCodes: [],
      notes: ["Route not confirmed: no street route found on the map; straight-line distance shown"],
    };
  }
  return { from, to, distanceMeters: Math.round(route.lengthM), path: encodePolyline(route.coords), basis: "street_graph", notes: [], ruleCodes: route.usedRules };
}

/** A special trip at a far end (fare not fixed): from a tricycle terminal serving the zone, or (terminal null) the far-trip fallback. */
type SpecialTrip = { terminal: LocatedTerminal | null };

/** `special`: a special trip (fare not fixed). `to`: a named end (the access option's loading point). */
function tricycleLeg(
  g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, destination: LatLng, now: Date, route: StreetRoute | null,
  special: SpecialTrip | null, to?: Place,
): TricycleLeg {
  const base = streetLeg(g, origin, destination, route, to);
  const fare: TricycleFare = special ? { ...tricycleFare(snapshot.fareRules), minCentavos: null, status: "unavailable" } : tricycleFare(snapshot.fareRules);
  const notes = [
    ...base.notes,
    ...(base.basis !== "street_graph" ? [] : g!.rules.flatMap((r) => ruleNote(r, base.ruleCodes.includes(r.code), now) ?? [])),
    ...(route?.kind === "path" && route.usesNationalRoad ? ["National rules may limit tricycles on national roads; Naga has not published a tricycle route plan."] : []),
    ...(special ? ["Special trip · fare not fixed · confirm with the driver",
      special.terminal ? `From ${special.terminal.name}: local report, unconfirmed` : "Special trip by local report, unconfirmed"]
      : [fare.minCentavos === null ? "Fare not available · confirm with the driver"
        : `Minimum fare ${peso(fare.minCentavos)} (Ordinance 2024-002) · discounts not applied · confirm with the driver`]),
    "Tricycle time not estimated",
    "Tricycles serve their franchise zone; a long trip may need a change (Ord 2020-113)",
  ];
  return { ...base, kind: "tricycle", fare, notes };
}

/** `special`: a special trip at a far end (fare not fixed, never Recommended). */
function tricycleOption(
  g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, destination: LatLng, now: Date, recommended: boolean, special: SpecialTrip | null = null,
): PlanOption {
  const route = g ? routeStreet(g, origin, destination, { mode: "tricycle", now }) : null;
  const leg = tricycleLeg(g, snapshot, origin, destination, now, route, special);
  const fare = leg.fare;
  return {
    id: "tricycle", mode: "tricycle", labels: recommended ? ["Recommended"] : [], legs: [leg], rides: 0, walkMeters: 0, walkEstimateMeters: 0,
    rideMeters: 0, score: 0, fare: { minCentavos: fare.minCentavos, maxCentavos: null, status: fare.status, completeness: "estimate" }, evidence: "provisional",
  };
}

function padyakOption(g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, destination: LatLng, now: Date): PlanOption | null {
  if (!g) return null;
  const atOrigin = padyakAreas(g, origin);
  const area = padyakAreas(g, destination).find((a) => atOrigin.includes(a));
  if (area === undefined) return null;
  const route = routeStreet(g, origin, destination, { mode: "padyak", now });
  if (route.kind !== "path" || Math.round(route.lengthM) > PADYAK_MAX_M) return null;
  const fare = padyakFare(snapshot.fareRules);
  const notes = [
    fare.minCentavos === null ? "Fare not available · confirm with the driver · up to 2 passengers"
      : `${peso(fare.minCentavos)} per passenger${fare.discountedCentavos === null ? "" : ` (${peso(fare.discountedCentavos)} with ID discount)`} · city fare set Sep 2022 · confirm with the driver · up to 2 passengers`,
    "Area per city ordinance · approximate boundary · service not confirmed today",
    "Not allowed in the city centre 6 am–8 pm (Ord 93-049 Sec 132)",
    "Padyak time not estimated",
  ];
  const leg: PadyakLeg = { ...streetLeg(g, origin, destination, route), kind: "padyak", fare, notes, ruleCodes: [] };
  return {
    id: `padyak:${g.areas[area]!.code}`, mode: "padyak", labels: ["Short local ride"], legs: [leg], rides: 0, walkMeters: 0, walkEstimateMeters: 0,
    rideMeters: 0, score: 0, fare: { minCentavos: fare.minCentavos, maxCentavos: fare.maxCentavos, status: fare.status, completeness: "estimate" },
    evidence: "provisional",
  };
}

// ---------------------------------------------------------------- planTrip

const farZoneAt = (p: LatLng): FarZone | null => {
  const code = zoneOf(p, FAR_AREAS);
  return FAR_AREAS.farZones.find((z) => z.code === code) ?? null;
};

/** A published tricycle terminal serving `zone` within a SPECIAL_TRIP_TERMINAL_WALK_M walk of `origin` (×1.3 estimate without a graph). */
function specialTripTerminal(g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, zone: FarZone): LocatedTerminal | null {
  const located = locatedTerminals(snapshot.terminals);
  const walk = walker(g, origin, SPECIAL_TRIP_TERMINAL_WALK_M, SPECIAL_TRIP_TERMINAL_WALK_M);
  for (const t of FAR_AREAS.tricycleTerminals) {
    const at = located.get(t.terminalCode);
    if (at && t.serves.some((s) => "farZone" in s && s.farZone === zone.code) && walk(at)) return at;
  }
  return null;
}

/** A city-proper point where a far zone's route can be boarded, with its boarding approach on variant `v`. */
type LoadingPoint = LatLng & { name: string; v: number; board: Approach };

/**
 * The zone's loading points (far-areas `routeBoarding`): a published terminal with a coordinate and pathLinkOk, on
 * each non-inbound (Centro-to-far) variant of the route whose path passes within ROUTE_BOARDING_LINK_M (else that
 * variant is skipped); or the start of the route's `pathStart` variant. Points inside a far zone are dropped. A
 * projection that leaves less than the minimum ride before the destination approach yields no ride (rideMeters).
 */
function loadingPoints(net: PlanningNetwork, snapshot: PlannerSnapshot, zone: FarZone): LoadingPoint[] {
  const located = locatedTerminals(snapshot.terminals);
  const out: LoadingPoint[] = [];
  for (const b of FAR_AREAS.routeBoarding) {
    if (!zone.routes.includes(b.routeCode)) continue;
    net.variants.forEach((v, i) => {
      if (v.routeCode !== b.routeCode) return;
      if ("terminalCode" in b.boarding) {
        if (v.direction === "inbound") return;
        const t = b.pathLinkOk ? located.get(b.boarding.terminalCode) : undefined;
        if (!t) return;
        const pr = projectOnLine(v.points, t);
        if (pr.distM <= ROUTE_BOARDING_LINK_M) out.push({ lat: t.lat, lng: t.lng, name: t.name, v: i, board: { measureM: round1(pr.measureM), point: pr.point, distM: pr.distM } });
      } else if (v.direction === b.boarding.pathStart) {
        const p0 = v.points[0]!;
        out.push({ ...p0, name: `where ${b.routeCode} starts (route plan)`, v: i, board: { measureM: 0, point: p0, distM: 0 } });
      }
    });
  }
  return out.filter((p) => zoneOf(p, FAR_AREAS) === null);
}

/**
 * The access option (plan F, T4): tricycle from the origin to the zone's loading point with the shortest tricycle
 * street route (straight line without one), walk to the path, one ride, walk. Its ride is the best-score alight
 * of that variant (must-save-walking on the walks). Fare: the ride's minimum plus the tricycle minimum, no maximum.
 */
function accessOption(
  net: PlanningNetwork, g: WalkGraph | null, snapshot: PlannerSnapshot, origin: LatLng, destination: LatLng, now: Date,
  zone: FarZone, alights: { a: Approach; walk: Walk }[][], directM: number,
): PlanOption | null {
  let best: { lp: LoadingPoint; c: Cand; triM: number; route: StreetRoute | null } | null = null;
  for (const lp of loadingPoints(net, snapshot, zone)) {
    const v = net.variants[lp.v]!;
    const lw: Walk = lp.board.distM === 0 ? { m: 0, basis: g ? "street_graph" : "straight_x1_3" }
      : (walker(g, lp, WALK_RADIUS_M, MAX_ACCESS_WALK_GRAPH_M)(lp.board.point) ?? { m: estimate(lp, lp.board.point), basis: "straight_x1_3" });
    let c: Cand | null = null;
    for (const a of alights[lp.v] ?? []) {
      const r = rideMeters(v, lp.board.measureM, a.a.measureM);
      const walkM = lw.m + a.walk.m;
      if (r === null || walkM >= directM) continue;
      const rideM = Math.round(r);
      const k: Cand = {
        hops: [{ v: lp.v, board: lp.board, alight: a.a, rideM }], walks: [lw, a.walk], walkM, rideM, score: walkM + RIDE_WEIGHT * rideM,
        id: `${v.variantId}@${round10(lp.board.measureM)}-${round10(a.a.measureM)}`,
      };
      if (!c || compare(k, c) < 0) c = k;
    }
    if (!c) continue;
    const route = g ? routeStreet(g, origin, lp, { mode: "tricycle", now }) : null;
    const triM = route?.kind === "path" ? route.lengthM : haversineMeters(origin, lp);
    if (!best || triM < best.triM) best = { lp, c, triM, route };
  }
  // A tricycle of ACCESS_TRICYCLE_MIN_WALK_M or less is no better than walking to the loading point.
  if (!best || !accessTricycleOk(best.triM)) return null;
  const at: Place = { kind: "point", lat: best.lp.lat, lng: best.lp.lng, stopId: null, name: best.lp.name };
  const jeep = jeepneyOption(best.c, [], net, g, snapshot, best.lp, destination);
  const tri = tricycleLeg(g, snapshot, origin, best.lp, now, best.route, null, at);
  const [first, ...rest] = jeep.legs;
  const ride = jeep.fare;
  const fare: TripFare = ride.minCentavos === null || tri.fare.minCentavos === null
    ? { minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate" }
    : { minCentavos: ride.minCentavos + tri.fare.minCentavos, maxCentavos: null, status: "minimum", completeness: "estimate" };
  return { ...jeep, id: `tri>${jeep.id}`, legs: [tri, { ...first!, from: at } as WalkLeg, ...rest], fare };
}

const validPoint = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && isInsideNaga(p);

export function planTrip(
  snapshot: PlannerSnapshot,
  network: PlannerNetwork,
  origin: LatLng,
  destination: LatLng,
  { now, viaGroups = FAR_AREAS.viaGroups }: { now: Date; viaGroups?: readonly ViaGroup[] },
): TripPlan {
  const revisionId = snapshot.revision.revisionId;
  const none = (reason: NoCoverageReason, direct: number | null): TripPlan => ({
    revisionId, coverage: "none", reason, directWalkEstimateMeters: direct, jeepneyReason: null, options: [], notes: [],
  });
  if (!validPoint(origin) || !validPoint(destination)) return none("outside_city", null);
  if (haversineMeters(origin, destination) <= SAME_PLACE_M) return none("same_place", estimate(origin, destination));

  const g = network.streets;
  const directRoute = g ? routeStreet(g, origin, destination, { mode: "walk", now }) : null;
  const direct: Walk = directRoute?.kind === "path"
    ? { m: Math.round(directRoute.lengthM), basis: "street_graph" }
    : { m: estimate(origin, destination), basis: "straight_x1_3" };

  // Far zones (Increment F), once per plan: a far end lifts its walk cap, drops the point-to-point
  // tricycle (special trip excepted) and makes the best jeepney the Recommended option (ruling e).
  const originZone = farZoneAt(origin);
  const destinationZone = farZoneAt(destination);
  const farZone = destinationZone ?? originZone;
  const net = planningNetwork(snapshot, network.lines);
  const cap = (z: FarZone | null) => (z ? FAR_END_WALK_CAP_M : MAX_ACCESS_WALK_GRAPH_M);
  const jeep = search(net, g, origin, destination, direct.m, cap(originZone), cap(destinationZone), originZone !== null, destinationZone !== null);
  // Access option (review I3 ruling): destination far, origin not; W = the shortest first walk among the jeepney
  // options shown (any route, transfers included); offered when there is none or W > ACCESS_TRICYCLE_MIN_WALK_M.
  const access = destinationZone && originZone === null && accessWanted(jeep.options.map((x) => x.c.walks[0]!.m))
    ? accessOption(net, g, snapshot, origin, destination, now, destinationZone, jeep.alights, direct.m)
    : null;
  const options: PlanOption[] = [];
  const notes: string[] = [];
  const o: Place = { kind: "origin", lat: origin.lat, lng: origin.lng, stopId: null, name: null };
  const d: Place = { kind: "destination", lat: destination.lat, lng: destination.lng, stopId: null, name: null };
  const short = direct.m < WALK_CARD_MAX_M;
  const best = jeep.options[0];
  const jeepRecommended = best !== undefined && (farZone !== null || (short && best.c.hops.at(-1)!.alight.distM <= PASSES_DESTINATION_M));
  if (jeepRecommended) best.labels.unshift("Recommended");
  // A short trip with no jeepney keeps its Recommended walk, far end or not (review I2).
  else if (best === undefined && access && !short) access.labels.push("Recommended");
  const walkShown = short;
  // Far trip: a special trip from a tricycle terminal serving the zone; else, when there is no jeepney nor access
  // option, ONE special-trip tricycle card (the owner-described special trip) rather than a long walk alone.
  const terminal = farZone !== null && originZone === null ? specialTripTerminal(g, snapshot, origin, farZone) : null;
  const special: SpecialTrip | null = farZone === null ? null
    : terminal ? { terminal } : best === undefined && !access ? { terminal: null } : null;
  const padyak = padyakOption(g, snapshot, origin, destination, now);
  // Via groups: the Pareto picks plus the best one-ride candidate of each via route, within the block budget. The
  // best-score option is never trimmed; non-via extras go first (worst score first), then vias; a label on a dropped
  // option is dropped with it, never moved.
  const vias = activeVias(net, jeep.cands, viaGroups, [nearestAnchorId(origin, FAR_AREAS), nearestAnchorId(destination, FAR_AREAS)]);
  let block = jeep.options;
  if (vias.reps.size > 0) {
    const budget = Math.max(1, MAX_OPTIONS - (walkShown ? 1 : 0) - (access ? 1 : 0) - (farZone === null || special ? 1 : 0) - (padyak ? 1 : 0));
    const pool = [...jeep.options, ...[...vias.reps].filter((c) => !jeep.options.some((x) => x.c === c)).map((c) => ({ c, labels: [] as PlanLabel[] }))];
    const worstFirst = (a: (typeof pool)[number], b: (typeof pool)[number]) => compare(b.c, a.c);
    const top = pool.reduce((m, x) => (compare(x.c, m.c) < 0 ? x : m));
    const droppable = pool.filter((x) => x !== top);
    const trimOrder = [...droppable.filter((x) => !vias.reps.has(x.c)).sort(worstFirst), ...droppable.filter((x) => vias.reps.has(x.c)).sort(worstFirst)];
    const dropped = new Set(trimOrder.slice(0, Math.max(0, pool.length - budget)));
    block = pool.filter((x) => !dropped.has(x)).sort((a, b) => compare(a.c, b.c));
  }
  if (walkShown) {
    options.push({
      id: "walk", mode: "walk", labels: jeepRecommended ? [] : ["Recommended"], legs: [walkLeg(g, o, d, direct, directRoute ?? undefined)], rides: 0,
      walkMeters: direct.m, walkEstimateMeters: direct.m, rideMeters: 0, score: direct.m, fare: sumFares([]), evidence: "provisional",
    });
  } else {
    notes.push(direct.basis === "street_graph"
      ? `Walking the whole way is about ${direct.m} m along streets`
      : `Walking the whole way is about ${direct.m} m (straight-line estimate)`);
  }
  for (const { c, labels } of block) {
    const o1 = jeepneyOption(c, labels, net, g, snapshot, origin, destination);
    // Only the best candidate of a via route carries the chip (a second variant of the same route does not).
    const via = vias.reps.has(c) ? vias.byRoute.get(net.variants[c.hops[0]!.v]!.routeCode) : undefined;
    options.push(via ? { ...o1, via } : o1);
  }
  if (access) options.push(access);
  if (jeep.options.length > 0 || access) notes.unshift(UNVERIFIED_ROUTE_BADGE);
  if (farZone === null) options.push(tricycleOption(g, snapshot, origin, destination, now, !short));
  else if (special) options.push(tricycleOption(g, snapshot, origin, destination, now, false, special));
  if (padyak) options.push(padyak);

  return {
    revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: direct.m, jeepneyReason: access ? null : jeep.reason,
    options: options.slice(0, MAX_OPTIONS), notes,
    ...(farZone && { farNote: `Local report: tricycles ${destinationZone ? "to" : "from"} ${farZone.name} charge special-trip fares, so none is suggested.` }),
  };
}
