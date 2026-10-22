// Copy and formatting for the Stop detail and Route detail screens. Pure.
//
// Honesty: a missing value reads as unknown ("Not yet surveyed", "Unknown", "Not observed"),
// never as zero or a placeholder; fares are estimate ranges from the reported fare rules, never
// an exact fare; source values (codes, labels, coordinates) are shown verbatim.
import type { FareRuleEstimate, StopDetail } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";
import { en, type Dict } from "@/i18n/dict";
import { DEFAULT_LOCALE, formatLocale, type Locale } from "@/i18n/locales";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-15" → "15 Oct 2026" (calendar date, no time zone shift); null for anything else. */
export function formatIsoDate(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${day} ${month} ${m[1]}`;
}

/** A revision's published timestamp as a Naga City calendar date ("Oct 15, 2026"); null if unknown. */
export function publishedDateText(publishedAt: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(formatLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });
}

/** The newest retrieved date among the stop's source records (ISO dates sort as text). */
export function latestRetrievedOn(records: readonly { retrievedOn: string | null }[]): string | null {
  return records.reduce<string | null>((best, r) => (r.retrievedOn && (!best || r.retrievedOn > best) ? r.retrievedOn : best), null);
}

/** The stop-screen warning's source sentence, dated from the data. */
export function snapshotSourceText(retrievedOn: string | null, copy: Dict["stops"] = en.stops): string {
  const date = formatIsoDate(retrievedOn);
  return copy.snapshotSource(date ?? copy.dateNotRecorded);
}

/**
 * "lat, lng" exactly as the source wrote them: taken from the verbatim "lng,lat[,alt]" text so
 * trailing digits are never rounded or dropped. Falls back to the numbers if the text is odd.
 */
export function sourceCoordinatesText(record: { coordinatesRaw: string; lat: number; lng: number }): string {
  const parts = record.coordinatesRaw.split(",").map((p) => p.trim());
  const number = /^[-+]?\d+(?:\.\d+)?$/;
  if (parts.length >= 2 && number.test(parts[0]!) && number.test(parts[1]!)) return `${parts[1]}, ${parts[0]}`;
  return `${record.lat}, ${record.lng}`;
}

/** Badge for a stop: candidates are always "Mapped candidate"; nothing here says verified. */
export function stopStatusBadge(status: string, copy: Dict["stops"] = en.stops): string {
  return status !== "other" && Object.hasOwn(copy.status, status) ? copy.status[status as keyof typeof copy.status] : copy.status.other;
}

/** Other source layers listing the same point, e.g. ["Loop Service C"] (distinct, in order). */
export function sharedLayers(shared: StopDetail["sharedCoordinate"]): string[] {
  return [...new Set(shared.map((s) => s.source.layer).filter((l): l is string => l !== null))];
}

// ---------------------------------------------------------------- routes

/** "jeepney" for PUJ modes; otherwise null (unknown mode wording is not invented). */
export function modeLabel(modeCode: string | null, copy: Dict["routes"] = en.routes): string | null {
  return modeCode !== null && /^PUJ(_|$)/i.test(modeCode) ? copy.modeJeepney : null;
}

/** "Group 5 · jeepney", "Group 8", "jeepney" or null. */
export function routeGroupText(groupNumber: number | null, modeCode: string | null, copy: Dict["routes"] = en.routes): string | null {
  const parts = [groupNumber === null ? null : copy.group(groupNumber), modeLabel(modeCode, copy)].filter(Boolean);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Vehicle tile from a mode code such as "PUJ_Class_2_plan": value "Class 2", note "Plan only". */
export function vehicleTile(modeCode: string | null, copy: Dict["routes"] = en.routes): { value: string; note: string } {
  const m = modeCode ? /Class_(\d+)(_plan)?/i.exec(modeCode) : null;
  if (!m) return { value: copy.unknown, note: copy.notObserved };
  return { value: copy.vehicleClass(m[1]!), note: m[2] ? copy.planOnly : copy.notObserved };
}

export type FareTile = { value: string; note: string; detail: string | null };

/**
 * Fare tile: the range of reported minimum (base) fares among the rules that apply to the
 * route's mode, labelled "Estimate"; "Unknown" when there is none. Never an exact fare.
 */
export function routeFareTile(rules: readonly Pick<FareRuleEstimate, "baseCentavos">[], copy: Dict["routes"] = en.routes): FareTile {
  const bases = rules.map((r) => r.baseCentavos).filter((c): c is number => c !== null && c > 0);
  if (bases.length === 0) return { value: copy.unknown, note: copy.noFareRule, detail: null };
  const lo = Math.floor(Math.min(...bases) / 100);
  const hi = Math.ceil(Math.max(...bases) / 100);
  return {
    value: lo === hi ? `₱${lo}` : `₱${lo}–₱${hi}`,
    note: copy.estimate,
    detail: copy.fareDetail,
  };
}

/** Direction toggle labels from a name like "Centro–San Felipe (via …)". */
export function directionLabels(routeName: string, copy: Dict["routes"] = en.routes): { inbound: string; outbound: string } {
  const m = /^Centro[–-](.+?)(?:\s+via\s+.+)?$/.exec(routeName);
  return m ? { inbound: copy.towardCentro, outbound: copy.toward(m[1]!) } : { inbound: copy.inbound, outbound: copy.outbound };
}

/** Note under each street of a street-order list. */
export function streetNote(index: number, count: number, circuit: boolean, copy: Dict["routes"] = en.routes): string {
  if (index === 0) return circuit ? copy.streetStartCircuit : copy.streetStart;
  if (index === count - 1) return circuit ? copy.streetEndCircuit : copy.streetEnd;
  return copy.streetOnPlan;
}

/** "33 units allocated (not jeepneys running)." or the group form. */
export function allocationText(
  route: {
    allocatedUnits: number | null;
    groupAllocatedUnits: number | null;
    groupNumber: number | null;
    allocationIsActiveFleetCount: boolean | null;
  },
  copy: Dict["routes"] = en.routes,
): string {
  const caveat = route.allocationIsActiveFleetCount === true ? "" : copy.notRunning;
  if (route.allocatedUnits !== null) return copy.unitsAllocated(route.allocatedUnits, caveat);
  if (route.groupAllocatedUnits !== null) {
    const group = route.groupNumber === null ? copy.itsGroup : copy.groupLower(route.groupNumber);
    return copy.unitsToGroup(route.groupAllocatedUnits, group, caveat);
  }
  return copy.unitsUnknown;
}

/** "Sources S01, S02 · revision provisional-loops-2026-10-15." */
export function sourcesLine(codes: readonly string[], revisionLabel: string, copy: Dict["routes"] = en.routes): string {
  return codes.length === 0 ? copy.sourcesNone(revisionLabel) : copy.sourcesListed(codes.join(", "), revisionLabel);
}

/** Trial notice: what was adopted, from which source, and that permanence is not confirmed. */
export function trialNoticeText(
  trial: { effectiveFrom: string | null; trialDurationDays: number | null; trialStatus: string | null; sourceCodes: readonly string[] },
  sources: readonly { code: string; title: string }[],
  copy: Dict["routes"] = en.routes,
): string {
  const titles = trial.sourceCodes.map((c) => {
    const s = sources.find((x) => x.code === c);
    return s ? `${s.title} (${c})` : c;
  });
  const from = formatIsoDate(trial.effectiveFrom);
  const when = from ? copy.trialAdopted(from, trial.trialDurationDays) : copy.trialDateUnknown;
  const status = trial.trialStatus === "permanence_unconfirmed" || trial.trialStatus === null ? copy.trialUnconfirmed : trial.trialStatus.replaceAll("_", " ");
  return copy.trialNotice(titles.join(", "), when, status);
}

// ---------------------------------------------------------------- nearby list (map alternative)

/**
 * Groups pins that share exactly the same coordinates (the same source point imported in two
 * layers, e.g. Loop A's A1 and Loop C's A1), then returns the `limit` groups nearest to `center`,
 * nearest first; ties and the order inside a group keep input order. The first pin of a group is
 * one a provisional route lists (`routeCodes` non-empty) when there is one, like a map tap.
 */
export function nearestStopGroups<T extends LatLng & { routeCodes?: readonly string[] }>(
  stops: readonly T[],
  center: LatLng,
  limit: number,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const stop of stops) {
    const key = `${stop.lat},${stop.lng}`;
    const group = groups.get(key);
    if (group) group.push(stop);
    else groups.set(key, [stop]);
  }
  const ordered = [...groups.values()].map((g) => {
    const i = g.findIndex((s) => (s.routeCodes?.length ?? 0) > 0);
    return i > 0 ? [g[i]!, ...g.slice(0, i), ...g.slice(i + 1)] : g;
  });
  return nearestStops(
    ordered.map((g) => ({ lat: g[0]!.lat, lng: g[0]!.lng, g })),
    center,
    limit,
  ).map((x) => x.g);
}

/** The `limit` stops nearest to `center` (straight line), nearest first; ties keep input order. */
export function nearestStops<T extends LatLng>(stops: readonly T[], center: LatLng, limit: number): T[] {
  return stops
    .map((stop, i) => ({ stop, i, d: haversineMeters(center, stop) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map((x) => x.stop);
}
