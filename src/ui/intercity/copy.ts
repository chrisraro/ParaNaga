// Text for the i18n keys returned by src/domain/intercity/present.ts (intercity.fare.{basis},
// intercity.departure.{pattern}, intercity.status.{status}, intercity.statusNote.{code}, plus the
// *.not_found keys), in the current language. Pure: the dictionary is passed in. Dates are
// "10 Nov 2025" and months "Sep 2026" with the language's month names; times stay HH:MM (24-hour).
import type { LineParts } from "@/domain/intercity/present";
import type { Dict } from "@/i18n/dict";

type Copy = Dict["intercity"];

const monthNames = (t: Copy) => t.months.split(" ");

/** "2026-09" or "2026-09-01" → "Sep 2026"; anything else is returned as it is. */
export function monthText(iso: string, t: Copy): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  const name = m ? monthNames(t)[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : iso;
}

/** "2025-11-10" → "10 Nov 2025"; anything else is returned as it is. */
export function dateText(iso: string, t: Copy): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const name = m ? monthNames(t)[Number(m[2]) - 1] : undefined;
  return m && name ? `${Number(m[3])} ${name} ${m[1]}` : iso;
}

const str = (v: string | number | undefined) => (v === undefined ? "" : String(v));
const has = <K extends string>(obj: Record<K, unknown>, key: string): key is K => Object.hasOwn(obj, key);

/** The basis label ("terminal rule", "booking site, not verified"); unknown bases stay as they are. */
export function basisText(basis: string, t: Copy): string {
  return has(t.basis, basis) ? t.basis[basis] : basis.replace(/_/g, " ");
}

/** A fare line (fareLineParts) as text. */
export function fareText(parts: LineParts, t: Copy): string {
  const basis = parts.key.slice("intercity.fare.".length);
  if (basis === "not_found" || !has(t.fare, basis)) return t.fare.not_found;
  const fn = t.fare[basis];
  if (typeof fn === "string") return fn;
  return fn(str(parts.args.amount), str(parts.args.seatClass), monthText(str(parts.args.month), t));
}

/** A departure line (departureLineParts) as text. */
export function departureText(parts: LineParts, t: Copy): string {
  const pattern = parts.key.slice("intercity.departure.".length);
  const a = parts.args;
  const basis = basisText(str(a.basis), t);
  const month = monthText(str(a.month), t);
  switch (pattern) {
    case "listed_times":
      return t.departure.listed_times(str(a.times), basis, month);
    case "headway_rule":
      return t.departure.headway_rule(str(a.minutes), basis, month);
    case "when_full":
      return t.departure.when_full(basis, month);
    case "operating_hours":
      return t.departure.operating_hours(str(a.start), str(a.end), str(a.tripsPerDay), basis, month);
    case "daily_unspecified":
      return t.departure.daily_unspecified(str(a.tripsPerDay), str(a.times), basis, month);
    default:
      return t.departure.not_found;
  }
}

/** The status label of a pill (statusPillParts): "Suspended since 10 Nov 2025", "Running", … */
export function statusLabel(parts: LineParts, t: Copy): string {
  const status = parts.key.slice("intercity.status.".length);
  const since = str(parts.args.since);
  switch (status) {
    case "suspended":
      return since ? t.status.suspended(dateText(since, t)) : t.notRunning;
    case "discontinued_reported":
      return since ? t.status.discontinued_reported(monthText(since, t)) : t.notRunning;
    case "operating":
    case "operating_limited":
    case "unconfirmed":
    case "community_mapped":
      return t.status[status];
    default:
      return status.replace(/_/g, " ");
  }
}

/** The status note ("bridge damage · no reopening date"), or null. */
export function statusNoteText(parts: LineParts, t: Copy): string | null {
  const key = str(parts.args.note).slice("intercity.statusNote.".length);
  return key && has(t.statusNote, key) ? t.statusNote[key] : null;
}
