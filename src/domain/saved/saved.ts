// Saved trips, saved places and trip history (Increment A, Task 8; decision D3: device-local only,
// never sent to a server). Pure: the record schemas every IndexedDB read goes through, the
// self-contained saved-trip card, its revalidation against a newer published revision, the
// re-plan decision when a saved trip is reopened, and the copy (meta line, share text, history).
//
// Honesty:
//  - a saved trip keeps the revision it was planned on; it is never shown as current after the
//    network changed: reopening re-plans and says so (resolveReopen), the Saved screen badges
//    "Changed since saved" (revalidateSavedTrip);
//  - shared text names places and stops only, never coordinates or links, unless the user asks
//    for the exact points;
//  - history keeps labels and a date only, never coordinates.
import { z } from "zod";
import { planOptionSchema, planResponseSchema, toWireOption, type PlanOptionDto, type PlanResponse, type RideLegDto } from "../api/plan";
import type { NetworkSnapshot } from "../api/schemas";
import type { LatLng } from "../geo/types";
import { formatIsoDate } from "../network/present";
import { UNVERIFIED_ROUTE_BADGE } from "../planner/labels";
import { rideEnds } from "../trip/ride-ends";
import { directionText, fareChipText, formatDistance, freeAlightText, isNegligibleWalk, legFareText, routeChipLabel, stopLabel, streetRideText } from "../trip/present";
import type { EtaModel } from "../api/schemas";
import { estimateOption } from "../eta/eta";
import { TIME_NOT_AVAILABLE, formatTotal } from "../eta/format";

/** Saved-place names: at most 40 characters, counted in code points (an emoji is one). */
export const PLACE_LABEL_MAX = 40;
export const HISTORY_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- schemas

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const pointSchema = z.object({ lat: latitude, lng: longitude });
const isoDateTime = z.iso.datetime({ offset: true });
const recordId = z.string().min(1).max(100);
const endLabel = z.string().min(1).max(200);

/** Length in code points, never splitting a surrogate pair (the one measure for labels). */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** The first `max` code points of `text`. */
export function takeCodePoints(text: string, max: number): string {
  return [...text].slice(0, max).join("");
}

/** "google": a picked Google suggestion (Task 15): third-party, never verified. */
export const SAVED_PLACE_SOURCES = ["osm", "pin", "pinned", "google"] as const;
export type SavedPlaceSource = (typeof SAVED_PLACE_SOURCES)[number];

/** A trip end as saved: its label, point and, when known, what kind of place it is. */
export const savedEndSchema = z.object({ label: endLabel, point: pointSchema, place: z.enum(SAVED_PLACE_SOURCES).optional() });
export type SavedEnd = z.infer<typeof savedEndSchema>;

/** A saved trip: self-contained (works with no network and no tiles); coordinates stay on the device. */
export const savedTripSchema = z.object({
  id: recordId,
  savedAt: isoDateTime,
  revisionId: z.uuid(),
  revisionLabel: z.string(),
  revisionKind: z.enum(["provisional", "verified"]),
  publishedAt: isoDateTime.nullable(),
  start: savedEndSchema,
  destination: savedEndSchema,
  option: planOptionSchema,
  /** The stops the option names, with their source codes (as planned). */
  stops: planResponseSchema.shape.stops,
  /** The variants the option rides, with their loop direction (as planned). */
  variants: planResponseSchema.shape.variants,
});
export type SavedTrip = Omit<z.infer<typeof savedTripSchema>, "option"> & { option: PlanOptionDto };

export const savedPlaceSchema = z.object({
  id: recordId,
  label: z.string().refine((l) => codePointLength(l) >= 1 && codePointLength(l) <= PLACE_LABEL_MAX),
  point: pointSchema,
  source: z.enum(SAVED_PLACE_SOURCES),
  savedAt: isoDateTime,
});
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

/** One trip in the history: labels and a date only (unknown keys such as coordinates are dropped). */
export const historyEntrySchema = z.object({ id: recordId, from: endLabel, to: endLabel, at: isoDateTime });
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** The last published revision this device saw (written whenever the head is read). */
export const snapshotMetaSchema = z.object({ revisionId: z.uuid(), publishedAt: isoDateTime.nullable() });
export type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false } };

/**
 * Format version of every stored record (`v`, written by the device store). A record of a newer
 * format (another tab running a newer build) is skipped and kept, never rewritten or deleted;
 * an older one is migrated on read before validation.
 */
export const RECORD_FORMAT = 2;

export type Decoded<T> = { ok: true; record: T } | { ok: false; reason: "newer_format" | "invalid" };

/**
 * Migrations of older record formats, by the format they upgrade from. 1 → 2 (Increment E): the
 * new plan fields (leg path/basis, ride board/alight, notes, option mode) all have schema
 * defaults, so a format-1 record is already valid and only its version changes.
 */
const MIGRATE_FROM: Record<number, (value: Record<string, unknown>) => Record<string, unknown>> = {
  1: (value) => value,
};

/** A stored value → a validated record; records without `v` are format 1 (Increment A). */
export function decodeStored<T>(value: unknown, schema: Schema<T>): Decoded<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "invalid" };
  let record = value as Record<string, unknown>;
  let v = typeof record.v === "number" && Number.isInteger(record.v) ? record.v : 1;
  if (v > RECORD_FORMAT) return { ok: false, reason: "newer_format" };
  while (v < RECORD_FORMAT) {
    const migrate = MIGRATE_FROM[v];
    if (!migrate) return { ok: false, reason: "invalid" };
    record = migrate(record);
    v += 1;
  }
  const parsed = schema.safeParse(record);
  return parsed.success ? { ok: true, record: parsed.data } : { ok: false, reason: "invalid" };
}

/** Validates stored records: the bad ones are skipped (and counted), never thrown. */
export function parseRecords<T>(schema: Schema<T>, raw: readonly unknown[]): { records: T[]; dropped: number } {
  const records: T[] = [];
  let dropped = 0;
  for (const value of raw) {
    const parsed = schema.safeParse(value);
    if (parsed.success) records.push(parsed.data);
    else dropped += 1;
  }
  return { records, dropped };
}

// ---------------------------------------------------------------- saved trips

/** The stop ids an option names (walk ends at stops, every ride stop). */
function optionStopIds(option: PlanOptionDto): string[] {
  const ids: string[] = [];
  for (const leg of option.legs) {
    if (leg.kind === "walk") {
      if (leg.from.stopId) ids.push(leg.from.stopId);
      if (leg.to.stopId) ids.push(leg.to.stopId);
    } else if (leg.kind === "ride") {
      for (const s of leg.stops) ids.push(s.id);
    }
  }
  return [...new Set(ids)];
}

const rideLegs = (option: PlanOptionDto) => option.legs.filter((l): l is RideLegDto => l.kind === "ride");

function copyEnd(end: SavedEnd): SavedEnd {
  return { label: end.label, point: { lat: end.point.lat, lng: end.point.lng }, ...(end.place ? { place: end.place } : {}) };
}

export function buildSavedTrip(input: {
  id: string;
  savedAt: string;
  data: PlanResponse;
  option: PlanOptionDto;
  start: SavedEnd;
  destination: SavedEnd;
}): SavedTrip {
  const { data } = input;
  const option = toWireOption(input.option);
  const stopIds = new Set(optionStopIds(option));
  const variantIds = new Set(rideLegs(option).map((l) => l.variantId));
  return {
    id: input.id,
    savedAt: input.savedAt,
    revisionId: data.revision.revisionId,
    revisionLabel: data.revision.label,
    revisionKind: data.revision.kind,
    publishedAt: data.revision.publishedAt,
    start: copyEnd(input.start),
    destination: copyEnd(input.destination),
    option,
    stops: data.stops.filter((s) => stopIds.has(s.id)),
    variants: data.variants.filter((v) => variantIds.has(v.variantId)),
  };
}

/** The saved trip as a one-option plan response, so Trip detail renders it offline. */
export function savedTripResponse(card: SavedTrip): PlanResponse {
  return {
    revision: { revisionId: card.revisionId, label: card.revisionLabel, kind: card.revisionKind, publishedAt: card.publishedAt },
    plan: { revisionId: card.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: null, jeepneyReason: null, options: [card.option], notes: [] },
    stops: card.stops,
    variants: card.variants,
  };
}

const pointKey = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Identifies "this option between these two points" (Save ↔ Saved toggle). Never shared. */
export function savedTripKey(optionId: string, start: LatLng, destination: LatLng): string {
  return `${optionId}|${pointKey(start)}|${pointKey(destination)}`;
}

export type SavedTripMatch = { kind: "none" } | { kind: "saved"; trip: SavedTrip } | { kind: "older"; trip: SavedTrip };

/**
 * Is this option between these points saved? "saved" when a copy of the same revision exists;
 * "older" when the only copy was planned on another revision (offer "Update saved copy").
 */
export function matchSavedTrip(trips: readonly SavedTrip[], optionId: string, start: LatLng, destination: LatLng, revisionId: string): SavedTripMatch {
  const key = savedTripKey(optionId, start, destination);
  const same = trips.filter((t) => savedTripKey(t.option.id, t.start.point, t.destination.point) === key);
  const current = same.find((t) => t.revisionId === revisionId);
  if (current) return { kind: "saved", trip: current };
  return same[0] ? { kind: "older", trip: same[0] } : { kind: "none" };
}

/** Calendar date in Naga City time ("15 Oct 2026") of an ISO timestamp; null if unreadable. */
export function manilaDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return formatIsoDate(new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10));
}

/**
 * The option's time estimate from the (cached) snapshot's model, departing now: "Estimate 8–15 min
 * + waiting (unknown)", or "Time not available" without a model (an older snapshot; never a
 * guess). `walkLengths` are walk-graph lengths when the graph is cached; null/absent: each walk
 * is its ×1.3 straight-line estimate, as in trip options without the graph.
 */
export function savedEstimateText(
  option: PlanOptionDto,
  model: EtaModel | null | undefined,
  departure: Date = new Date(),
  walkLengths: ReadonlyArray<number | null | undefined> = [],
): string {
  const res = estimateOption(option, walkLengths, model, departure);
  return res.ok ? formatTotal(res.estimate.total) : TIME_NOT_AVAILABLE;
}

/** "{estimate text} · {fare chip} · data from {date}" (the estimate from the cached snapshot's model). */
export function tripCardMeta(
  card: Pick<SavedTrip, "option" | "publishedAt" | "revisionLabel">,
  model: EtaModel | null | undefined,
  departure: Date = new Date(),
  walkLengths: ReadonlyArray<number | null | undefined> = [],
): string {
  const date = manilaDate(card.publishedAt);
  const dataFrom = `data from ${date ?? `revision ${card.revisionLabel}`}`;
  const fare = fareChipText(card.option.fare);
  return `${savedEstimateText(card.option, model, departure, walkLengths)} · ${fare} · ${dataFrom}`;
}

/** Is `run` a consecutive stretch of `ring` (wrapping around a circular variant)? */
function isConsecutiveRun(ring: readonly string[], run: readonly string[], circular: boolean): boolean {
  // A closed ring may list its first stop again at the end.
  const stops = circular && ring.length > 1 && ring[0] === ring[ring.length - 1] ? ring.slice(0, -1) : ring;
  const n = stops.length;
  for (let i = 0; i < n; i++) {
    if (stops[i] !== run[0]) continue;
    let ok = true;
    for (let k = 1; k < run.length && ok; k++) {
      const j = i + k;
      const at = circular ? stops[j % n] : j < n ? stops[j] : undefined;
      ok = at === run[k];
    }
    if (ok) return true;
  }
  return false;
}

export type SavedTripStatus = "current" | "unchanged_in_new_revision" | "changed";

/**
 * Is a saved trip still what the published data says? Same revision → current. A newer revision →
 * unchanged only if every ride leg's variant still exists with the same ordered stops between
 * board and alight, and every stop the trip names still exists; otherwise changed.
 */
export function revalidateSavedTrip(card: SavedTrip, snapshot: Pick<NetworkSnapshot, "revision" | "stops" | "variants">): SavedTripStatus {
  if (snapshot.revision.revisionId === card.revisionId) return "current";
  const stopIds = new Set(snapshot.stops.map((s) => s.id));
  if (!optionStopIds(card.option).every((id) => stopIds.has(id))) return "changed";
  const variants = new Map(snapshot.variants.map((v) => [v.variantId, v]));
  for (const leg of rideLegs(card.option)) {
    if (leg.stops.length === 0) continue; // a route without pins: the re-plan compares variant and board/alight (sameRides)
    const variant = variants.get(leg.variantId);
    if (!variant) return "changed";
    if (!isConsecutiveRun(variant.stopIds, leg.stops.map((s) => s.id), variant.isCircular)) return "changed";
  }
  return "unchanged_in_new_revision";
}

function sameRides(a: PlanOptionDto, b: PlanOptionDto): boolean {
  const ra = rideLegs(a);
  const rb = rideLegs(b);
  if (ra.length !== rb.length) return false;
  return ra.every((leg, i) => {
    const other = rb[i]!;
    // Same variant and the same board/alight (50 m); a format-1 leg (no measures) compares stops, as before.
    if (leg.variantId !== other.variantId) return false;
    if (leg.boardMeasureM !== null && other.boardMeasureM !== null && leg.alightMeasureM !== null && other.alightMeasureM !== null) {
      return Math.abs(leg.boardMeasureM - other.boardMeasureM) <= 50 && Math.abs(leg.alightMeasureM - other.alightMeasureM) <= 50;
    }
    return leg.stops.length === other.stops.length && leg.stops.every((s, k) => s.id === other.stops[k]!.id);
  });
}

export type Reopen = { kind: "current"; optionId: string } | { kind: "replanned"; optionId: string } | { kind: "changed" };

/**
 * A saved trip reopened and re-planned on the current data: show the same option when it is
 * still there (`replanned` when the revision changed, so the screen says so), else the options
 * with "Route changed since you saved this".
 */
export function resolveReopen(card: SavedTrip, live: PlanResponse): Reopen {
  if (live.plan.coverage !== "provisional") return { kind: "changed" };
  const match = live.plan.options.find((o) => o.id === card.option.id);
  if (!match) return { kind: "changed" };
  if (live.plan.revisionId === card.revisionId) return { kind: "current", optionId: match.id };
  return sameRides(match, card.option) ? { kind: "replanned", optionId: match.id } : { kind: "changed" };
}

// ---------------------------------------------------------------- sharing

type ShareInput = Pick<SavedTrip, "start" | "destination" | "option" | "stops" | "variants" | "revisionLabel">;

const fixed = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/**
 * Text-only summary for the share sheet or the clipboard: the steps by stop name and code, the
 * unverified badge, the fare estimate. No coordinates and no links unless `exactPoints`.
 */
export function shareText(
  input: ShareInput,
  opts: { exactPoints?: boolean; etaModel?: EtaModel | null; walkLengths?: ReadonlyArray<number | null | undefined>; departure?: Date } = {},
): string {
  const stops = new Map(input.stops.map((s) => [s.id, s]));
  const name = (id: string | null, fallback: string | null) => {
    const s = id ? stops.get(id) : undefined;
    return s ? stopLabel(s.name, s.code) : (fallback ?? "the stop");
  };
  const direction = (variantId: string) => input.variants.find((v) => v.variantId === variantId)?.loopDirection ?? null;
  const { option } = input;
  const lines: string[] = [`ParaNaga trip: ${input.start.label} to ${input.destination.label}`];
  if (option.rides > 0) lines.push(`${UNVERIFIED_ROUTE_BADGE}.`);
  const steps: string[] = [];
  const lastRide = option.legs.reduce((last, l, i) => (l.kind === "ride" ? i : last), -1);
  for (const [i, leg] of option.legs.entries()) {
    if (leg.kind === "walk") {
      if (option.rides > 0 && isNegligibleWalk(leg)) continue;
      const to = leg.to.kind === "destination" ? input.destination.label : name(leg.to.stopId, leg.to.name);
      steps.push(`Walk ${formatDistance(leg.estimateMeters)} to ${to} (estimate, path not verified)`);
      continue;
    }
    if (leg.kind === "tricycle" || leg.kind === "padyak") {
      steps.push(streetRideText(leg, input.destination.label));
      continue;
    }
    const ends = rideEnds(leg, i === lastRide ? input.destination.label : undefined);
    if (!ends) continue;
    const { board, alight } = ends;
    const dir = directionText(direction(leg.variantId), "long");
    const count = ends.stops.length - 1;
    steps.push(`Board ${routeChipLabel(leg.routeCode, leg.routeName)} ${ends.pinned ? "at" : "near"} ${name(board.id, board.name)}${dir ? `, direction ${dir}` : ""}`);
    steps.push(ends.pinned
      ? `Ride ${count} ${count === 1 ? "stop" : "stops"}, get off at ${name(alight.id, alight.name)}. Say "Para!" to the driver.`
      : `Ride along the approximate path. ${freeAlightText(name(alight.id, alight.name))}`);
  }
  lines.push(...steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push(`Fare: ${option.rides > 0 ? legFareText(option.fare) : fareChipText(option.fare)}`);
  lines.push(`${savedEstimateText(option, opts.etaModel, opts.departure, opts.walkLengths)}. Data revision ${input.revisionLabel}.`);
  if (opts.exactPoints) {
    lines.push(`Start point: ${fixed(input.start.point)}`);
    lines.push(`Destination point: ${fixed(input.destination.point)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- saved places

const PLACE_SOURCE_TEXT: Record<SavedPlaceSource, string> = { osm: "OpenStreetMap", pin: "Mapped pin", pinned: "Pinned location", google: "Google suggestion, not verified" };

export function placeSubText(source: SavedPlaceSource): string {
  return `Saved place · ${PLACE_SOURCE_TEXT[source]}`;
}

export const PLACE_LABEL_ERROR = `Enter a name of 1 to ${PLACE_LABEL_MAX} characters.`;

/** Plain text: control characters removed, spaces collapsed, 1–40 characters. */
export function cleanPlaceLabel(raw: string): { ok: true; label: string } | { ok: false; message: string } {
  const label = raw.replace(/\p{Cc}/gu, (c) => (/\s/.test(c) ? " " : "")).replace(/\s+/g, " ").trim();
  if (label.length < 1 || codePointLength(label) > PLACE_LABEL_MAX) return { ok: false, message: PLACE_LABEL_ERROR };
  return { ok: true, label };
}

// ---------------------------------------------------------------- history

/** "Plaza Rizal → SM City Naga · 16 Oct 2026" (labels only). */
export function historyLine(entry: HistoryEntry): string {
  return `${entry.from} → ${entry.to} · ${manilaDate(entry.at) ?? "date unknown"}`;
}

/** Splits history into what stays and the ids older than the retention period. */
export function pruneHistory(entries: readonly HistoryEntry[], nowMs: number): { keep: HistoryEntry[]; expired: string[] } {
  const cutoff = nowMs - HISTORY_RETENTION_DAYS * DAY_MS;
  const keep: HistoryEntry[] = [];
  const expired: string[] = [];
  for (const e of entries) {
    if (Date.parse(e.at) < cutoff) expired.push(e.id);
    else keep.push(e);
  }
  return { keep, expired };
}

/** Two points that round to the same 6 decimals (about 0.1 m) are the same saved point. */
export function samePoint(a: LatLng, b: LatLng): boolean {
  return pointKey(a) === pointKey(b);
}

/** The saved place at this point, if any (Save ↔ Saved). */
export function findSavedPlace<T extends { point: LatLng }>(places: readonly T[], point: LatLng): T | null {
  return places.find((p) => samePoint(p.point, point)) ?? null;
}

/** Name offered when saving a trip end: its label, or "Pinned location" for a pin or a GPS fix. */
export function savePlacePrefill(end: { source: "gps" | "map" | "search"; label: string }): string {
  if (end.source !== "search") return "Pinned location";
  return takeCodePoints(end.label.replace(/ \(mapped pin\)$/, ""), PLACE_LABEL_MAX);
}
