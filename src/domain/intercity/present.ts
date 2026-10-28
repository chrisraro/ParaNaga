// Presentation rules for S24 "Leaving Naga" (design §5). Pure: i18n keys + args only, computed on
// the device in Manila time so it works offline. Never sums amounts, never ranks ("cheapest"),
// never reads ai_confidence.
import { isInsideNaga } from "../geo/naga";
import type { LatLng } from "../geo/types";
import { EXPIRY_DAYS, NOT_RUNNING_STATUSES, addDays } from "../import/intercity-seed";
import { manilaDate } from "../planner/fares";

export type LineParts = { key: string; args: Record<string, string | number> };

export type PresentObservation = {
  amountCentavos: number;
  amountHighCentavos: number | null;
  seatClassText: string | null;
  destinationCode: string | null;
  basis: string;
  /** ISO date (first of the month) or YYYY-MM. */
  observedAt: string;
  sourceCodes: readonly string[];
};

export type PresentDeparture = {
  pattern: string;
  times: readonly string[];
  headwayMin: number | null;
  startTime: string | null;
  endTime: string | null;
  tripsPerDay: number | null;
  dayType: string;
  basis: string;
  observedOn: string;
};

export type PresentStatus = {
  status: string;
  statusSince: string | null;
  statusNoteCode: string | null;
  asOf: string | null;
  reviewBy: string | null;
};

export const sectionOf = (status: string): "running" | "not_running" =>
  (NOT_RUNNING_STATUSES as readonly string[]).includes(status) ? "not_running" : "running";

const ORDER = ["operating", "operating_limited", "unconfirmed", "community_mapped", "suspended", "discontinued_reported"];
const rank = (s: string) => (ORDER.includes(s) ? ORDER.indexOf(s) : ORDER.length);

/** Operating → limited → unconfirmed → community_mapped (then not running); ties by code. New array. */
export function sortServices<T extends { code: string; status: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => rank(a.status) - rank(b.status) || a.code.localeCompare(b.code));
}

/** Today (Manila) is past `reviewBy`. No review date (community_mapped) is never stale. */
export const isStale = (reviewBy: string | null, today: string = manilaDate(new Date())): boolean =>
  reviewBy !== null && today > reviewBy;

const day = (iso: string) => (iso.length === 7 ? `${iso}-01` : iso.slice(0, 10));
const month = (iso: string) => iso.slice(0, 7);

/**
 * Booking-site amounts are hidden once the service is stale or the listing is over 120 days old;
 * travel-guide listings are kept and marked old. Order is kept; nothing is merged.
 */
export function visibleObservations<O extends PresentObservation>(
  obs: readonly O[],
  svc: { reviewBy: string | null },
  today: string = manilaDate(new Date()),
): (O & { old: boolean })[] {
  return obs
    .filter((o) => o.basis !== "booking_site"
      || (!isStale(svc.reviewBy, today) && addDays(day(o.observedAt), EXPIRY_DAYS.booking_site) >= today))
    .map((o) => ({ ...o, old: o.basis === "travel_guide" }));
}

/** "Get to {terminal}" target: only a terminal with a coordinate inside the city (AC-IC1). */
export function getToTarget(
  terminal: { name: string; lat: number | null; lng: number | null } | null,
): { point: LatLng; label: string } | null {
  if (terminal === null || terminal.lat === null || terminal.lng === null) return null;
  const point = { lat: terminal.lat, lng: terminal.lng };
  return isInsideNaga(point) ? { point, label: terminal.name } : null;
}

/** Chips from reviewer-assigned evidence types and the number of distinct sources. */
export function evidenceChips(types: readonly (string | null)[], count: number): ("low" | "old" | "single_source")[] {
  const chips: ("low" | "old" | "single_source")[] = [];
  if (!types.some((t) => t === "official" || t === "news")) chips.push("low");
  if (types.includes("travel_guide")) chips.push("old");
  if (count === 1) chips.push("single_source");
  return chips;
}

const peso = (c: number) =>
  `₱${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const hm = (t: string) => t.slice(0, 5);
const compact = (args: Record<string, string | number | null>) =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null)) as Record<string, string | number>;

/** One observed amount (or a range) with its basis and month; `null` → "Fare not found". */
export function fareLineParts(o: PresentObservation | null): LineParts {
  if (o === null) return { key: "intercity.fare.not_found", args: {} };
  const amount = o.amountHighCentavos === null || o.amountHighCentavos === o.amountCentavos
    ? peso(o.amountCentavos)
    : `${peso(o.amountCentavos)}–${peso(o.amountHighCentavos)}`;
  return { key: `intercity.fare.${o.basis}`, args: compact({ amount, seatClass: o.seatClassText, month: month(o.observedAt) }) };
}

/** One departure fact by pattern, with its basis and month; `null` → "Departure times not found". */
export function departureLineParts(d: PresentDeparture | null): LineParts {
  if (d === null) return { key: "intercity.departure.not_found", args: {} };
  return {
    key: `intercity.departure.${d.pattern}`,
    args: compact({
      times: d.times.length > 0 ? d.times.map(hm).join(", ") : null,
      minutes: d.headwayMin,
      start: d.startTime && hm(d.startTime),
      end: d.endTime && hm(d.endTime),
      tripsPerDay: d.tripsPerDay,
      basis: d.basis,
      month: month(d.observedOn),
    }),
  };
}

/** Status pill with since / as-of dates and the note key; `stale` drives the amber "may be out of date". */
export function statusPillParts(s: PresentStatus, today: string = manilaDate(new Date())): LineParts & { stale: boolean } {
  return {
    key: `intercity.status.${s.status}`,
    args: compact({
      since: s.statusSince,
      asOf: s.asOf,
      note: s.statusNoteCode && `intercity.statusNote.${s.statusNoteCode}`,
    }),
    stale: isStale(s.reviewBy, today),
  };
}
