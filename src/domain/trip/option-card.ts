// View helpers for the trip option cards (plan E, "UI changes"). Pure: no I/O, no React.
//
// One card per mode: Walk, Jeep (any-point board and alight), Tricycle, Padyak. A tricycle or padyak
// card never shows minutes; a tricycle with no street route says "Route not confirmed" and draws its
// straight line only as "approximate, not a route".
import type { PadyakLegDto, PlanOptionDto, PlanResponse, RideLegDto, TricycleLegDto } from "../api/plan";
import type { ServiceWindowNote } from "../eta/service-window";
import { FLAGGED_PATH_NOTE } from "../planner/notes";
import { fareChipText, formatDistance } from "./present";
import type { OptionNotesView, RideNoteView } from "./option-notes";
import { getRoadsideAdvice, type RoadsideInfo } from "../planner/roadside";

/** The first Recommended option, or -1: exactly one card is drawn as the primary one. */
export function recommendedIndex(options: readonly Pick<PlanOptionDto, "labels">[]): number {
  return options.findIndex((o) => o.labels.includes("Recommended"));
}

/**
 * The option drawn as the map preview: the Recommended one; with none Recommended (a far trip without a jeepney),
 * the first non-walk option, else none (-1). Never a long unlabelled walk.
 */
export function previewIndex(options: readonly Pick<PlanOptionDto, "labels" | "mode">[]): number {
  const r = recommendedIndex(options);
  return r >= 0 ? r : options.findIndex((o) => o.mode !== "walk");
}

/** The peek line when nothing is Recommended: how many options there are, never "Best option". */
export const optionsCountText = (n: number) => `${n} ${n === 1 ? "option" : "options"}`;

const JEEPNEY_REASON: Record<NonNullable<PlanResponse["plan"]["jeepneyReason"]>, string> = {
  no_path_near_origin: "No jeepney route passes near your start",
  no_path_near_destination: "No jeepney route passes near your destination",
  walk_shorter: "Walking is shorter than any jeepney ride",
  no_route: "No jeepney route connects these places",
  roundabout: "Jeepney routes here go the long way around",
  centro: "In the city centre, a tricycle takes you there directly",
};

/** The one line above the tricycle card when the plan has no jeepney option. */
export function jeepneyReasonText(reason: PlanResponse["plan"]["jeepneyReason"]): string | null {
  return reason === null ? null : JEEPNEY_REASON[reason];
}

export const TIME_NOT_ESTIMATED = "Time not estimated";

/** Increment F. The access option rides a jeepney after a tricycle to its loading point: legs [tricycle, walk, ride, walk]. */
export const isAccessOption = (o: Pick<PlanOptionDto, "rides" | "legs">) => o.rides > 0 && o.legs[0]?.kind === "tricycle";

/** A tricycle into (or out of) a far zone, flagged by the planner (fare not fixed). */
export const isSpecialTrip = (o: { specialTrip?: true }) => o.specialTrip === true;

export const FARE_NOT_FIXED = "Fare not fixed";
/** The access card says what the tricycle is for; the title already says tricycle, then the route. */
export const ACCESS_LINE = "For when you'd rather not walk.";
const peso = (centavos: number) => `₱${Math.round(centavos / 100)}`;

/** "via Magsaysay" (the chip of a jeepney that shares a corridor with other vias), or null. */
export function viaChipText(o: Pick<PlanOptionDto, "via"> & { legs?: readonly { kind: string; display?: { title: string } | null }[] }): string | null {
  if (!o.via) return null;
  // The title already names the street ("… via Magsaysay Ave", "… via Roxas Ave (Diversion)"): the chip would say it twice.
  const label = o.via.label.replace(/\s*\(.*\)/, "").toLowerCase();
  return o.legs?.some((l) => l.kind === "ride" && l.display?.title.toLowerCase().includes(label)) ? null : `via ${o.via.label}`;
}

/**
 * Roadside advice for a jeepney option: tells commuters which side of a two-way street to board on
 * (e.g. Westbound side to Centro vs Eastbound side to Diversion), or null.
 */
export function optionRoadside(o: Pick<PlanOptionDto, "legs" | "rides" | "via">): RoadsideInfo | null {
  if (isAccessOption(o) || o.rides !== 1 || o.via !== undefined) return null;
  const ride = o.legs?.find((l): l is RideLegDto => l.kind === "ride");
  if (!ride || !ride.routeCode) return null;
  return getRoadsideAdvice(ride.routeCode, ride.board, ride.alight);
}

type PlanTerminals = { tricycleTerminals?: PlanOptionDto["tricycleTerminals"] };

/** The detail lines for the published tricycle terminals near each end: "Tricycle terminal: X, about 60 m from your start", and "TODA: …" only when names are on file. */
export function tricycleTerminalLines(o: PlanTerminals): { key: string; text: string; toda: string | null }[] {
  return (o.tricycleTerminals ?? []).map((t) => ({
    key: `${t.side}-${t.code}`,
    text: `Tricycle terminal: ${t.name}, about ${Math.max(10, Math.round(t.distanceM / 10) * 10)} m from your ${t.side === "origin" ? "start" : "destination"}`,
    toda: t.todas.length > 0 ? `TODA: ${t.todas.join(", ")}` : null,
  }));
}

/** The card forms: "Terminal: X, Y" and "TODA: …" (null when there is nothing to say). */
export function tricycleTerminalCardLines(o: PlanTerminals): { terminal: string | null; toda: string | null } {
  const ts = o.tricycleTerminals ?? [];
  const todas = ts.flatMap((t) => t.todas);
  return { terminal: ts.length > 0 ? `Terminal: ${[...new Set(ts.map((t) => t.name))].join(", ")}` : null, toda: todas.length > 0 ? `TODA: ${[...new Set(todas)].join(", ")}` : null };
}

/**
 * The fare chip of an access or special-trip option: "From ₱29" (ride minimum + the ₱15 tricycle minimum; there is no
 * maximum, so never a range) or "Fare not fixed"; null for every other option (their own text applies).
 */
export function specialFareText(o: Pick<PlanOptionDto, "specialTrip" | "rides" | "legs" | "fare">): string | null {
  if (isSpecialTrip(o)) return FARE_NOT_FIXED;
  if (isAccessOption(o) && o.fare.status === "minimum" && o.fare.minCentavos !== null) return `From ${peso(o.fare.minCentavos)}`;
  return null;
}

/** The tricycle part of an access card: "Tricycle min ₱15 · confirm with the driver". Never minutes. */
export function accessTricycleChip(o: Pick<PlanOptionDto, "legs">): string {
  const leg = o.legs.find((l): l is TricycleLegDto => l.kind === "tricycle");
  return leg && leg.fare.minCentavos !== null ? `Tricycle min ${peso(leg.fare.minCentavos)} · confirm with the driver` : "Tricycle fare not available · confirm with the driver";
}

const FAR_NOTE_PREFIX = /^Local report:\s*/;
export const FAR_NOTE_SPECIAL = "A special-trip tricycle is listed only if you still want one.";
/**
 * The far note as shown: its evidence label ("Local report") and the sentence, with a line added when a special-trip
 * card is listed, so the note never contradicts a card.
 */
export function farNoteView(note: string | null, options: readonly Pick<PlanOptionDto, "specialTrip" | "rides" | "legs">[] = []): { label: string | null; text: string } | null {
  if (!note) return null;
  const extra = options.some(isSpecialTrip) ? [FAR_NOTE_SPECIAL] : []; // the access card already says it goes to the jeepney
  const rest = note.replace(FAR_NOTE_PREFIX, "");
  const base = FAR_NOTE_PREFIX.test(note) ? rest.charAt(0).toUpperCase() + rest.slice(1) : note;
  return { label: FAR_NOTE_PREFIX.test(note) ? "Local report" : null, text: [base, ...extra].join(" ") };
}

export type StreetCardView = {
  state: "route" | "not_confirmed" | "unavailable";
  /** "Route not confirmed" / "Street route not available"; null for a routed leg. */
  headline: string | null;
  distanceText: string | null;
  fareText: string;
  timeText: typeof TIME_NOT_ESTIMATED;
  /** Tricycle: "Avoids the restricted roads we could locate (…)" or "Uses roads tricycles may use only …". */
  restrictionNote: string | null;
  /** Padyak: "Area per city ordinance · approximate boundary · service not confirmed today". */
  areaNote: string | null;
  /** A special trip (far zone): "Special trip · fare not fixed" and the terminal line, which replace the fare note (the detail keeps "confirm with the driver"). */
  specialNotes: string[];
};

const RESTRICTION = /^(Avoids the restricted roads|Uses roads tricycles may use only)/;
const AREA = /^Area per city ordinance/;
const SPECIAL_LINES = /^(Special trip|From .*: local report, unconfirmed)/;

export function streetCardView(leg: TricycleLegDto | PadyakLegDto): StreetCardView {
  const d = leg.distanceMeters;
  const state = leg.basis === "street_graph" ? "route" : leg.basis === "straight_line" ? "not_confirmed" : "unavailable";
  return {
    state,
    headline: state === "not_confirmed" ? "Route not confirmed" : state === "unavailable" ? "Street route not available" : null,
    distanceText: d === null ? null : state === "route" ? `${formatDistance(d)} along streets` : `${formatDistance(d)} straight line · approximate, not a route`,
    fareText: fareChipText(leg.fare),
    timeText: TIME_NOT_ESTIMATED,
    restrictionNote: leg.notes.find((n) => RESTRICTION.test(n)) ?? null,
    areaNote: leg.notes.find((n) => AREA.test(n)) ?? null,
    specialNotes: leg.notes.filter((n) => SPECIAL_LINES.test(n)).map((n) => n.replace(/ · confirm with the driver$/, "")),
  };
}

/** One short, soft line for a jeepney card; the full warning is in the option detail. */
export function serviceWindowCardLine(note: ServiceWindowNote): string {
  return note.state === "last_trips" ? note.lines[0]! : "Outside the usual hours (about 5 am–9 pm) · unconfirmed";
}

/** At most one note per ride on a card: the first real route note (the long flagged-path caveat stays in the detail). */
export function cardRouteNotes(view: OptionNotesView): RideNoteView[] {
  return view.rides.flatMap((r) => r.notes.find((n) => n.text !== FLAGGED_PATH_NOTE) ?? []);
}
