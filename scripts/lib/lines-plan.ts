// Pure planning step for the road outputs (Increment D, Task 7): from the pinned OpenStreetMap road
// snapshot (scripts/lib/roads-snapshot.ts, sha256-pinned) and the reviewed modes seed it builds
//   - one approximate path per member variant (J1, the Task 5 tracer): ok / flagged with the line,
//     its length, stop measures (pins) and every off-list segment with its reason; or untraced
//     ("Path could not be traced from the street list") with the reason — reported, never an abort;
//   - the street graph v2 payload (plan E §C: walk + tricycle + padyak, reviewed road rules and padyak
//     areas): ABORTS (problem) when over budget or when a rule's way id is not in the snapshot;
//   - the reviewed route notes (written by the lines writer) and a street-graph report for the dry run;
//   - the five time-estimate parameters (D8/D9): ABORTS when a key is missing;
//   - the regional services' distances from the snapshot's relation summaries (D5): the shorter
//     direction, recorded in distance_basis.
// Refuses (problems) on a snapshot that fails its pin or parse (or is synthetic), and on reviewed
// street aliases that the snapshot does not confirm (verifyStreetAliases). Reads nothing but its
// inputs; the writer is scripts/lib/lines-writer.ts.
import { gzipSync } from "node:zlib";
import { NAGA_BOUNDARY } from "../../src/domain/geo/naga";
import { haversineMeters } from "../../src/domain/geo/geometry";
import { buildRoadGraph } from "../../src/domain/geo/road-graph";
import type { ModesSeedRoadRule } from "../../src/domain/import/modes-seed";
import type { StreetAlias } from "../../src/domain/geo/street-names";
import type { LatLng } from "../../src/domain/geo/types";
import { sha256Hex } from "../../src/domain/import/hash";
import type { IdentifiedStop } from "../../src/domain/import/mapped-stops";
import { ETA_PARAM_KEYS } from "../../src/domain/import/modes-seed";
import { verifyStreetAliases } from "../../src/domain/import/osm-roads";
import { buildTraceContext, type SeedAnchor, type TraceRulesProvenance } from "../../src/domain/import/trace-context";
import {
  TRACE_BUILDER_VERSION,
  traceVariant,
  type OffListSegment,
  type TraceFailure,
  type TraceFlagReason,
  type TraceInput,
  type TraceQuality,
} from "../../src/domain/import/trace-route";
import { walkGraphPayloadSchema } from "../../src/domain/walk/format";
import { buildStreetGraph, STREET_GRAPH_BUILDER_VERSION, type WalkGraphBuildStats } from "../../src/domain/walk/walk-graph-build";
import { decodeWalkGraph, padyakAreaCoverage, type PadyakAreaCoverage } from "../../src/domain/walk/walk-graph";
import type { PlannedVariant } from "./import-plan";
import type { ModesPlan, PlannedEtaParam, PlannedRegionalService, PlannedRouteNote } from "./modes-plan";
import { ROADS_FILE_RE, type RoadsSnapshot } from "./roads-snapshot";

/** Plan E §C (street graph v2): at most 800 KB of JSON and 260 KB gzip (migration 0010 checks the same). */
export const WALK_GRAPH_MAX_BYTES = 800 * 1024;
export const WALK_GRAPH_MAX_GZIP_BYTES = 260 * 1024;
export const WALK_GRAPH_KEY = "naga-walk";
export const PATH_LABEL = "Approximate path, not a verified route shape";

export type TraceKey = { routeCode: string; direction: string; kind: string; name: string | null };

export type PlannedStopMeasure = { seq: number; measureM: number; snapM: number };

export type PlannedTrace = TraceKey & {
  /** content_hash of the variant version traced (the published member version). */
  variantVersionHash: string;
  mode: TraceQuality["mode"];
  status: "ok" | "flagged" | "untraced";
  flagReason: TraceFlagReason | null;
  untracedReason: TraceFailure | null;
  /** The line, rounded to 1e-6 degrees, without repeated points; [] when untraced. */
  coords: LatLng[];
  lengthM: number | null;
  stopMeasures: PlannedStopMeasure[] | null;
  offListSegments: OffListSegment[];
  quality: TraceQuality;
  inputsHash: string;
  contentHash: string;
};

export type PlannedWalkGraph = {
  key: string;
  formatVersion: 2;
  payload: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
  nodeCount: number;
  edgeCount: number;
  builderVersion: string;
  stats: WalkGraphBuildStats;
  contentHash: string;
};

/** What the dry run prints about the street graph (rules, padyak areas, notes); no effect on the stored rows. */
export type StreetReport = {
  /** Metres of the snapshot ways each imported road rule covers (clipped where it clips); 0 for junction / not_mapped. */
  rules: { code: string; kind: string; appliesTo: string; geometry: string; lengthM: number }[];
  padyakBannedM: number;
  /** Per padyak area: its place nodes and the recall / false positives on a ~90 m grid over the graph bbox. */
  areas: (PadyakAreaCoverage & { placeNodeIds: number[] })[];
  notesPerRoute: Record<string, number>;
};

/** A regional service version with its distance (the seed row plus D5 fields). */
export type PlannedRegionalDistance = {
  service: PlannedRegionalService;
  relationVersions: number[];
  distanceKm: number;
  distanceBasis: string;
  contentHash: string;
};

export type LinesPlan = {
  roadsFileName: string;
  roadsSha256: string;
  roadsBytes: number;
  /** YYYY-MM-DD of the snapshot (file name). */
  roadsDate: string;
  osmBaseTimestamp: string | null;
  /** ingest.source code of the road snapshot, OSMR-YYYY-MM-DD (D2). */
  sourceCode: string;
  /**
   * ingest.batch.snapshot_version: modes-lines:<roads date>:<modes seed date>:<first 12 hex of inputsHash>.
   * Any input change (places snapshot, Data_Sets, seed, builders) is a new key, so a new revision.
   */
  snapshotVersion: string;
  /** anywhere-alight-<roads date>; the writer appends .2, .3 … when that label exists (same roads date, other inputs). */
  revisionLabel: string;
  /** sha256 over every input (road snapshot, modes seed, Data_Sets, places snapshot, builders). */
  inputsHash: string;
  traces: PlannedTrace[];
  walkGraph: PlannedWalkGraph | null;
  streetReport: StreetReport | null;
  routeNotes: PlannedRouteNote[];
  etaParams: PlannedEtaParam[];
  regionalDistances: PlannedRegionalDistance[];
  /** Regional services left without a distance ("distance not on file"), with the reason. */
  regionalWithoutDistance: string[];
  /** ROUTE_LANDMARKS / ROUTE_TERMINI review decisions and how they resolved (batch provenance). */
  traceRules: TraceRulesProvenance;
  aliasesHash: string;
  counts: Record<string, number>;
  problems: string[];
};

export type LinesPlanInput = {
  roads: RoadsSnapshot;
  modes: ModesPlan;
  /** Data_Sets variants (scripts/lib/import-plan.ts); the member version of each is traced. */
  variants: readonly PlannedVariant[];
  identified: readonly IdentifiedStop[];
  /** Places of the committed OSM places snapshot (feeder anchors), with that file's sha256. */
  osmPlaces: readonly { key: string; lat: number; lng: number }[];
  osmPlacesSha256: string | null;
  /** Data_Sets documents hash (ImportPlan.documentsHash). */
  documentsHash: string;
  /** D7 budget; overridable for tests only. */
  walkGraphBudget?: { bytes: number; gzipBytes: number };
};

const round = (v: number, d: number) => Number(v.toFixed(d));

function lineCoords(line: readonly LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of line) {
    const q = { lat: round(p.lat, 6), lng: round(p.lng, 6) };
    const last = out[out.length - 1];
    if (!last || last.lat !== q.lat || last.lng !== q.lng) out.push(q);
  }
  return out;
}

/** Metres of the snapshot ways a drawn road rule covers, clipped between its clip nodes. */
function ruleLengthM(r: ModesSeedRoadRule, snapshot: NonNullable<RoadsSnapshot["roads"]>): number {
  const ways = new Map(snapshot.ways.map((w) => [w.id, w]));
  let total = 0;
  for (const id of r.wayIds) {
    let ids = ways.get(id)!.nodeIds;
    const clip = r.clips.find((c) => c.wayId === id);
    if (clip) {
      const [a, b] = [ids.indexOf(clip.fromNodeId), ids.indexOf(clip.toNodeId)];
      ids = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    for (let i = 1; i < ids.length; i++) total += haversineMeters(snapshot.nodes.get(ids[i - 1]!)!, snapshot.nodes.get(ids[i]!)!);
  }
  return total;
}

/** The point at `m` metres along the line (clamped). */
function pointAt(line: readonly LatLng[], m: number): LatLng {
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = haversineMeters(line[i - 1]!, line[i]!);
    if (walked + seg >= m && seg > 0) {
      const t = (m - walked) / seg;
      return { lat: line[i - 1]!.lat + t * (line[i]!.lat - line[i - 1]!.lat), lng: line[i - 1]!.lng + t * (line[i]!.lng - line[i - 1]!.lng) };
    }
    walked += seg;
  }
  return line[line.length - 1]!;
}

const hashOf = (kind: string, content: unknown) => sha256Hex(JSON.stringify([kind, content]));

export function buildLinesPlan(input: LinesPlanInput): LinesPlan {
  const { roads, modes } = input;
  const problems = [...roads.problems];
  const roadsDate = ROADS_FILE_RE.exec(roads.fileName)?.[1] ?? "";
  const sourceCode = `OSMR-${roadsDate}`;
  const aliasesHash = hashOf("street_aliases", modes.streetAliases);
  const inputsHash = hashOf("modes-lines-inputs", {
    roads: roads.sha256, modesSeed: modes.sha256, documents: input.documentsHash, osmPlaces: input.osmPlacesSha256,
    trace: TRACE_BUILDER_VERSION, graph: STREET_GRAPH_BUILDER_VERSION,
  });
  const base = {
    roadsFileName: roads.fileName, roadsSha256: roads.sha256, roadsBytes: roads.bytes, roadsDate,
    osmBaseTimestamp: roads.roads?.header.osmBaseTimestamp ?? null, sourceCode,
    snapshotVersion: `modes-lines:${roadsDate}:${modes.seedDate}:${inputsHash.slice(0, 12)}`, revisionLabel: `anywhere-alight-${roadsDate}`,
    inputsHash, aliasesHash,
  };
  const empty = {
    traces: [], walkGraph: null, streetReport: null, routeNotes: [], etaParams: [], regionalDistances: [], regionalWithoutDistance: [],
    traceRules: { landmarks: [], termini: [], placeTerminalFallback: {} }, counts: {},
  };
  if (modes.synthetic) problems.push(`${modes.fileName}: the road outputs are built only with a reviewed (non-synthetic) modes seed`);
  if (!roads.roads || problems.length > 0) return { ...base, ...empty, problems };
  const snapshot = roads.roads;

  // Reviewed aliases must still be confirmed by this snapshot (way exists and carries the name).
  problems.push(...verifyStreetAliases(
    modes.streetAliases.map((a) => ({ legal_name: a.legalName, osm_name: a.osmName, osm_way_ids: a.osmWayIds })), snapshot,
  ).map((p) => `street alias: ${p}`));

  // Time-estimate parameters: every key, or abort.
  for (const key of ETA_PARAM_KEYS) {
    if (!modes.etaParams.some((p) => p.key === key)) problems.push(`time-estimate parameter ${key} is missing from ${modes.fileName}`);
  }
  const etaParams = modes.etaParams.filter((p) => (ETA_PARAM_KEYS as readonly string[]).includes(p.key));
  for (const p of etaParams) {
    if (p.appliesTo.some((a) => a !== "walk" && a !== "jeepney")) problems.push(`time-estimate parameter ${p.key}: applies_to ${p.appliesTo.join(", ")}`);
  }

  // ---------------------------------------------------------------- approximate paths
  const graph = buildRoadGraph(snapshot, { profile: "vehicle" });
  const aliases: StreetAlias[] = modes.streetAliases.map((a) => ({ legalName: a.legalName, osmName: a.osmName }));
  const ctx = buildTraceContext({
    graph, boundary: NAGA_BOUNDARY, aliases, roadPlaces: snapshot.places, osmPlaces: input.osmPlaces,
    terminals: modes.terminals.map((t) => ({ code: t.code, lat: t.lat, lng: t.lng })),
  });
  const byIdentity = new Map(input.identified.map((r) => [r.sourceIdentity, r]));

  const jobs: { key: TraceKey; versionHash: string; trace: TraceInput; pinSeqs: number[] | null }[] = [];
  for (const v of input.variants) {
    const member = v.versions.find((x) => x.isMember);
    if (!member) continue;
    const streets = member.legalStreets.inbound ?? member.legalStreets.outbound ?? member.legalStreets.circuit ?? [];
    const listKey = member.legalStreets.inbound ? "inbound" : member.legalStreets.outbound ? "outbound" : "circuit";
    const pins = member.routeStops.map((s) => {
      const r = byIdentity.get(s.recordIdentity);
      if (!r) problems.push(`${v.routeCode} ${v.direction}: stop ${s.recordIdentity} is not a mapped stop`);
      return { lat: r?.lat ?? 0, lng: r?.lng ?? 0 };
    });
    jobs.push({
      key: { routeCode: v.routeCode, direction: v.direction, kind: v.kind, name: null },
      versionHash: member.contentHash,
      trace: ctx.streetListInput(v.routeCode, listKey, streets, { pins }),
      pinSeqs: member.routeStops.length > 0 ? member.routeStops.map((s) => s.seq) : null,
    });
  }
  for (const r of modes.routes) {
    for (const v of r.variants) {
      jobs.push({
        key: { routeCode: r.publicCode, direction: v.direction, kind: v.kind, name: v.name },
        versionHash: v.contentHash,
        trace: ctx.anchorInput(v.anchors as SeedAnchor[]),
        pinSeqs: null,
      });
    }
  }

  const traces = jobs.map((job): PlannedTrace => {
    const result = traceVariant(job.trace, graph, aliases);
    const inputsHash = hashOf("trace_inputs", { input: job.trace, aliases: aliasesHash, roads: roads.sha256, builder: TRACE_BUILDER_VERSION });
    let row: Omit<PlannedTrace, "contentHash">;
    if (!result.ok) {
      row = {
        ...job.key, variantVersionHash: job.versionHash, mode: result.quality.mode, status: "untraced", flagReason: null,
        untracedReason: result.reason, coords: [], lengthM: null, stopMeasures: null, offListSegments: [], quality: result.quality,
        inputsHash,
      };
    } else {
      const coords = lineCoords(result.line);
      if (coords.length < 2) problems.push(`${job.key.routeCode} ${job.key.direction}: traced line has fewer than 2 points`);
      const stopMeasures = job.pinSeqs === null ? null : job.pinSeqs.map((seq, i): PlannedStopMeasure => {
        const measureM = result.stopMeasures[i];
        if (measureM === undefined) problems.push(`${job.key.routeCode}: no measure for stop ${seq}`);
        const m = measureM ?? 0;
        return { seq, measureM: round(m, 1), snapM: round(haversineMeters(job.trace.pins![i]!, pointAt(result.line, m)), 1) };
      });
      row = {
        ...job.key, variantVersionHash: job.versionHash, mode: result.quality.mode, status: result.status,
        flagReason: result.status === "flagged" ? result.flag : null, untracedReason: null, coords, lengthM: result.lengthM,
        stopMeasures, offListSegments: result.offListSegments, quality: result.quality, inputsHash,
      };
    }
    return { ...row, contentHash: hashOf("shape_version", { ...row, roadSource: sourceCode }) };
  });

  // ---------------------------------------------------------------- street graph v2 (plan E §C)
  let walkGraph: PlannedWalkGraph | null = null;
  let streetReport: StreetReport | null = null;
  try {
    const built = buildStreetGraph(snapshot, modes.roadRules, modes.padyakAreas, { roadSource: sourceCode });
    const payload = JSON.stringify(built.payload);
    const bytes = Buffer.byteLength(payload, "utf8");
    const gzipBytes = gzipSync(payload).length;
    const budget = input.walkGraphBudget ?? { bytes: WALK_GRAPH_MAX_BYTES, gzipBytes: WALK_GRAPH_MAX_GZIP_BYTES };
    if (bytes > budget.bytes) problems.push(`street graph is ${bytes} B of JSON, over the ${budget.bytes} B budget`);
    if (gzipBytes > budget.gzipBytes) problems.push(`street graph is ${gzipBytes} B gzip, over the ${budget.gzipBytes} B budget`);
    if (!walkGraphPayloadSchema.safeParse(built.payload).success) problems.push("street graph payload fails its format v2 schema");
    const sha256 = sha256Hex(payload);
    walkGraph = {
      key: WALK_GRAPH_KEY, formatVersion: 2, payload, bytes, gzipBytes, sha256, nodeCount: built.stats.nodes,
      edgeCount: built.stats.edges, builderVersion: STREET_GRAPH_BUILDER_VERSION, stats: built.stats,
      contentHash: hashOf("walk_graph_version", { sha256, roadSource: sourceCode, builder: STREET_GRAPH_BUILDER_VERSION }),
    };
    const g = decodeWalkGraph(built.payload);
    const grid = [];
    for (let lat = g.bbox[0]; lat <= g.bbox[2]; lat += 90) for (let lng = g.bbox[1]; lng <= g.bbox[3]; lng += 92) grid.push({ lat: lat / 1e5, lng: lng / 1e5 });
    const coverage = padyakAreaCoverage(g, grid);
    const rules = modes.roadRules.map((r) => ({
      code: r.code, kind: r.kind, appliesTo: r.appliesTo[0], geometry: r.geometry, lengthM: r.geometry === "ways" ? ruleLengthM(r, snapshot) : 0,
    }));
    const notesPerRoute: Record<string, number> = {};
    for (const n of modes.routeNotes) notesPerRoute[n.routeCode] = (notesPerRoute[n.routeCode] ?? 0) + 1;
    streetReport = {
      rules, notesPerRoute,
      padyakBannedM: rules.filter((r) => r.appliesTo === "padyak" && r.kind === "exclude").reduce((s, r) => s + r.lengthM, 0),
      areas: coverage.map((c) => ({ ...c, placeNodeIds: modes.padyakAreas.find((a) => a.code === c.code)?.placeNodeIds ?? [] })),
    };
  } catch (error) {
    problems.push(`street graph: ${(error as Error).message}`);
  }

  // ---------------------------------------------------------------- regional distances (D5)
  const regionalDistances: PlannedRegionalDistance[] = [];
  const regionalWithoutDistance: string[] = [];
  for (const s of modes.regionalServices) {
    const rels = s.osmRelationIds.map((id) => snapshot.regionalRelations.find((r) => r.relationId === id));
    if (rels.some((r) => r === undefined)) {
      const missing = s.osmRelationIds.filter((_, i) => rels[i] === undefined);
      regionalWithoutDistance.push(`${s.code}: relation(s) ${missing.join(", ")} not in ${roads.fileName}; distance not on file`);
      continue;
    }
    const found = rels as NonNullable<(typeof rels)[number]>[];
    const shortest = Math.min(...found.map((r) => r.lengthKm));
    const listing = found.map((r) => `relation ${r.relationId} v${r.version} ${r.lengthKm.toFixed(3)} km`).join("; ");
    const distanceBasis =
      `Length of the OpenStreetMap route relation${found.length > 1 ? `s (the shorter of ${found.length} directions is used)` : " (one direction)"}: ` +
      `${listing}. Approximate path length from ${sourceCode}, not a measured trip distance. Map data © OpenStreetMap contributors (ODbL).`;
    const row = { service: s.contentHash, relationVersions: found.map((r) => r.version), distanceKm: shortest, distanceBasis };
    regionalDistances.push({
      service: s, relationVersions: row.relationVersions, distanceKm: shortest, distanceBasis,
      contentHash: hashOf("regional_service_version", row),
    });
  }

  const count = (status: PlannedTrace["status"]) => traces.filter((t) => t.status === status).length;
  const counts: Record<string, number> = {
    variants_traced_ok: count("ok"),
    variants_flagged: count("flagged"),
    variants_untraced: count("untraced"),
    walk_graph_nodes: walkGraph?.nodeCount ?? 0,
    walk_graph_edges: walkGraph?.edgeCount ?? 0,
    walk_graph_bytes: walkGraph?.bytes ?? 0,
    walk_graph_gzip_bytes: walkGraph?.gzipBytes ?? 0,
    route_notes: modes.routeNotes.length,
    eta_params: etaParams.length,
    regional_distances: regionalDistances.length,
    street_aliases: modes.streetAliases.length,
  };

  return {
    ...base, traces, walkGraph, streetReport, routeNotes: modes.routeNotes, etaParams, regionalDistances, regionalWithoutDistance, traceRules: ctx.provenance(), counts, problems,
  };
}

