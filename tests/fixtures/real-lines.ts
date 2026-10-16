// The committed real Lines payload (traced approximate paths of the published revision, captured
// for e2e) and its snapshot (Loops A/B pins with D13 measures). Parsed, so a schema drift fails here.
import { readFileSync } from "node:fs";
import { linesSchema, networkSnapshotSchema, type Lines, type NetworkSnapshot } from "@/domain/api/schemas";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../e2e/fixtures/network/${f}`, import.meta.url), "utf8"));

export function realLines(): Lines {
  return linesSchema.parse(read("lines.json"));
}

export function realLinesSnapshot(): NetworkSnapshot {
  return networkSnapshotSchema.parse(read("snapshot.json"));
}
