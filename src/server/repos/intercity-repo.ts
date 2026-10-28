import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Intercity, IntercityNote } from "@/domain/api/schemas";
import type { Db } from "@/server/db/context";
import { fareRulesByCode, getPublishedRevision } from "./network-repo";

// The Leaving Naga guide (IC1, design §7): the published regional destinations, the services
// that name at least one of them (RS04/RS07 stay on terminal detail only) with their departures
// and fare observations, the regional fare rules they cite and the intercity_*
// dataset notes. Read ONLY through the v_published_* views, every query filtered by the revision
// id checked first, so one body never mixes revisions. Nothing here reads the clock: status,
// staleness and the rule estimate are computed on the device.

type Row = Record<string, unknown>;

export type IntercityRead = { status: "not_published" } | { status: "ok"; body: Intercity };

async function rows(db: Db, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Groups rows by their service code, keeping the query order. */
function byService<T>(found: Row[], map: (r: Row) => T): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of found) {
    const code = str(r.service_code);
    const list = out.get(code) ?? [];
    list.push(map(r));
    out.set(code, list);
  }
  return out;
}

export async function getIntercity(db: Db, revisionId: string): Promise<IntercityRead> {
  const revision = await getPublishedRevision(db);
  if (!revision || revision.revisionId !== revisionId) return { status: "not_published" };
  const rev = sql`${revisionId}::uuid`;

  const destinations = await rows(db, sql`
    select code, name, aliases::text[] as aliases, group_code, psgc_code, kind
      from transit.v_published_regional_destinations where revision_id = ${rev} order by code`);
  const services = await rows(db, sql`
    select code, mode, name, operators::text[] as operators, terminal_code, destination_codes::text[] as destination_codes,
           distance_km::float8 as distance_km, distance_basis, status, status_since::text as status_since, status_note_code,
           as_of::text as as_of, review_by::text as review_by, access_note_code, fare_rule_codes::text[] as fare_rule_codes,
           source_codes::text[] as source_codes
      from transit.v_published_regional_services
     where revision_id = ${rev} and cardinality(destination_codes) > 0
     order by code`);
  const terminals = await rows(db, sql`
    select code, name, location_text, lat, lon, coord_source
      from transit.v_published_terminals where revision_id = ${rev} order by code`);
  const departures = await rows(db, sql`
    select service_code, pattern,
           array(select left(t::text, 5) from unnest(times) as t order by t) as times,
           headway_min, left(start_time::text, 5) as start_time, left(end_time::text, 5) as end_time,
           trips_per_day, day_type, basis, observed_on::text as observed_on, source_codes::text[] as source_codes
      from transit.v_published_regional_departures where revision_id = ${rev}
     order by service_code, observed_on, pattern, id`);
  const observations = await rows(db, sql`
    select service_code, amount_centavos, amount_high_centavos, seat_class_text, destination_code, basis,
           observed_at::text as observed_at, source_codes::text[] as source_codes
      from transit.v_published_regional_observations where revision_id = ${rev}
     order by service_code, destination_code nulls first, amount_centavos, seat_class_text nulls first, id`);
  const evidence = await rows(db, sql`
    select code, evidence_type from transit.v_published_sources where revision_id = ${rev} and evidence_type is not null`);
  const notes = await rows(db, sql`
    select key, value from transit.v_published_dataset_notes
     where revision_id = ${rev} and starts_with(key, 'intercity_') order by key`);

  const ruleCodes = [...new Set(services.flatMap((s) => strArray(s.fare_rule_codes)))].sort();
  const fareRules = await fareRulesByCode(db, revisionId, ruleCodes);

  const terminalOf = new Map(terminals.map((t) => {
    // Only an OpenStreetMap coordinate with its provenance counts (legacy rows have none).
    const located = t.lat !== null && t.lat !== undefined && t.coord_source !== null && t.coord_source !== undefined;
    return [str(t.code), {
      code: str(t.code),
      name: str(t.name),
      locationText: strOrNull(t.location_text),
      lat: located ? Number(t.lat) : null,
      lng: located ? Number(t.lon) : null,
    }];
  }));
  const evidenceOf = new Map(evidence.map((e) => [str(e.code), str(e.evidence_type)]));
  const departuresOf = byService(departures, (d) => ({
    pattern: d.pattern as Intercity["services"][number]["departures"][number]["pattern"],
    times: strArray(d.times),
    headwayMin: numOrNull(d.headway_min),
    startTime: strOrNull(d.start_time),
    endTime: strOrNull(d.end_time),
    tripsPerDay: numOrNull(d.trips_per_day),
    dayType: d.day_type as Intercity["services"][number]["departures"][number]["dayType"],
    basis: d.basis as Intercity["services"][number]["departures"][number]["basis"],
    observedOn: str(d.observed_on),
    sourceCodes: strArray(d.source_codes),
  }));
  const observationsOf = byService(observations, (o) => ({
    amountCentavos: Number(o.amount_centavos),
    amountHighCentavos: numOrNull(o.amount_high_centavos),
    seatClassText: strOrNull(o.seat_class_text),
    destinationCode: strOrNull(o.destination_code),
    basis: o.basis as Intercity["services"][number]["observations"][number]["basis"],
    observedAt: str(o.observed_at),
    sourceCodes: strArray(o.source_codes),
  }));

  type Service = Intercity["services"][number];
  return {
    status: "ok",
    body: {
      revision,
      destinations: destinations.map((d) => ({
        code: str(d.code),
        name: str(d.name),
        aliases: strArray(d.aliases),
        groupCode: d.group_code as Intercity["destinations"][number]["groupCode"],
        psgcCode: strOrNull(d.psgc_code),
        kind: d.kind as Intercity["destinations"][number]["kind"],
      })),
      services: services.map((s): Service => {
        const code = str(s.code);
        const sourceCodes = strArray(s.source_codes);
        return {
          code,
          mode: s.mode as Service["mode"],
          name: str(s.name),
          operators: strArray(s.operators),
          terminal: terminalOf.get(str(s.terminal_code)) ?? null,
          destinationCodes: strArray(s.destination_codes),
          distanceKm: numOrNull(s.distance_km),
          distanceBasis: strOrNull(s.distance_basis),
          status: s.status as Service["status"],
          statusSince: strOrNull(s.status_since),
          statusNoteCode: strOrNull(s.status_note_code) as Service["statusNoteCode"],
          asOf: strOrNull(s.as_of),
          reviewBy: strOrNull(s.review_by),
          accessNoteCode: strOrNull(s.access_note_code) as Service["accessNoteCode"],
          fareRuleCodes: strArray(s.fare_rule_codes),
          departures: departuresOf.get(code) ?? [],
          observations: observationsOf.get(code) ?? [],
          sourceCodes,
          sourceEvidenceTypes: [...new Set(sourceCodes.flatMap((c) => evidenceOf.get(c) ?? []))].sort(),
        };
      }),
      fareRules,
      notes: notes.map((n) => ({ key: str(n.key), value: n.value as IntercityNote["value"] })),
    },
  };
}
