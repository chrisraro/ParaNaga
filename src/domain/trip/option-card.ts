// View helpers for the trip option cards (plan E, "UI changes"). Pure: no I/O, no React.
//
// One card per mode: Walk, Jeep (any-point board and alight), Tricycle, Padyak. A tricycle or padyak
// card never shows minutes; a tricycle with no street route says "Route not confirmed" and draws its
// straight line only as "approximate, not a route".
import type { PadyakLegDto, PlanOptionDto, PlanResponse, TricycleLegDto } from "../api/plan";
import type { ServiceWindowNote } from "../eta/service-window";
import { FLAGGED_PATH_NOTE } from "../planner/notes";
import { fareChipText, formatDistance, routeChipLabel } from "./present";
import type { OptionNotesView, RideNoteView } from "./option-notes";

/** The first Recommended option, or -1: exactly one card is drawn as the primary one. */
export function recommendedIndex(options: readonly Pick<PlanOptionDto, "labels">[]): number {
  return options.findIndex((o) => o.labels.includes("Recommended"));
}

export function optionHeadline(option: PlanOptionDto): string {
  switch (option.mode) {
    case "walk":
      return `Walk ${formatDistance(option.walkEstimateMeters)}`;
    case "tricycle":
      return "Tricycle";
    case "padyak":
      return "Padyak";
    default:
      return `Jeep ${option.legs.flatMap((l) => (l.kind === "ride" ? [routeChipLabel(l.routeCode, l.routeName)] : [])).join(" + ")}`;
  }
}

const JEEPNEY_REASON: Record<NonNullable<PlanResponse["plan"]["jeepneyReason"]>, string> = {
  no_path_near_origin: "No jeepney route passes near your start",
  no_path_near_destination: "No jeepney route passes near your destination",
  walk_shorter: "Walking is shorter than any jeepney ride",
  no_route: "No jeepney route connects these places",
};

/** The one line above the tricycle card when the plan has no jeepney option. */
export function jeepneyReasonText(reason: PlanResponse["plan"]["jeepneyReason"]): string | null {
  return reason === null ? null : JEEPNEY_REASON[reason];
}

export const TIME_NOT_ESTIMATED = "Time not estimated";

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
};

const RESTRICTION = /^(Avoids the restricted roads|Uses roads tricycles may use only)/;
const AREA = /^Area per city ordinance/;

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
