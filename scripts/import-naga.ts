// pnpm db:import --dry-run | --commit
//
// Imports every Data_Sets/ file of the Naga research package and publishes the provisional
// revision (docs/spec/04-data-model.md §4.7). --dry-run parses, cross-checks and prints the
// counts and conflicts without touching the database. --commit writes everything in one
// transaction as paranaga_import (owner connection, DATABASE_URL_UNPOOLED) and publishes
// through transit.publish_revision; a rerun with the same files writes nothing.
// Any parsing error, integrity issue or cross-check disagreement aborts before any write.
// Connection strings are never printed.
import { buildImportPlan, readDataFiles, type ImportPlan } from "./lib/import-plan";
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
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mode = args.length === 1 && (args[0] === "--dry-run" || args[0] === "--commit") ? args[0] : null;
  if (!mode) {
    console.error("usage: pnpm db:import --dry-run | --commit");
    return 2;
  }

  const plan = buildImportPlan(readDataFiles("Data_Sets"));
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
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`import failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  },
);
