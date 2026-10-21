// A plan option's notes as data for the trip screens (plan E §E). Pure.
//
// Ride legs carry their route notes as text (planner/notes.ts); the snapshot's routes[].notes say
// where each came from. A note is matched to its reviewed record by route code and text, so its
// evidence and sources travel with it. Owner reports are flagged `unverified` and labelled so, never
// shown as fact; a note whose record is not on this phone is treated as unverified too, except the
// planner's own flagged-path caveat. The jeepney service-window hint rides along (service-window.ts).
import type { PlanLegDto } from "../api/plan";
import type { RouteNote } from "../api/schemas";
import { optionServiceWindowNote, type ServiceWindowNote } from "../eta/service-window";
import { FLAGGED_PATH_NOTE } from "../planner/notes";
import { en, type Dict } from "@/i18n/dict";

export const EVIDENCE_LABEL: Readonly<Record<RouteNote["evidence"], string>> = en.trip.evidence;

export type RideNoteView = {
  text: string;
  /** Null when the note's reviewed record is not known here (or it is the flagged-path caveat). */
  evidence: RouteNote["evidence"] | null;
  evidenceLabel: string | null;
  sourceCodes: string[];
  /** Show as a report, not a fact. */
  unverified: boolean;
};

export type OptionNotesView = {
  serviceWindow: ServiceWindowNote | null;
  /** Rides with at least one note, in trip order. */
  rides: { legIndex: number; routeCode: string; notes: RideNoteView[] }[];
};

type RouteNotes = { routeCode: string; notes: readonly RouteNote[] };

export function noteView(text: string, records: readonly RouteNote[], copy: Dict["trip"] = en.trip): RideNoteView {
  const r = records.find((n) => n.text === text);
  if (!r) return { text, evidence: null, evidenceLabel: null, sourceCodes: [], unverified: text !== FLAGGED_PATH_NOTE };
  return { text, evidence: r.evidence, evidenceLabel: copy.evidence[r.evidence], sourceCodes: [...r.sourceCodes], unverified: r.evidence === "owner_report_unverified" };
}

export function optionNotesView(option: { legs: readonly PlanLegDto[] }, routes: readonly RouteNotes[] | null | undefined, now: Date, copy: Pick<Dict, "trip" | "eta"> = en): OptionNotesView {
  const rides = option.legs.flatMap((leg, legIndex) => {
    const texts: readonly string[] = leg.kind === "ride" ? (leg.notes ?? []) : []; // bodies from before Increment E have no notes
    if (leg.kind !== "ride" || texts.length === 0) return [];
    const records = routes?.find((r) => r.routeCode === leg.routeCode)?.notes ?? [];
    return [{ legIndex, routeCode: leg.routeCode, notes: texts.map((t) => noteView(t, records, copy.trip)) }];
  });
  return { serviceWindow: optionServiceWindowNote(option, now, copy.eta), rides };
}
