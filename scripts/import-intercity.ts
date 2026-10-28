// pnpm db:import-intercity --dry-run | --commit
//
// Imports the newest reviewed intercity seed (data/source/research/naga-intercity-seed-YYYY-MM-DD.json,
// IC1) into the OPEN DRAFT revision (scripts/lib/intercity-writer.ts). It never publishes: the
// draft goes through the admin console (validate, step-up, second reviewer).
//
// --dry-run reads the open draft in a read-only transaction and prints the review sheet: the
// counts, every excluded record with its reason, and one line per import decision (identity and
// version new or reused, member added / repointed / unchanged), then any problem. Nothing is written.
// --commit is refused unless the seed's header.reviewStatus is owner_approved (only the owner sets
// it), the seed is not synthetic and a draft is open; the same file again reports "unchanged".
// Both modes connect as the owner (DATABASE_URL_UNPOOLED) and act as paranaga_import.
// Connection strings are never printed.
import {
  buildIntercityPlan,
  commitIntercity,
  dryRunIntercity,
  INTERCITY_DIR,
  readNewestIntercitySeed,
  type IntercityPlan,
} from "./lib/intercity-writer";

const redact = (text: string) => text.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>");

function printPlan(plan: IntercityPlan) {
  console.log(`intercity seed: ${plan.fileName}  sha256 ${plan.sha256}  ${plan.bytes} bytes`);
  console.log(`  batch key ${plan.snapshotVersion}`);
  console.log("counts:");
  for (const [k, v] of Object.entries(plan.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(`excluded by review (${plan.excluded.length}, never written):`);
  for (const e of plan.excluded) console.log(`  ${e}`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mode = args.length === 1 && (args[0] === "--dry-run" || args[0] === "--commit") ? args[0] : null;
  if (!mode) {
    console.error("usage: pnpm db:import-intercity --dry-run | --commit");
    return 2;
  }
  const file = readNewestIntercitySeed();
  if (!file) {
    console.error(`no naga-intercity-seed-YYYY-MM-DD.json in ${INTERCITY_DIR}`);
    return 1;
  }
  const plan = buildIntercityPlan(file);
  printPlan(plan);
  if (plan.problems.length > 0) {
    console.error(`\nABORTED: ${plan.problems.length} problem(s); nothing written:`);
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED is required (owner role, direct endpoint).");
    return 1;
  }

  const dry = await dryRunIntercity(url, plan);
  console.log(`draft revision: ${dry.draft ? `${dry.draft.label} (${dry.draft.id})` : "(none open)"}`);
  console.log(`import decisions (${dry.decisions.length}):`);
  for (const d of dry.decisions) console.log(`  ${d}`);
  if (dry.problems.length > 0) {
    console.error(`\nABORTED: ${dry.problems.length} problem(s); nothing written:`);
    for (const p of dry.problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  if (mode === "--dry-run") {
    if (dry.commitProblems.length > 0) {
      console.log("\na commit would be refused:");
      for (const p of dry.commitProblems) console.log(`  - ${p}`);
    }
    console.log("\ndry run: no problems found; nothing written");
    return 0;
  }

  const result = await commitIntercity(url, plan);
  if (result.outcome === "unchanged") {
    console.log(`\nunchanged: the file matches committed batch ${result.batchId}; nothing written`);
  } else {
    console.log(`\ncommitted batch ${result.batchId} into draft ${result.draftId} (not published)`);
    for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
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
