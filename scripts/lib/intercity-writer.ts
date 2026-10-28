// Reviewed intercity seed import (IC1 Task 4): data/source/research/naga-intercity-seed-YYYY-MM-DD.json
// into the OPEN DRAFT revision (the one the admin console made). It never creates or publishes a
// revision: publishing stays the admin flow (validate, step-up, second reviewer).
//
//   buildIntercityPlan(file)  pure: parse, sha256, the importable records, the exclusions with their
//                             reason, the counts and why a commit would be refused (commitProblems).
//   dryRunIntercity(url, plan) reads the open draft in a READ ONLY transaction as paranaga_import and
//                             returns the review sheet: validation problems against the draft
//                             (terminals, fare rules, sources) and one decision line per imported
//                             record (identity / version new or reused, member added / repointed /
//                             same). Nothing is written (the transaction is rolled back).
//   commitIntercity(url, plan) one transaction as paranaga_import under
//                             pg_advisory_xact_lock(hashtext('intercity-seed')):
//     1. refused (nothing written) unless reviewStatus is owner_approved, the seed is not synthetic,
//        and a draft is open (`status = 'draft' order by seq desc limit 1 for update`);
//     2. a committed batch with the same sha256 -> "unchanged", nothing written;
//     3. any validation problem -> refused;
//     4. inserts the source document and batch, the IC sources (on conflict do nothing), the
//        destination, terminal (T17) and service identities and versions (reused by content hash),
//        the departures and fare observations of NEW service versions only, the dataset note;
//     5. repoints the draft's members of those destinations, services (seed and link codes only),
//        T17 and the note. Every other member is left as it is.
// A service version's content hash covers its row and its departures and observations (sorted),
// so a changed departure is a new version. A departure month (YYYY-MM) is stored as its first day;
// so is an observation month. A legacy service link (RS01…) is a copy of the draft's member
// version with the destination codes set (its distance and OSM versions are kept). A seed service
// whose OSM relations and distance equal the draft member's keeps that member's OSM relation
// versions (RS06 v2: "OSM ids and distance copied from the published version").
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { sha256Hex } from "../../src/domain/import/hash";
import {
  commitProblems,
  excludedIntercity,
  importableIntercity,
  parseIntercitySeed,
  validateIntercitySeed,
  type IntercitySeed,
  type IntercitySeedDeparture,
  type IntercitySeedObservation,
  type IntercitySeedService,
} from "../../src/domain/import/intercity-seed";
import {
  ensureIdentities,
  ImportRefusedError,
  insertRows,
  numberArray,
  reuseOrPlan,
  stableJson,
  textArrayNotNull,
  type Row,
} from "./sql-rows";

export const INTERCITY_DIR = "data/source/research";
export const INTERCITY_FILE_RE = /^naga-intercity-seed-(\d{4}-\d{2}-\d{2})\.json$/;
const ACTOR = "scripts/import-intercity";
const LOCK = "intercity-seed";

export type IntercityFile = { fileName: string; bytes: Buffer };

/** The newest `naga-intercity-seed-YYYY-MM-DD.json` in `dir` (by the date in its name), or null. */
export function readNewestIntercitySeed(dir: string = INTERCITY_DIR): IntercityFile | null {
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir).filter((f) => INTERCITY_FILE_RE.test(f)).sort().at(-1);
  return newest ? { fileName: newest, bytes: readFileSync(path.join(dir, newest)) } : null;
}

// ---------------------------------------------------------------- plan (pure)

export type IntercityPlan = {
  fileName: string;
  sha256: string;
  bytes: number;
  seedDate: string;
  snapshotVersion: string;
  /** Parse and file-name problems (the plan is unusable when non-empty). */
  problems: string[];
  /** Why a commit is refused (reviewStatus, synthetic); a dry run still runs. */
  commitProblems: string[];
  /** `section code: reason` of every excluded record. */
  excluded: string[];
  counts: Record<string, number>;
  /** The full seed (validation needs the excluded records too) and its importable records. */
  seed: IntercitySeed | null;
  importable: IntercitySeed | null;
};

export function buildIntercityPlan(file: IntercityFile): IntercityPlan {
  const nameDate = INTERCITY_FILE_RE.exec(file.fileName)?.[1] ?? "";
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const base = {
    fileName: file.fileName, sha256, bytes: file.bytes.byteLength, seedDate: nameDate,
    snapshotVersion: `${LOCK}:${nameDate}:${sha256.slice(0, 12)}`,
  };
  const problems: string[] = [];
  if (!nameDate) problems.push(`${file.fileName}: not named naga-intercity-seed-YYYY-MM-DD.json`);
  let seed: IntercitySeed;
  try {
    seed = parseIntercitySeed(JSON.parse(file.bytes.toString("utf8")));
  } catch (error) {
    problems.push(`${file.fileName}: ${(error as Error).message}`);
    return { ...base, problems, commitProblems: [], excluded: [], counts: {}, seed: null, importable: null };
  }
  if (nameDate && seed.header.seedDate !== nameDate) {
    problems.push(`${file.fileName}: header seedDate ${seed.header.seedDate} differs from the file name date`);
  }
  const imp = importableIntercity(seed);
  return {
    ...base,
    problems,
    commitProblems: commitProblems(seed),
    excluded: excludedIntercity(seed),
    counts: {
      sources: imp.sources.length,
      destinations: imp.destinations.length,
      terminals: imp.terminals.length,
      services: imp.services.length,
      service_links: imp.serviceLinks.length,
      departures: imp.services.reduce((n, s) => n + s.departures.length, 0),
      observations: imp.services.reduce((n, s) => n + s.observations.length, 0),
      dataset_notes: imp.datasetNotes.length,
      excluded: excludedIntercity(seed).length,
    },
    seed,
    importable: imp,
  };
}

/** A month `YYYY-MM` is stored as its first day; a day stays as it is. */
export const firstDay = (value: string) => (/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value);

const hashOf = (kind: string, content: unknown) => sha256Hex(JSON.stringify([kind, content]));

type DepartureRow = {
  pattern: string; times: string[]; headway_min: number | null; start_time: string | null; end_time: string | null;
  trips_per_day: number | null; day_type: string; basis: string; observed_on: string; source_codes: string[];
};
type ObservationRow = {
  kind: string; destination_code: string | null; category: string; seat_class_text: string | null;
  amount_centavos: number; amount_high_centavos: number | null; basis: string; observed_at: string | null;
  source_codes: string[];
};
type ServiceRow = {
  mode: string; name: string; operators: string[]; terminal_code: string; terminal_note: string | null;
  destination: string; osm_relation_ids: number[]; osm_relation_versions: number[] | null; distance_km: number | null;
  distance_basis: string | null; status: string; status_since: string | null; status_note_code: string | null;
  as_of: string | null; review_by: string | null; destination_codes: string[]; access_note_code: string | null;
  fare_rule_codes: string[]; notes: string | null; source_codes: string[];
};

const departureRow = (d: IntercitySeedDeparture): DepartureRow => ({
  pattern: d.pattern, times: d.times, headway_min: d.headway_min, start_time: d.start_time, end_time: d.end_time,
  trips_per_day: d.trips_per_day, day_type: d.day_type, basis: d.basis, observed_on: firstDay(d.observed_on),
  source_codes: d.source_codes,
});
const observationRow = (o: IntercitySeedObservation): ObservationRow => ({
  kind: o.kind, destination_code: o.destination_code, category: o.category, seat_class_text: o.seat_class_text,
  amount_centavos: o.amount_centavos, amount_high_centavos: o.amount_high_centavos, basis: o.basis,
  observed_at: o.observed_month === null ? null : firstDay(o.observed_month), source_codes: o.source_codes,
});
const sortedJson = <T>(rows: T[]) => rows.map((r) => stableJson(r)).sort();

/** Content hash of a service version: its row plus its departures and observations, sorted. */
export function serviceVersionHash(row: ServiceRow, departures: DepartureRow[], observations: ObservationRow[]): string {
  return hashOf("regional_service_version", [JSON.parse(stableJson(row)), sortedJson(departures), sortedJson(observations)]);
}

// ---------------------------------------------------------------- draft context (shared by dry run and commit)

type Draft = { id: string; label: string };
type MemberVersion = Row & { entity_id: string; version_id: string; code: string };
type PlannedService = {
  code: string; row: ServiceRow; departures: DepartureRow[]; observations: ObservationRow[]; hash: string;
  link: boolean; reason: string;
};

type DraftPlan = {
  draft: Draft | null;
  problems: string[];
  decisions: string[];
  services: PlannedService[];
};

const SERVICE_COLUMNS = `v.mode, v.name, v.operators::text[] as operators, v.terminal_code, v.terminal_note, v.destination,
  v.osm_relation_ids::text[] as osm_relation_ids, v.osm_relation_versions::int[] as osm_relation_versions,
  v.distance_km::text as distance_km, v.distance_basis, v.status, v.status_since::text as status_since, v.status_note_code,
  v.as_of::text as as_of, v.review_by::text as review_by, v.destination_codes::text[] as destination_codes,
  v.access_note_code, v.fare_rule_codes::text[] as fare_rule_codes, v.notes, v.source_codes::text[] as source_codes`;

const serviceRowOf = (r: Row): ServiceRow => ({
  mode: String(r.mode), name: String(r.name), operators: r.operators as string[], terminal_code: String(r.terminal_code),
  terminal_note: (r.terminal_note as string | null) ?? null, destination: String(r.destination),
  osm_relation_ids: (r.osm_relation_ids as string[]).map(Number),
  osm_relation_versions: (r.osm_relation_versions as number[] | null) ?? null,
  distance_km: r.distance_km === null ? null : Number(r.distance_km), distance_basis: (r.distance_basis as string | null) ?? null,
  status: String(r.status), status_since: (r.status_since as string | null) ?? null,
  status_note_code: (r.status_note_code as string | null) ?? null, as_of: (r.as_of as string | null) ?? null,
  review_by: (r.review_by as string | null) ?? null, destination_codes: r.destination_codes as string[],
  access_note_code: (r.access_note_code as string | null) ?? null, fare_rule_codes: r.fare_rule_codes as string[],
  notes: (r.notes as string | null) ?? null, source_codes: r.source_codes as string[],
});

const seedServiceRow = (s: IntercitySeedService, osmVersions: number[] | null): ServiceRow => ({
  mode: s.mode, name: s.name, operators: s.operators, terminal_code: s.terminal_code, terminal_note: s.terminal_note,
  destination: s.destination, osm_relation_ids: s.osm_relation_ids, osm_relation_versions: osmVersions,
  distance_km: s.distance_km, distance_basis: s.distance_basis, status: s.status, status_since: s.status_since,
  status_note_code: s.status_note_code, as_of: s.as_of, review_by: s.review_by, destination_codes: s.destination_codes,
  access_note_code: s.access_note_code, fare_rule_codes: s.fare_rule_codes, notes: s.notes, source_codes: s.source_codes,
});

const destinationRow = (d: IntercitySeed["destinations"][number]) => ({
  name: d.name, aliases: d.aliases, group_code: d.group_code, psgc_code: d.psgc_code, kind: d.kind, source_codes: d.source_codes,
});
const terminalRow = (t: IntercitySeed["terminals"][number]) => ({
  name: t.name, kind: t.kind, location_text: t.location_text, modes: t.modes, verification: t.verification,
  status_note: t.status_note, notes: t.notes, source_codes: t.source_codes,
});
const sourceRow = (s: IntercitySeed["sources"][number]) => ({
  code: s.code, title: s.title, url: s.url, evidence_type: s.evidence_type, published_or_enacted: s.date,
  checked_on: s.retrieved, publisher: s.publisher,
});

/** Reads the open draft (or, for a dry run without one, the published revision) and plans every record. */
async function planAgainstDraft(c: pg.ClientBase, plan: IntercityPlan, lockDraft: boolean): Promise<DraftPlan> {
  const seed = plan.seed!;
  const imp = plan.importable!;
  const decisions: string[] = [];
  const problems: string[] = [];

  const draftRows = await c.query<Draft>(
    `select id, label from transit.revision where status = 'draft' order by seq desc limit 1${lockDraft ? " for update" : ""}`);
  const draft = draftRows.rows[0] ?? null;
  let contextId = draft?.id ?? null;
  if (!draft) {
    const published = await c.query<{ id: string }>("select revision_id as id from transit.published_pointer");
    contextId = published.rows[0]?.id ?? null;
    decisions.push("no open draft: the plan below is read against the published revision; a commit would be refused");
  }
  if (!contextId) return { draft, problems: ["no open draft and no published revision"], decisions, services: [] };

  const memberCodes = async (kind: string, table: string) => (await c.query<{ code: string }>(
    `select t.code from transit.revision_member m join ${table} t on t.id = m.entity_id
      where m.revision_id = $1 and m.entity_kind = $2`, [contextId, kind])).rows.map((r) => r.code);
  const terminalCodes = await memberCodes("terminal", "transit.terminal");
  const fareRuleCodes = await memberCodes("fare_rule", "transit.fare_rule");
  const allSources = await c.query<Row & { code: string }>(
    `select code, title, url, evidence_type, published_or_enacted, checked_on::text as checked_on, publisher from ingest.source`);
  problems.push(...validateIntercitySeed(seed, {
    terminalCodes, fareRuleCodes, sourceCodes: allSources.rows.map((r) => r.code).filter((code) => !code.startsWith("IC")),
  }));

  // Sources: insert-only (on conflict do nothing); a differing committed row is kept and reported.
  const sourceByCode = new Map(allSources.rows.map((r) => [r.code, r]));
  for (const s of imp.sources) {
    const found = sourceByCode.get(s.code);
    const state = !found ? "new" : stableJson(found) === stableJson(sourceRow(s)) ? "same as committed" : "DIFFERS from the committed row (kept)";
    decisions.push(`source ${s.code} import (${s.evidence_type}): ${state}`);
  }

  const members = await c.query<{ entity_kind: string; entity_id: string; version_id: string; code: string }>(
    `select m.entity_kind, m.entity_id, m.version_id,
            coalesce(d.code, s.code, t.code, n.key) as code
       from transit.revision_member m
       left join transit.regional_destination d on m.entity_kind = 'regional_destination' and d.id = m.entity_id
       left join transit.regional_service s on m.entity_kind = 'regional_service' and s.id = m.entity_id
       left join transit.terminal t on m.entity_kind = 'terminal' and t.id = m.entity_id
       left join transit.dataset_note n on m.entity_kind = 'dataset_note' and n.id = m.entity_id
      where m.revision_id = $1 and m.entity_kind in ('regional_destination', 'regional_service', 'terminal', 'dataset_note')`,
    [contextId]);
  const memberOf = (kind: string, code: string) => members.rows.find((m) => m.entity_kind === kind && m.code === code);

  /** Identity, version and membership state of one record, for the review sheet. */
  const describe = async (kind: string, table: string, versionTable: string, owner: string, code: string, hash: string) => {
    const identity = await c.query<{ id: string }>(`select id from ${table} where code = $1`, [code]);
    const id = identity.rows[0]?.id;
    const version = id
      ? (await c.query<{ id: string }>(`select id from ${versionTable} where ${owner} = $1 and content_hash = $2`, [id, hash])).rows[0]?.id
      : undefined;
    const member = memberOf(kind, code);
    const membership = !member ? "member added" : version && member.version_id === version ? "member unchanged" : "member repointed";
    return `${id ? "identity exists" : "identity new"}, ${version ? "version reused" : "version new"} ${hash.slice(0, 12)}, ${membership}`;
  };

  for (const d of imp.destinations) {
    const hash = hashOf("regional_destination_version", destinationRow(d));
    decisions.push(`destination ${d.code} import: ${d.review.reason} -> ${await describe("regional_destination",
      "transit.regional_destination", "transit.regional_destination_version", "regional_destination_id", d.code, hash)}`);
  }
  for (const t of imp.terminals) {
    const hash = hashOf("terminal_version", terminalRow(t));
    decisions.push(`terminal ${t.code} import: ${t.review.reason} -> ${await describe("terminal",
      "transit.terminal", "transit.terminal_version", "terminal_id", t.code, hash)}`);
  }

  // Context member versions of every service the seed touches.
  const touched = [...imp.services.map((s) => s.code), ...imp.serviceLinks.map((l) => l.service_code)];
  const current = await c.query<MemberVersion>(
    `select m.entity_id, m.version_id, s.code, ${SERVICE_COLUMNS},
            (select count(*)::int from transit.regional_departure x where x.regional_service_version_id = v.id)
          + (select count(*)::int from transit.fare_observation x where x.regional_service_version_id = v.id) as children
       from transit.revision_member m join transit.regional_service s on s.id = m.entity_id
       join transit.regional_service_version v on v.id = m.version_id
      where m.revision_id = $1 and m.entity_kind = 'regional_service' and s.code = any($2::text[])`, [contextId, touched]);
  const currentOf = (code: string) => current.rows.find((r) => r.code === code);

  const services: PlannedService[] = [];
  for (const s of imp.services) {
    const now = currentOf(s.code);
    const nowRow = now ? serviceRowOf(now) : null;
    const sameRelations = nowRow !== null && s.osm_relation_ids.length > 0 && nowRow.distance_km === s.distance_km
      && stableJson(nowRow.osm_relation_ids) === stableJson(s.osm_relation_ids);
    const row = seedServiceRow(s, sameRelations ? nowRow!.osm_relation_versions : null);
    const departures = s.departures.map(departureRow);
    const observations = s.observations.map(observationRow);
    services.push({ code: s.code, row, departures, observations, hash: serviceVersionHash(row, departures, observations), link: false, reason: s.review.reason });
  }
  for (const l of imp.serviceLinks) {
    const now = currentOf(l.service_code);
    if (!now) {
      problems.push(`serviceLink ${l.service_code}: the service is not a member of ${draft ? "the open draft" : "the published revision"}`);
      continue;
    }
    if (Number(now.children) > 0) {
      problems.push(`serviceLink ${l.service_code}: its member version has departures or observations; a link copies none`);
      continue;
    }
    const row = { ...serviceRowOf(now), destination_codes: l.destination_codes };
    services.push({ code: l.service_code, row, departures: [], observations: [], hash: serviceVersionHash(row, [], []), link: true, reason: l.review.reason });
  }
  for (const p of services) {
    const extra = [
      p.link ? "copy of the member version with destination codes" : null,
      !p.link && p.row.osm_relation_versions ? "OSM relation versions kept from the member version" : null,
      p.departures.length ? `${p.departures.length} departure(s)` : null,
      p.observations.length ? `${p.observations.length} observation(s)` : null,
    ].filter(Boolean).join(", ");
    decisions.push(`${p.link ? "serviceLink" : "service"} ${p.code} import (${p.row.status}): ${p.reason} -> ` +
      `${await describe("regional_service", "transit.regional_service", "transit.regional_service_version", "regional_service_id", p.code, p.hash)}` +
      (extra ? `; ${extra}` : ""));
  }

  for (const n of imp.datasetNotes) {
    const found = await c.query<{ id: string; value: unknown }>("select id, value from transit.dataset_note where key = $1", [n.key]);
    const row = found.rows[0];
    if (row && stableJson(row.value) !== stableJson(n.value)) {
      problems.push(`datasetNote ${n.key}: differs from the committed transit.dataset_note row (notes are not versioned)`);
    }
    const member = memberOf("dataset_note", n.key);
    decisions.push(`datasetNote ${n.key} import: ${n.review.reason} -> ${row ? "row exists" : "row new"}, ` +
      `${member && row && member.entity_id === row.id ? "member unchanged" : "member added"}`);
  }
  return { draft, problems, decisions, services };
}

// ---------------------------------------------------------------- dry run

export type IntercityDryRun = {
  draft: Draft | null;
  problems: string[];
  commitProblems: string[];
  decisions: string[];
};

export async function dryRunIntercity(connectionString: string, plan: IntercityPlan): Promise<IntercityDryRun> {
  if (plan.problems.length > 0 || !plan.seed) {
    return { draft: null, problems: plan.problems, commitProblems: plan.commitProblems, decisions: [] };
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    try {
      await client.query("set local role paranaga_import");
      const p = await planAgainstDraft(client, plan, false);
      const commit = [...plan.commitProblems, ...(p.draft ? [] : ["no open draft revision"])];
      return { draft: p.draft, problems: p.problems, commitProblems: commit, decisions: p.decisions };
    } finally {
      await client.query("rollback");
    }
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- commit

export type IntercityOutcome = {
  outcome: "committed" | "unchanged";
  batchId: string;
  draftId: string;
  counts: Record<string, number>;
};

export async function commitIntercity(connectionString: string, plan: IntercityPlan): Promise<IntercityOutcome> {
  if (plan.problems.length > 0 || !plan.seed) {
    throw new ImportRefusedError(`${plan.fileName}: ${plan.problems.join("; ")}; nothing written`);
  }
  // The human gate: checked before any connection.
  if (plan.commitProblems.length > 0) {
    throw new ImportRefusedError(`${plan.fileName}: ${plan.commitProblems.join("; ")}; nothing written`);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    try {
      await client.query("set local role paranaga_import");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      const result = await writeIntercity(client, plan);
      await client.query(result.outcome === "committed" ? "commit" : "rollback");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function writeIntercity(c: pg.ClientBase, plan: IntercityPlan): Promise<IntercityOutcome> {
  const draftRow = await c.query<Draft>("select id, label from transit.revision where status = 'draft' order by seq desc limit 1 for update");
  const draft = draftRow.rows[0];
  if (!draft) throw new ImportRefusedError("no open draft revision: create one in the admin console first; nothing written");

  const prior = await c.query<{ id: string; snapshot_version: string; counts: Row }>(
    `select id, snapshot_version, counts from ingest.batch
      where mode = 'commit' and status = 'committed' and split_part(snapshot_version, ':', 1) = $1
      order by split_part(snapshot_version, ':', 2) desc, finished_at desc nulls last`, [LOCK]);
  const same = prior.rows.find((b) => b.counts.document_sha256 === plan.sha256);
  if (same) {
    return { outcome: "unchanged", batchId: same.id, draftId: draft.id, counts: plan.counts };
  }
  const newer = prior.rows.find((b) => (b.snapshot_version.split(":")[1] ?? "") > plan.seedDate);
  if (newer) throw new ImportRefusedError(`${plan.fileName} is older than the committed ${newer.snapshot_version}; nothing written`);

  const p = await planAgainstDraft(c, plan, true);
  if (p.problems.length > 0) {
    throw new ImportRefusedError(`${p.problems.length} problem(s), nothing written: ${p.problems.join("; ")}`);
  }
  const imp = plan.importable!;

  // ---------------------------------------------------------------- provenance
  const document = await c.query<{ id: string }>(
    "select id from ingest.source_document where file_name = $1 and sha256 = $2", [plan.fileName, plan.sha256]);
  const documentId = document.rows[0]?.id ?? randomUUID();
  if (!document.rows[0]) {
    await c.query(
      `insert into ingest.source_document (id, source_code, file_name, sha256, bytes, retrieved_on)
       values ($1, null, $2, $3, $4, $5::date)`, [documentId, plan.fileName, plan.sha256, plan.bytes, plan.seedDate]);
  }
  const batchId = randomUUID();
  await c.query(
    `insert into ingest.batch (id, source_document_id, snapshot_version, mode, status, started_by)
     values ($1, $2, $3, 'commit', 'running', $4)`, [batchId, documentId, plan.snapshotVersion, ACTOR]);
  const counts: Record<string, number> = { ...plan.counts };

  // ---------------------------------------------------------------- sources (insert-only)
  const sources = await c.query(
    `insert into ingest.source (code, title, url, evidence_type, published_or_enacted, checked_on, publisher)
     select x.code, x.title, x.url, x.evidence_type, x.published_or_enacted, x.checked_on, x.publisher
       from jsonb_to_recordset($1::jsonb) as x(code text, title text, url text, evidence_type text,
                                                 published_or_enacted text, checked_on date, publisher text)
     on conflict (code) do nothing`, [JSON.stringify(imp.sources.map(sourceRow))]);
  counts.sources_inserted = sources.rowCount ?? 0;

  // ---------------------------------------------------------------- destinations
  const destinationIds = await ensureIdentities(c, "transit.regional_destination", "code", imp.destinations.map((d) => d.code),
    false, (code) => ({ code, is_synthetic: false }), [["code", "text"], ["is_synthetic", "boolean"]]);
  counts.destination_rows_inserted = destinationIds.inserted;
  const destinationVersions = await reuseOrPlan(c, "transit.regional_destination_version", "regional_destination_id",
    imp.destinations.map((d) => ({ owner: destinationIds.ids.get(d.code)!, hash: hashOf("regional_destination_version", destinationRow(d)), row: d })),
    false);
  counts.destination_versions_inserted = await insertRows(c, "transit.regional_destination_version",
    destinationVersions.filter((x) => x.isNew).map(({ id, owner, row: d }) => ({
      id, regional_destination_id: owner, ...destinationRow(d), content_hash: hashOf("regional_destination_version", destinationRow(d)),
    })), [["id", "uuid"], ["regional_destination_id", "uuid"], ["name", "text"], ["aliases", "jsonb", textArrayNotNull("aliases")],
      ["group_code", "text"], ["psgc_code", "text"], ["kind", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
      ["content_hash", "text"]]);

  // ---------------------------------------------------------------- terminals (T17: no coordinate)
  const terminalIds = await ensureIdentities(c, "transit.terminal", "code", imp.terminals.map((t) => t.code), false,
    (code) => {
      const t = imp.terminals.find((x) => x.code === code)!;
      return { code, name: t.name, location_text: t.location_text, modes: t.modes, evidence_status: t.verification,
        notes: t.notes, source_codes: t.source_codes, is_synthetic: false };
    },
    [["code", "text"], ["name", "text"], ["location_text", "text"], ["modes", "jsonb", textArrayNotNull("modes")],
      ["evidence_status", "text"], ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
      ["is_synthetic", "boolean"]]);
  counts.terminal_rows_inserted = terminalIds.inserted;
  const terminalVersions = await reuseOrPlan(c, "transit.terminal_version", "terminal_id",
    imp.terminals.map((t) => ({ owner: terminalIds.ids.get(t.code)!, hash: hashOf("terminal_version", terminalRow(t)), row: t })), false);
  counts.terminal_versions_inserted = await insertRows(c, "transit.terminal_version",
    terminalVersions.filter((x) => x.isNew).map(({ id, owner, row: t }) => ({
      id, terminal_id: owner, ...terminalRow(t), content_hash: hashOf("terminal_version", terminalRow(t)),
    })), [["id", "uuid"], ["terminal_id", "uuid"], ["name", "text"], ["kind", "text"], ["location_text", "text"],
      ["modes", "jsonb", textArrayNotNull("modes")], ["verification", "text"], ["status_note", "text"], ["notes", "text"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"]]);

  // ---------------------------------------------------------------- services, departures, observations
  const serviceIds = await ensureIdentities(c, "transit.regional_service", "code", p.services.map((s) => s.code), false,
    (code) => ({ code, is_synthetic: false }), [["code", "text"], ["is_synthetic", "boolean"]]);
  counts.service_rows_inserted = serviceIds.inserted;
  const serviceVersions = await reuseOrPlan(c, "transit.regional_service_version", "regional_service_id",
    p.services.map((s) => ({ owner: serviceIds.ids.get(s.code)!, hash: s.hash, row: s })), false);
  const fresh = serviceVersions.filter((x) => x.isNew);
  counts.service_versions_inserted = await insertRows(c, "transit.regional_service_version",
    fresh.map(({ id, owner, row: s }) => ({ id, regional_service_id: owner, ...s.row, content_hash: s.hash })),
    [["id", "uuid"], ["regional_service_id", "uuid"], ["mode", "text"], ["name", "text"],
      ["operators", "jsonb", textArrayNotNull("operators")], ["terminal_code", "text"], ["terminal_note", "text"],
      ["destination", "text"], ["osm_relation_ids", "jsonb", numberArray("osm_relation_ids", "bigint")],
      ["osm_relation_versions", "jsonb",
        "case when x.osm_relation_versions is null or jsonb_typeof(x.osm_relation_versions) = 'null' then null else " +
        `${numberArray("osm_relation_versions", "integer")} end`],
      ["distance_km", "numeric"], ["distance_basis", "text"], ["status", "text"], ["status_since", "date"],
      ["status_note_code", "text"], ["as_of", "date"], ["review_by", "date"],
      ["destination_codes", "jsonb", textArrayNotNull("destination_codes")], ["access_note_code", "text"],
      ["fare_rule_codes", "jsonb", textArrayNotNull("fare_rule_codes")], ["notes", "text"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"]]);
  // Children only for new versions (a reused version already has them: the hash covers them).
  counts.departures_inserted = await insertRows(c, "transit.regional_departure",
    fresh.flatMap(({ id, row: s }) => s.departures.map((d) => ({ regional_service_version_id: id, ...d }))),
    [["regional_service_version_id", "uuid"], ["pattern", "text"], ["times", "jsonb", `${textArrayNotNull("times")}::time[]`],
      ["headway_min", "smallint"], ["start_time", "time"], ["end_time", "time"], ["trips_per_day", "smallint"],
      ["day_type", "text"], ["basis", "text"], ["observed_on", "date"], ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);
  // fare_observation is unique on (code, category): the code names the version (hash prefix) and the row.
  counts.observations_inserted = await insertRows(c, "transit.fare_observation",
    fresh.flatMap(({ id, row: s }) => [...s.observations].sort((a, b) => (stableJson(a) < stableJson(b) ? -1 : 1)).map((o, i) => ({
      code: `RSO-${s.code}-${s.hash.slice(0, 12)}-${i + 1}`, mode_code: s.row.mode, regional_service_version_id: id, ...o,
    }))),
    [["code", "text"], ["mode_code", "text"], ["regional_service_version_id", "uuid"], ["kind", "text"],
      ["destination_code", "text"], ["category", "text"], ["seat_class_text", "text"], ["amount_centavos", "integer"],
      ["amount_high_centavos", "integer"], ["basis", "text"], ["observed_at", "date"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);

  // ---------------------------------------------------------------- dataset notes (not versioned: insert once)
  // planAgainstDraft refused a key whose committed value differs.
  const noteIds = new Map<string, string>();
  counts.dataset_notes_inserted = 0;
  for (const n of imp.datasetNotes) {
    const found = await c.query<{ id: string }>("select id from transit.dataset_note where key = $1", [n.key]);
    const id = found.rows[0]?.id ?? randomUUID();
    if (!found.rows[0]) {
      await c.query("insert into transit.dataset_note (id, key, value) values ($1, $2, $3::jsonb)", [id, n.key, JSON.stringify(n.value)]);
      counts.dataset_notes_inserted += 1;
    }
    noteIds.set(n.key, id);
  }

  // ---------------------------------------------------------------- draft members (seed records only)
  const members = [
    ...destinationVersions.map((v) => ({ entity_kind: "regional_destination", entity_id: v.owner, version_id: v.id })),
    ...terminalVersions.map((v) => ({ entity_kind: "terminal", entity_id: v.owner, version_id: v.id })),
    ...serviceVersions.map((v) => ({ entity_kind: "regional_service", entity_id: v.owner, version_id: v.id })),
    ...[...noteIds.values()].map((id) => ({ entity_kind: "dataset_note", entity_id: id, version_id: id })),
  ];
  const changed = await c.query(
    `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id)
     select $1, x.entity_kind, x.entity_id, x.version_id
       from jsonb_to_recordset($2::jsonb) as x(entity_kind text, entity_id uuid, version_id uuid)
     on conflict (revision_id, entity_kind, entity_id) do update set version_id = excluded.version_id
      where transit.revision_member.version_id is distinct from excluded.version_id`,
    [draft.id, JSON.stringify(members)]);
  counts.members_changed = changed.rowCount ?? 0;
  counts.seed_members = members.length;

  await c.query(
    `update ingest.batch set status = 'committed', finished_at = now(), counts = $2::jsonb where id = $1`,
    [batchId, JSON.stringify({
      ...counts, document_sha256: plan.sha256, file: plan.fileName, draft_revision_id: draft.id, draft_revision_label: draft.label,
      excluded: plan.excluded, decisions: p.decisions,
    })]);
  return { outcome: "committed", batchId, draftId: draft.id, counts };
}
