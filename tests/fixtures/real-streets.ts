// The real street graph v2, built from the pinned OSM road snapshot and the reviewed road rules and
// padyak areas (as the importer builds it), decoded. Throws when the snapshot is not on disk.
import { readFileSync } from "node:fs";
import { parseModesSeed } from "@/domain/import/modes-seed";
import { decodeWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";
import { buildStreetGraph } from "@/domain/walk/walk-graph-build";
import { readPinnedRoadsSnapshot, ROADS_FILE_RE } from "../../scripts/lib/roads-snapshot";

export const MODES_SEED_PATH = "data/source/research/naga-modes-seed-2026-10-16.json";

export function realStreets(): WalkGraph {
  const snapshot = readPinnedRoadsSnapshot();
  if (!snapshot?.roads) throw new Error(`road snapshot refused: ${snapshot?.problems.join("; ")}`);
  const seed = parseModesSeed(JSON.parse(readFileSync(MODES_SEED_PATH, "utf8")));
  const roadSource = `OSMR-${ROADS_FILE_RE.exec(snapshot.fileName)![1]}`;
  return decodeWalkGraph(buildStreetGraph(snapshot.roads, seed.roadRules, seed.padyakAreas, { roadSource }).payload);
}
