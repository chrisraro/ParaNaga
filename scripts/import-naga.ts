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
// Connection strings are never printed.
import {
  buildImportPlan,
  MODES_DIR,
  OSM_DIR,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  type ImportPlan,
} from "./lib/import-plan";
import { commitImport } from "./lib/import-writer";

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

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mode = args.length === 1 && (args[0] === "--dry-run" || args[0] === "--commit") ? args[0] : null;
  if (!mode) {
    console.error("usage: pnpm db:import --dry-run | --commit");
    return 2;
  }

  const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot(), readNewestModesSeed());
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
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`import failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  },
);
