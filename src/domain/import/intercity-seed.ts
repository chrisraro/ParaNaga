import { z } from "zod";
import { zodMessage } from "./zod-message";

/**
 * The reviewed intercity seed (data/source/research/naga-intercity-seed-*.json, IC1): sources
 * IC01–IC35, out-of-city destinations, T17 (airport, no coordinate), regional services RS08+ and
 * RS06 v2 with their departures and fare observations, destination links for legacy services,
 * dataset notes and the excluded register.
 *
 * Pure. Mirrors modes-seed.ts: strict zod, every top-level record carries a `review`, top-level and
 * header names camelCase, record fields snake_case. Enum values match the 0029 SQL CHECKs.
 */

// ---------------------------------------------------------------- enums (0029 CHECKs)

export const INTERCITY_MODES = ["uv_express", "bus", "jeepney", "rail", "air"] as const;
export const SERVICE_STATUSES = [
  "community_mapped", "operating", "operating_limited", "suspended", "discontinued_reported", "unconfirmed",
] as const;
export const NOT_RUNNING_STATUSES = ["suspended", "discontinued_reported"] as const;
/** `planned_not_funded` is deliberately not a service note (AC-IC3): it lives only in datasetNotes. */
export const STATUS_NOTE_CODES = ["bridge_damage_no_reopening_date", "stopped_no_resumption_found", "limited_trips"] as const;
export const ACCESS_NOTE_CODES = ["airport_walk_to_maharlika"] as const;
export const DESTINATION_GROUPS = [
  "partido", "rinconada", "albay", "sorsogon", "cam_norte", "nw_camsur", "manila", "luzon_air",
] as const;
export const DESTINATION_KINDS = ["town", "hub", "airport", "station"] as const;
export const DEPARTURE_PATTERNS = ["listed_times", "headway_rule", "when_full", "operating_hours", "daily_unspecified"] as const;
export const DAY_TYPES = ["daily", "weekdays", "weekends", "unspecified"] as const;
export const DEPARTURE_BASES = ["official", "terminal_rule", "booking_site", "news", "at_launch", "travel_guide"] as const;
export const OBSERVATION_BASES = ["official", "booking_site", "travel_guide", "at_launch"] as const;
export const OBSERVATION_KINDS = ["official_matrix", "operator_listing"] as const;
export const EVIDENCE_TYPES = ["official", "news", "community", "booking_site", "travel_guide", "low_quality"] as const;
export const INTERCITY_TERMINAL_KINDS = ["terminal", "loading_point", "waiting_area", "station", "airport"] as const;
export const INTERCITY_TERMINAL_MODES = ["jeepney", "tricycle", "uv_express", "bus", "rail", "air"] as const;

/** Days from `as_of` to `review_by`, per basis (design §9 decision 5a). */
export const EXPIRY_DAYS = {
  official: 365, terminal_rule: 365, news: 180, booking_site: 120,
  at_launch: 180, travel_guide: 0, undated: 0, suspended: 30,
} as const;
export type ExpiryBasis = keyof typeof EXPIRY_DAYS;

/** ISO date `days` after `iso` (UTC calendar arithmetic, no host time zone). */
export const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The latest allowed `review_by` for a fact of `basis` known as of `asOf`. */
export const reviewByFor = (basis: ExpiryBasis, asOf: string): string => addDays(asOf, EXPIRY_DAYS[basis]);

// ---------------------------------------------------------------- schemas

const text = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
const codes = z.array(text);

const Review = z.strictObject({
  decision: z.enum(["import", "exclude"]),
  reason: text,
  reviewedOn: isoDate,
  reviewer: text,
});

const Header = z.strictObject({
  seedDate: isoDate,
  preparedFrom: z.array(z.strictObject({ file: text, sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1),
  reviewStatus: z.enum(["draft", "owner_approved"]),
  synthetic: z.literal(true).optional(),
});

const Source = z.strictObject({
  code: z.string().regex(/^IC[0-9]{2}$/),
  title: text,
  url: text.nullable(),
  publisher: text.nullable(),
  /** Verbatim date text from the research (ingest.source.published_or_enacted). */
  date: text.nullable(),
  evidence_type: z.enum(EVIDENCE_TYPES),
  /** The research's High/Medium/Low, for reviewers only; never shown to users. */
  ai_confidence: z.enum(["high", "medium", "low"]).nullable(),
  retrieved: isoDate.nullable(),
  review: Review,
});

const Destination = z.strictObject({
  code: z.string().regex(/^D-[A-Z0-9-]{2,30}$/),
  name: text,
  aliases: z.array(text).max(10),
  group_code: z.enum(DESTINATION_GROUPS),
  psgc_code: z.string().regex(/^[0-9]{10}$/).nullable(),
  kind: z.enum(DESTINATION_KINDS),
  source_codes: codes,
  review: Review,
});

const Terminal = z.strictObject({
  code: z.string().regex(/^T[0-9]{2}$/),
  name: text,
  kind: z.enum(INTERCITY_TERMINAL_KINDS),
  location_text: text.nullable(),
  modes: z.array(z.enum(INTERCITY_TERMINAL_MODES)).min(1),
  /** Coordinates come only from OSM; IC1 terminals have none on file. */
  coordinate: z.null(),
  verification: text,
  status_note: text.nullable(),
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

const Departure = z.strictObject({
  pattern: z.enum(DEPARTURE_PATTERNS),
  times: z.array(hhmm),
  headway_min: z.number().int().positive().nullable(),
  start_time: hhmm.nullable(),
  end_time: hhmm.nullable(),
  trips_per_day: z.number().int().positive().nullable(),
  day_type: z.enum(DAY_TYPES),
  basis: z.enum(DEPARTURE_BASES),
  /** A day, or a month when the source gives only the month (stored as its first day). */
  observed_on: z.union([isoDate, isoMonth]),
  source_codes: codes.min(1),
}).refine((d) => d.pattern !== "headway_rule" || d.headway_min !== null, "headway_rule needs headway_min")
  .refine((d) => d.pattern !== "listed_times" || d.times.length > 0, "listed_times needs at least one time")
  .refine((d) => d.pattern !== "operating_hours" || (d.start_time !== null && d.end_time !== null), "operating_hours needs start_time and end_time");

const Observation = z.strictObject({
  kind: z.enum(OBSERVATION_KINDS),
  destination_code: text.nullable(),
  category: text,
  seat_class_text: z.string().min(1).max(40).nullable(),
  amount_centavos: z.number().int().nonnegative(),
  amount_high_centavos: z.number().int().nonnegative().nullable(),
  basis: z.enum(OBSERVATION_BASES),
  /** null only so validation can report it: every regional observation needs its month. */
  observed_month: isoMonth.nullable(),
  source_codes: codes.min(1),
}).refine((o) => o.amount_high_centavos === null || o.amount_high_centavos >= o.amount_centavos, "amount_high_centavos below amount_centavos");

const Service = z.strictObject({
  code: z.string().regex(/^RS[0-9]{2}$/),
  mode: z.enum(INTERCITY_MODES),
  name: text,
  operators: z.array(text),
  terminal_code: text,
  terminal_note: text.nullable(),
  /** The legacy free-text destination column. */
  destination: text,
  osm_relation_ids: z.array(z.number().int().positive()),
  distance_km: z.number().positive().nullable(),
  distance_basis: text.nullable(),
  status: z.enum(SERVICE_STATUSES),
  status_since: isoDate.nullable(),
  status_note_code: z.enum(STATUS_NOTE_CODES).nullable(),
  /** The basis the review window comes from (seed only; review_by is what is stored). */
  basis: z.enum(Object.keys(EXPIRY_DAYS) as [ExpiryBasis, ...ExpiryBasis[]]).nullable(),
  as_of: isoDate.nullable(),
  review_by: isoDate.nullable(),
  destination_codes: codes,
  access_note_code: z.enum(ACCESS_NOTE_CODES).nullable(),
  fare_rule_codes: codes,
  notes: text.nullable(),
  source_codes: codes.min(1),
  departures: z.array(Departure),
  observations: z.array(Observation),
  review: Review,
});

/** A legacy service (RS01–RS05) that gains destination codes in a new community_mapped version. */
const ServiceLink = z.strictObject({
  service_code: z.string().regex(/^RS[0-9]{2}$/),
  destination_codes: codes.min(1),
  review: Review,
});

const DatasetNote = z.strictObject({
  key: z.string().regex(/^intercity_[a-z0-9_]+$/),
  value: z.looseObject({ sourceCodes: codes.min(1), asOf: isoDate }),
  review: Review,
});

const Excluded = z.strictObject({
  code: z.string().regex(/^X-[A-Z0-9-]+$/),
  summary: text,
  source_codes: codes,
  review: Review,
});

const IntercitySeedSchema = z.strictObject({
  header: Header,
  sources: z.array(Source),
  /** Research reference (R1…) → source code (IC01…). */
  sourceMap: z.record(z.string().regex(/^R[0-9]{1,2}$/), z.string().regex(/^IC[0-9]{2}$/)),
  destinations: z.array(Destination),
  terminals: z.array(Terminal),
  services: z.array(Service),
  serviceLinks: z.array(ServiceLink),
  datasetNotes: z.array(DatasetNote),
  excluded: z.array(Excluded),
});
export { IntercitySeedSchema };

export type IntercitySeed = z.infer<typeof IntercitySeedSchema>;
export type IntercitySeedService = IntercitySeed["services"][number];
export type IntercitySeedDeparture = IntercitySeedService["departures"][number];
export type IntercitySeedObservation = IntercitySeedService["observations"][number];
export type IntercitySeedDestination = IntercitySeed["destinations"][number];

const RECORD_KEYS = [
  "sources", "destinations", "terminals", "services", "serviceLinks", "datasetNotes",
] as const satisfies readonly (keyof IntercitySeed)[];
type Reviewed = { review: { decision: "import" | "exclude"; reason: string } } & Record<string, unknown>;

// ---------------------------------------------------------------- parse

/** Validates the file shape (strict). Throws a one-line message on the first problem. */
export function parseIntercitySeed(input: unknown): IntercitySeed {
  const r = IntercitySeedSchema.safeParse(input);
  if (!r.success) throw new Error(zodMessage("Intercity seed", r.error));
  return r.data;
}

/** The seed with every excluded record removed (the `excluded` register is never imported). */
export function importableIntercity(seed: IntercitySeed): IntercitySeed {
  const out = { ...seed, excluded: [] } as Record<string, unknown>;
  for (const key of RECORD_KEYS) out[key] = (seed[key] as Reviewed[]).filter((r) => r.review.decision === "import");
  return out as IntercitySeed;
}

/** Excluded records as `section code: reason`, for the dry-run print. */
export function excludedIntercity(seed: IntercitySeed): string[] {
  return [...RECORD_KEYS, "excluded" as const].flatMap((key) =>
    (seed[key] as Reviewed[])
      .filter((r) => key === "excluded" || r.review.decision === "exclude")
      .map((r) => `${key} ${String(r.code ?? r.key ?? r.service_code)}: ${r.review.reason}`),
  );
}

/** Why the seed may not be committed (the writer refuses unless this is empty). */
export function commitProblems(seed: IntercitySeed): string[] {
  const out: string[] = [];
  if (seed.header.synthetic) out.push("seed is synthetic");
  if (seed.header.reviewStatus !== "owner_approved") out.push(`reviewStatus is ${seed.header.reviewStatus}, owner_approved required`);
  return out;
}

// ---------------------------------------------------------------- validation

export type IntercitySeedContext = {
  /** Terminal codes already in the dataset (T01–T16); the seed's own terminals are added. */
  terminalCodes: Iterable<string>;
  fareRuleCodes: Iterable<string>;
  /** Non-IC source codes services may keep citing (for example RS06's existing sources). */
  sourceCodes?: Iterable<string>;
};

const isNotRunning = (s: string) => (NOT_RUNNING_STATUSES as readonly string[]).includes(s);

/**
 * Every rule beyond the file's shape, on imported records only. Empty array = consistent.
 * Mirrors the 0029 CHECKs and the publish/admin rules so problems surface at dry run.
 */
export function validateIntercitySeed(seed: IntercitySeed, ctx: IntercitySeedContext): string[] {
  const issues: string[] = [];
  const imp = importableIntercity(seed);

  const dupes = (label: string, values: string[]) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) issues.push(`Duplicate ${label} ${v}`);
      seen.add(v);
    }
  };
  dupes("source code", seed.sources.map((s) => s.code));
  dupes("destination code", seed.destinations.map((d) => d.code));
  dupes("terminal code", seed.terminals.map((t) => t.code));
  dupes("service code", [...seed.services.map((s) => s.code), ...seed.serviceLinks.map((l) => l.service_code)]);
  dupes("dataset note key", seed.datasetNotes.map((n) => n.key));
  dupes("excluded code", seed.excluded.map((x) => x.code));

  const evidence = new Map(imp.sources.map((s) => [s.code, s.evidence_type]));
  const knownSources = new Set([...evidence.keys(), ...(ctx.sourceCodes ?? [])]);
  const destinations = new Set(imp.destinations.map((d) => d.code));
  const terminals = new Set([...ctx.terminalCodes, ...imp.terminals.map((t) => t.code)]);
  const fareRules = new Set(ctx.fareRuleCodes);
  const unknown = (where: string, label: string, list: readonly string[], known: Set<string>) => {
    for (const c of list) if (!known.has(c)) issues.push(`${where} cites unknown ${label} ${c}`);
  };

  for (const [ref, code] of Object.entries(seed.sourceMap)) unknown(`sourceMap ${ref}`, "source", [code], knownSources);
  for (const d of imp.destinations) unknown(`destination ${d.code}`, "source", d.source_codes, knownSources);
  for (const t of imp.terminals) unknown(`terminal ${t.code}`, "source", t.source_codes, knownSources);
  for (const n of imp.datasetNotes) unknown(`datasetNote ${n.key}`, "source", n.value.sourceCodes, knownSources);
  for (const l of imp.serviceLinks) unknown(`serviceLink ${l.service_code}`, "destination", l.destination_codes, destinations);
  for (const x of seed.excluded) if (x.review.decision !== "exclude") issues.push(`excluded ${x.code}: decision must be exclude`);

  for (const s of imp.services) {
    const at = `service ${s.code}`;
    unknown(at, "destination", s.destination_codes, destinations);
    unknown(at, "terminal", [s.terminal_code], terminals);
    unknown(at, "source", s.source_codes, knownSources);
    unknown(at, "fare rule", s.fare_rule_codes, fareRules);
    for (const d of s.departures) unknown(`${at} departure`, "source", d.source_codes, knownSources);
    for (const o of s.observations) {
      unknown(`${at} observation`, "source", o.source_codes, knownSources);
      if (o.destination_code !== null) unknown(`${at} observation`, "destination", [o.destination_code], destinations);
      if (o.observed_month === null) issues.push(`${at}: ${o.basis} observation ${o.category} has no month`);
    }

    if (isNotRunning(s.status)) {
      if (s.status_since === null) issues.push(`${at}: ${s.status} needs status_since`);
      if (s.fare_rule_codes.length > 0) issues.push(`${at}: not running but has fare rules`);
      if (s.departures.length > 0) issues.push(`${at}: not running but has departures`);
      if (s.observations.length > 0) issues.push(`${at}: not running but has fare observations`);
    }
    if ((s.status === "operating" || s.status === "operating_limited")
      && !s.source_codes.some((c) => evidence.get(c) === "official" || evidence.get(c) === "news")) {
      issues.push(`${at}: ${s.status} needs an official or news source`);
    }
    if ((s.mode === "rail" || s.mode === "air") && s.fare_rule_codes.length > 0) issues.push(`${at}: ${s.mode} carries no fare rules`);
    if (s.osm_relation_ids.length === 0 && s.distance_km !== null) issues.push(`${at}: distance without OSM relations`);
    if ((s.distance_km === null) !== (s.distance_basis === null)) issues.push(`${at}: distance_km and distance_basis go together`);

    if (s.status !== "community_mapped") {
      if (s.as_of === null || s.review_by === null || s.basis === null) {
        issues.push(`${at}: ${s.status} needs as_of, review_by and basis`);
      } else {
        const max = reviewByFor(s.basis, s.as_of);
        if (s.review_by < s.as_of) issues.push(`${at}: review_by is before as_of`);
        else if (s.review_by > max) issues.push(`${at}: review_by ${s.review_by} is later than ${max} (${s.basis})`);
      }
    }
  }

  for (const key of Object.keys(seed) as (keyof IntercitySeed)[]) {
    if (key !== "datasetNotes" && JSON.stringify(seed[key]).includes("planned_not_funded")) {
      issues.push(`${key}: planned_not_funded is only allowed in datasetNotes`);
    }
  }
  return issues;
}
