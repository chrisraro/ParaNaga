import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { SourceList, TerminalDetail } from "@/domain/api/schemas";
import { routesNamingTerminal, type TerminalRouteVariant } from "@/domain/network/terminal-routes";
import type { SearchIndexSource } from "@/domain/search/index-build";
import type { Db } from "@/server/db/context";
import { getPublishedRevision, listRoutes } from "./network-repo";
import { listPlaces } from "./places-repo";

// Reference data (search index source, terminals, sources register), read ONLY through the
// v_published_* views (tests/unit/repo-views.test.ts). Every query is filtered by the revision id
// the caller read first, so one response never mixes revisions.

type Row = Record<string, unknown>;

async function rows(db: Db, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const listOrNull = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);

function legalStreetsOf(v: unknown): TerminalRouteVariant["legalStreets"] {
  const o = (v && typeof v === "object" ? v : {}) as Row;
  return { inbound: listOrNull(o.inbound), outbound: listOrNull(o.outbound), circuit: listOrNull(o.circuit) };
}

const ROUTE_ORDER = sql`r.official_group_number nulls last, length(r.public_code), r.public_code`;

/** Published variants with their route, in route-list order (permanent before trial). */
async function variantStreets(db: Db, revisionId: string): Promise<TerminalRouteVariant[]> {
  const found = await rows(db, sql`
    select r.public_code, r.name, v.kind, v.legal_streets, v.source_codes::text[] as source_codes
      from transit.v_published_variants v
      join transit.v_published_routes r on r.revision_id = v.revision_id and r.id = v.route_id
     where v.revision_id = ${revisionId}::uuid
     order by ${ROUTE_ORDER}, v.kind, v.direction, v.variant_id`);
  return found.map((v) => ({
    routeCode: str(v.public_code),
    routeName: str(v.name),
    kind: str(v.kind),
    legalStreets: legalStreetsOf(v.legal_streets),
    sourceCodes: strArray(v.source_codes),
  }));
}

async function sourcesFor(db: Db, revisionId: string, codes: string[] | null) {
  if (codes !== null && codes.length === 0) return [];
  const found = await rows(db, sql`
    select code, title, url, evidence_type, published_or_enacted, checked_on::text as checked_on
      from transit.v_published_sources
     where revision_id = ${revisionId}::uuid
       ${codes === null ? sql`` : sql`and code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`}
     order by code`);
  return found.map(toSource);
}

function toSource(s: Row): SourceList["sources"][number] {
  return {
    code: str(s.code),
    title: str(s.title),
    url: strOrNull(s.url),
    evidenceType: strOrNull(s.evidence_type),
    publishedOrEnacted: strOrNull(s.published_or_enacted),
    checkedOn: strOrNull(s.checked_on),
  };
}

// ---------------------------------------------------------------- search index

/** Everything the search index is built from, or null when `revisionId` is not the published revision. */
export async function getSearchIndexSource(db: Db, revisionId: string): Promise<SearchIndexSource | null> {
  const revision = await getPublishedRevision(db);
  if (!revision || revision.revisionId !== revisionId) return null;

  const places = await listPlaces(db, revisionId);
  const stops = await rows(db, sql`
    select s.stop_point_id, s.source_layer, s.source_code_raw, s.label_raw, s.lat, s.lon,
           exists (select 1 from transit.v_published_route_stops rs
                    where rs.revision_id = s.revision_id and rs.stop_point_id = s.stop_point_id) as on_route
      from transit.v_published_stops s
     where s.revision_id = ${revisionId}::uuid`);
  const groups = await listRoutes(db, revisionId);
  const variants = await variantStreets(db, revisionId);
  const terminals = await rows(db, sql`
    select code, name, location_text, modes::text[] as modes
      from transit.v_published_terminals where revision_id = ${revisionId}::uuid order by code`);
  const barangays = await rows(db, sql`
    select name, survey_status, source_code
      from transit.v_published_barangays where revision_id = ${revisionId}::uuid order by name`);
  const study = await rows(db, sql`
    select code, label_raw, label_type, route_code, direction, source_context, source_ids::text[] as source_ids
      from transit.v_published_designated_stop_candidates where revision_id = ${revisionId}::uuid order by code`);
  const categories = await rows(db, sql`
    select category, destinations::text[] as destinations, candidate_terminal_code
      from transit.v_published_destination_categories where revision_id = ${revisionId}::uuid order by category`);
  const leads = await rows(db, sql`
    select code, name, operating_status
      from transit.v_published_feeder_leads where revision_id = ${revisionId}::uuid order by code`);

  return {
    revision,
    places,
    stops: stops.map((s) => ({
      id: str(s.stop_point_id),
      layer: strOrNull(s.source_layer),
      code: strOrNull(s.source_code_raw),
      label: strOrNull(s.label_raw),
      lat: Number(s.lat),
      lng: Number(s.lon),
      onRoute: Boolean(s.on_route),
    })),
    routes: groups.flatMap((g) =>
      g.routes.map((r) => ({
        code: r.code,
        name: r.name,
        groupNumber: r.groupNumber,
        evidenceLevel: r.evidenceLevel,
        hasTrial: r.hasTrial,
        streetLists: variants
          .filter((v) => v.routeCode === r.code)
          .flatMap((v) => [v.legalStreets.inbound, v.legalStreets.outbound, v.legalStreets.circuit])
          .filter((l): l is string[] => l !== null),
      })),
    ),
    terminals: terminals.map((t) => ({
      code: str(t.code),
      name: str(t.name),
      locationText: strOrNull(t.location_text),
      modes: strArray(t.modes),
    })),
    barangays: barangays.map((b) => ({ name: str(b.name), surveyStatus: str(b.survey_status), sourceCode: strOrNull(b.source_code) })),
    studyLabels: study.map((d) => ({
      code: str(d.code),
      label: str(d.label_raw),
      labelType: strOrNull(d.label_type),
      routeCode: strOrNull(d.route_code),
      direction: strOrNull(d.direction),
      sourceContext: strOrNull(d.source_context),
      sourceCodes: strArray(d.source_ids),
    })),
    destinationCategories: categories.map((c) => ({
      category: str(c.category),
      destinations: strArray(c.destinations),
      terminalCode: strOrNull(c.candidate_terminal_code),
    })),
    feederLeads: leads.map((f) => ({ code: str(f.code), name: str(f.name), status: strOrNull(f.operating_status) })),
  };
}

// ---------------------------------------------------------------- terminals

export async function getTerminalDetail(db: Db, revisionId: string, code: string): Promise<Omit<TerminalDetail, "revision"> | null> {
  const [t] = await rows(db, sql`
    select code, name, location_text, modes::text[] as modes, evidence_status, notes, lat, lon,
           source_codes::text[] as source_codes
      from transit.v_published_terminals where revision_id = ${revisionId}::uuid and code = ${code}`);
  if (!t) return null;

  const routes = routesNamingTerminal(str(t.name), await variantStreets(db, revisionId));
  const categories = await rows(db, sql`
    select category, destinations::text[] as destinations, evidence_status, source_codes::text[] as source_codes
      from transit.v_published_destination_categories
     where revision_id = ${revisionId}::uuid and candidate_terminal_code = ${code}
     order by category`);

  const terminalCodes = strArray(t.source_codes);
  const codes = [...new Set([
    ...terminalCodes,
    ...routes.flatMap((r) => r.sourceCodes),
    ...categories.flatMap((c) => strArray(c.source_codes)),
  ])];

  return {
    terminal: {
      code: str(t.code),
      name: str(t.name),
      locationText: strOrNull(t.location_text),
      modes: strArray(t.modes),
      evidenceStatus: strOrNull(t.evidence_status),
      notes: strOrNull(t.notes),
      sourceCodes: terminalCodes,
      lat: numOrNull(t.lat),
      lng: numOrNull(t.lon),
    },
    routes,
    destinationCategories: categories.map((c) => ({
      category: str(c.category),
      destinations: strArray(c.destinations),
      evidenceStatus: strOrNull(c.evidence_status),
      sourceCodes: strArray(c.source_codes),
    })),
    sources: await sourcesFor(db, revisionId, codes),
  };
}

// ---------------------------------------------------------------- sources register

/**
 * Every source the published revision cites, plus `codeCited` (sources the read model cites from
 * code, e.g. S28 for the legacy-name hints) when the catalogue has them; ordered by code.
 */
export async function listSources(db: Db, revisionId: string, codeCited: readonly string[]): Promise<SourceList["sources"]> {
  const cited = await sourcesFor(db, revisionId, null);
  const extra = codeCited.filter((c) => !cited.some((s) => s.code === c));
  if (extra.length === 0) return cited;
  const found = await rows(db, sql`
    select code, title, url, evidence_type, published_or_enacted, checked_on::text as checked_on
      from transit.v_published_source_catalog
     where revision_id = ${revisionId}::uuid and code in (${sql.join(extra.map((c) => sql`${c}`), sql`, `)})`);
  return [...cited, ...found.map(toSource)].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
