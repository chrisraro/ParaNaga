// pnpm db:import --dry-run | --commit
//
// Imports every Data_Sets/ file of the Naga research package and publishes the provisional
// revision (docs/spec/04-data-model.md §4.7). --dry-run parses, cross-checks and prints the
// counts and conflicts without touching the database. --commit writes everything in one
// transaction as paranaga_import (owner connection, DATABASE_URL_UNPOOLED) and publishes
// through transit.publish_revision; a rerun with the same files writes nothing.
// Any parsing error, integrity issue or cross-check disagreement aborts before any write.
//
// OpenStreetMap places: the newest committed data/source/osm/naga-places-YYYY-MM-DD.osm.json (if
// any) is read too; no network call is ever made here. With transit unchanged and a new snapshot,
// --commit publishes a new revision osm-places-<date> that carries the transit data forward
// (scripts/lib/import-writer.ts). Without a snapshot file, places are skipped.
//
// Reviewed modes seed: the newest data/source/research/naga-modes-seed-YYYY-MM-DD.json (if any).
// Only records with review.decision = "import" are written; the dry run prints the excluded
// records with their reason, the counts and the conflicts register. --commit publishes a new
// revision modes-<date> that carries the published revision forward (scripts/lib/modes-writer.ts).
//
// Road snapshot (Task 7): the newest sha256-pinned data/source/osm/naga-roads-YYYY-MM-DD.osm.json
// (refused unless it matches its pin, parses, and confirms the reviewed street aliases). The dry
// run prints one row per variant (pass/flagged/untraced, coverage, off-list share, length, snap),
// the street graph v2 (nodes, edges, bytes against the budget), the metres each road rule covers,
// the padyak areas with their place nodes and coverage, the notes per route, the time-estimate
// parameters and the regional relation lengths. Untraced variants are reported, never an abort; an
// over-budget graph, a road-rule way missing from the snapshot or a missing time-estimate parameter
// aborts. --commit publishes anywhere-alight-<roads date> (scripts/lib/lines-writer.ts).
// Connection strings are never printed.
import {
  buildImportPlan,
  MODES_DIR,
  OSM_DIR,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  readPinnedRoadsSnapshot,
  ROADS_DIR,
  type ImportPlan,
} from "./lib/import-plan";
import { commitImport } from "./lib/import-writer";
import { WALK_GRAPH_MAX_BYTES, WALK_GRAPH_MAX_GZIP_BYTES } from "./lib/lines-plan";

const redact = (text: string) => text.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>");

function printPlan(plan: ImportPlan) {
  console.log(`snapshot ${plan.snapshotVersion}`);
  console.log(`revision ${plan.revisionLabel}`);
  for (const d of plan.documents) console.log(`  document ${d.fileName}  sha256 ${d.sha256}  ${d.bytes} bytes`);
  console.log("counts:");
  for (const [k, v] of Object.entries(plan.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
  for (const [k, v] of Object.entries(plan.deferred)) console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(`conflicts (${plan.conflicts.length}, recorded for review, never auto-resolved):`);
  for (const c of plan.conflicts) {
    const records = (c.detail.records as { sourceLayer: string; code: string; label: string }[] | undefined) ??
      [{ sourceLayer: String(c.detail.sourceLayer), code: String(c.detail.code), label: String(c.detail.label) }];
    const meters = typeof c.detail.meters === "number" ? ` ${c.detail.meters} m` : "";
    console.log(`  ${c.kind}${meters}: ${records.map((r) => `${r.sourceLayer}/${r.code} "${r.label}"`).join(" | ")}`);
  }
  console.log(`fare conflicts: ${plan.seed.fareConflicts.map((f) => `${f.observationCode} vs ${f.ruleCode} (${f.status})`).join(", ")}`);
  printModes(plan);
  printLines(plan);
  const osm = plan.osm;
  if (!osm) {
    console.log(`OpenStreetMap places: no snapshot in ${OSM_DIR}; skipped`);
    return;
  }
  console.log(`OpenStreetMap places: ${osm.fileName}${osm.synthetic ? "  (SYNTHETIC test data: publish will be refused)" : ""}`);
  console.log(`  document ${osm.fileName}  sha256 ${osm.sha256}  ${osm.bytes} bytes`);
  console.log(`  snapshot ${osm.snapshotVersion}  source ${osm.sourceCode}  revision ${osm.revisionLabel}`);
  console.log(`  places kept ${osm.places.length}:`);
  for (const [k, v] of Object.entries(osm.counts)) console.log(`    ${k.padEnd(32)} ${v}`);
  console.log("  dropped:");
  for (const [k, v] of Object.entries(osm.dropped)) console.log(`    ${k.padEnd(32)} ${v}`);
}

function printModes(plan: ImportPlan) {
  const modes = plan.modes;
  if (!modes) {
    console.log(`modes seed: no reviewed seed in ${MODES_DIR}; skipped`);
    return;
  }
  console.log(`modes seed: ${modes.fileName}${modes.synthetic ? "  (SYNTHETIC test data: publish will be refused)" : ""}`);
  console.log(`  document ${modes.fileName}  sha256 ${modes.sha256}  ${modes.bytes} bytes`);
  console.log(`  snapshot ${modes.snapshotVersion}  revision ${modes.revisionLabel}`);
  console.log("  counts:");
  for (const [k, v] of Object.entries(modes.counts)) console.log(`    ${k.padEnd(32)} ${v}`);
  console.log("  deferred:");
  for (const [k, v] of Object.entries(modes.deferred)) console.log(`    ${k.padEnd(32)} ${v}`);
  console.log(`  excluded by review (${modes.excluded.length}, never written):`);
  for (const e of modes.excluded) console.log(`    ${e}`);
  console.log(`  conflicts register (${modes.conflicts.length}, recorded for review):`);
  for (const c of modes.conflicts) console.log(`    ${c.code} ${c.topic}: ${c.description} [${c.sourceCodes.join(", ")}]`);
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(100 * v).toFixed(1)} %`);

function printLines(plan: ImportPlan) {
  const lines = plan.lines;
  if (!lines) {
    console.log(`road snapshot: none in ${ROADS_DIR}; paths, walk graph and time-estimate parameters skipped`);
    return;
  }
  console.log(`road snapshot: ${lines.roadsFileName}  sha256 ${lines.roadsSha256}  ${lines.roadsBytes} bytes (pinned)`);
  console.log(`  source ${lines.sourceCode}  snapshot ${lines.snapshotVersion}  revision ${lines.revisionLabel}`);
  console.log("  approximate paths (\"Approximate path, not a verified route shape\"; untraced variants are reported, not an abort):");
  console.log("    variant                                   result                 streets  off-list (gate/raw)  km      max snap m");
  for (const t of lines.traces) {
    const q = t.quality;
    const id = `${t.routeCode} ${t.direction}${t.kind === "trial" ? " trial" : ""}${t.name ? ` "${t.name}"` : ""}`;
    const result = t.status === "untraced" ? `untraced (${t.untracedReason})` : t.status === "flagged" ? `flagged (${t.flagReason})` : "pass";
    const streets = q.listedStreets > 0 ? `${q.matchedStreets}/${q.listedStreets}` : "n/a";
    console.log(`    ${id.slice(0, 41).padEnd(41)} ${result.padEnd(22)} ${streets.padEnd(8)} ${`${pct(q.gateOffListShare)} / ${pct(q.offListShare)}`.padEnd(20)} ${(t.lengthM === null ? "–" : (t.lengthM / 1000).toFixed(2)).padEnd(7)} ${q.maxSnapM ?? "–"}`);
    const notes = [...q.unmatchedStreets.map((x) => `unmatched ${x}`), ...q.anchorsUnresolved.map((x) => `anchor ${x}`),
      ...q.landmarksUnresolved.map((x) => `landmark ${x}`)];
    if (notes.length > 0) console.log(`      ${notes.join("; ")}`);
  }
  const wg = lines.walkGraph;
  if (wg) {
    console.log(`  street graph ${wg.key} v${wg.formatVersion}: ${wg.nodeCount} nodes, ${wg.edgeCount} edges, ${wg.bytes} B JSON (budget ${WALK_GRAPH_MAX_BYTES}), ` +
      `${wg.gzipBytes} B gzip (budget ${WALK_GRAPH_MAX_GZIP_BYTES}), sha256 ${wg.sha256}`);
  }
  const sr = lines.streetReport;
  if (sr) {
    console.log("  road rules (metres of snapshot ways covered; restricted = exclude, exempt = exemption):");
    for (const r of sr.rules) console.log(`    ${r.code.padEnd(18)} ${r.kind.padEnd(8)} ${r.geometry.padEnd(10)} ${Math.round(r.lengthM)} m`);
    console.log(`    padyak-banned total ${Math.round(sr.padyakBannedM)} m`);
    console.log("  padyak areas (place nodes; sample points inside the area resolved to it / inside; false positives):");
    for (const a of sr.areas) console.log(`    ${a.code} r${a.radiusM} m  nodes ${a.placeNodeIds.join(",") || "none"}  ${a.resolved}/${a.inside}  fp ${a.falsePositives}`);
    console.log(`  route notes (${lines.routeNotes.length}): ${Object.entries(sr.notesPerRoute).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  }
  console.log(`  time-estimate parameters (${lines.etaParams.length}):`);
  for (const p of lines.etaParams) {
    const value = p.unit === "windows" ? (p.windows ?? []).map((w) => `${w.start}–${w.end}`).join(", ") : `${p.valueLow}–${p.valueHigh} ${p.unit}`;
    console.log(`    ${p.key.padEnd(28)} ${value}  [${p.sourceCodes.join(", ") || "no source"}]${p.isAssumption ? `  assumption: ${p.assumptionNote}` : ""}`);
  }
  console.log("  regional relation lengths (D5, shorter direction):");
  for (const d of lines.regionalDistances) console.log(`    ${d.service.code} ${d.service.name}: ${d.distanceKm} km`);
  for (const r of lines.regionalWithoutDistance) console.log(`    ${r}`);
  console.log("  review decisions used (recorded in the batch):");
  for (const l of lines.traceRules.landmarks) console.log(`    landmark "${l.item}" (${l.rule}): ${l.resolved ? "resolved" : "unresolved"}, ${l.note}`);
  for (const t of lines.traceRules.termini) console.log(`    terminus ${t.routeCode} → ${t.place}: ${t.resolved ? "resolved" : "unresolved"}, ${t.note}`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mode = args.length === 1 && (args[0] === "--dry-run" || args[0] === "--commit") ? args[0] : null;
  if (!mode) {
    console.error("usage: pnpm db:import --dry-run | --commit");
    return 2;
  }

  const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot(), readNewestModesSeed(), readPinnedRoadsSnapshot());
  printPlan(plan);
  if (plan.problems.length > 0) {
    console.error(`\nABORTED: ${plan.problems.length} problem(s); nothing written:`);
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  if (mode === "--dry-run") {
    console.log("\ndry run: no problems found; nothing written");
    return 0;
  }

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED is required for --commit (owner role, direct endpoint).");
    return 1;
  }
  const result = await commitImport(url, plan);
  if (result.outcome === "unchanged") {
    console.log(`\nunchanged: files match committed batch ${result.batchId}; nothing written`);
    for (const [k, v] of Object.entries(result.counts)) console.log(`  unchanged ${k.padEnd(34)} ${v}`);
    console.log(`published revision: ${result.publishedRevisionLabel ?? "(none)"}`);
  } else {
    console.log(`\ncommitted batch ${result.batchId}`);
    console.log(`  added ${"revision_members".padEnd(34)} ${result.counts.revision_members}`);
    console.log(`published revision: ${result.revisionLabel} (${result.revisionId})`);
  }
  const places = result.places;
  if (places?.outcome === "unchanged") {
    console.log(`\nplaces unchanged: snapshot matches committed batch ${places.batchId}; nothing written (${places.counts.places} places)`);
    console.log(`  batch revision: ${places.revisionLabel ?? "(unknown)"}; published revision: ${places.publishedRevisionLabel ?? "(none)"}`);
    if (!places.publishedIncludesBatch) {
      console.warn(
        `  WARNING: the published revision is not ${places.revisionLabel ?? "the batch's revision"} (rolled back?); ` +
          "these places are NOT published now. Re-publish that revision with transit.publish_revision if intended.",
      );
    }
  } else if (places?.outcome === "committed") {
    console.log(`\nplaces committed batch ${places.batchId}`);
    for (const [k, v] of Object.entries(places.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
    console.log(`published revision: ${places.revisionLabel} (${places.revisionId})`);
  }
  const modes = result.modes;
  if (modes?.outcome === "unchanged") {
    console.log(`
modes seed unchanged: file matches committed batch ${modes.batchId}; nothing written`);
    console.log(`  batch revision: ${modes.revisionLabel ?? "(unknown)"}; published revision: ${modes.publishedRevisionLabel ?? "(none)"}`);
    if (!modes.publishedIncludesBatch) {
      console.warn(
        `  WARNING: the published revision does not hold this seed's records (rolled back?); re-publish ` +
          `${modes.revisionLabel ?? "the batch's revision"} with transit.publish_revision if intended.`,
      );
    }
  } else if (modes?.outcome === "committed") {
    console.log(`
modes seed committed batch ${modes.batchId}`);
    for (const [k, v] of Object.entries(modes.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
    console.log(`published revision: ${modes.revisionLabel} (${modes.revisionId})`);
  }
  const lines = result.lines;
  if (lines?.outcome === "unchanged") {
    console.log(`
road outputs unchanged: inputs match committed batch ${lines.batchId}; nothing written`);
    console.log(`  batch revision: ${lines.revisionLabel ?? "(unknown)"}; published revision: ${lines.publishedRevisionLabel ?? "(none)"}`);
    if (!lines.publishedIncludesBatch) {
      console.warn(
        `  WARNING: the published revision does not hold these paths (rolled back?); re-publish ` +
          `${lines.revisionLabel ?? "the batch's revision"} with transit.publish_revision if intended.`,
      );
    }
  } else if (lines?.outcome === "committed") {
    console.log(`
road outputs committed batch ${lines.batchId}`);
    for (const [k, v] of Object.entries(lines.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
    console.log(`published revision: ${lines.revisionLabel} (${lines.revisionId})`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`import failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  },
);
