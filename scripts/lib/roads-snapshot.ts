// Reads the committed OpenStreetMap road snapshot for the importer and the preview script.
// Refuses (problems) unless the file's sha256 equals its pin below (the README table row) and the
// parser reports no problems. Add a pin only after reviewing a new dated snapshot.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseOsmRoads, type OsmRoads } from "../../src/domain/import/osm-roads";

export const ROADS_DIR = "data/source/osm";
export const ROADS_FILE_RE = /^naga-roads-(\d{4}-\d{2}-\d{2})\.osm\.json$/;

/** sha256 of each reviewed, committed road snapshot (data/source/osm/README.md). */
export const ROADS_SNAPSHOT_PINS: Readonly<Record<string, string>> = {
  "naga-roads-2026-10-16.osm.json": "4c270b87dc1b9b91d81a4b1bb314918cc76b42c98f64e4b7fcf606effd30a469",
};

export type RoadsSnapshot = { fileName: string; sha256: string; bytes: number; roads: OsmRoads | null; problems: string[] };

/** Checks one snapshot's bytes against its pin and parses it. `roads` is null when there are problems. */
export function checkRoadsSnapshot(fileName: string, bytes: Buffer, pins: Readonly<Record<string, string>> = ROADS_SNAPSHOT_PINS): RoadsSnapshot {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const problems: string[] = [];
  if (!ROADS_FILE_RE.test(fileName)) problems.push(`${fileName}: not named naga-roads-YYYY-MM-DD.osm.json`);
  const pin = pins[fileName];
  if (pin === undefined) problems.push(`${fileName}: no sha256 pin (scripts/lib/roads-snapshot.ts); review the snapshot and pin it`);
  else if (pin !== sha256) problems.push(`${fileName}: sha256 ${sha256} does not match its pin ${pin}`);
  let roads: OsmRoads | null = null;
  if (problems.length === 0) {
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      problems.push(`${fileName}: not valid JSON`);
    }
    if (problems.length === 0) {
      const parsed = parseOsmRoads(json);
      problems.push(...parsed.problems.map((p) => `${fileName}: ${p}`));
      if (parsed.synthetic) problems.push(`${fileName}: a synthetic snapshot is never imported`);
      if (problems.length === 0) roads = parsed;
    }
  }
  return { fileName, sha256, bytes: bytes.length, roads, problems };
}

/** The newest `naga-roads-YYYY-MM-DD.osm.json` in `dir`, checked; null when there is none. */
export function readPinnedRoadsSnapshot(dir: string = ROADS_DIR): RoadsSnapshot | null {
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir).filter((f) => ROADS_FILE_RE.test(f)).sort().at(-1);
  if (!newest) return null;
  return checkRoadsSnapshot(newest, readFileSync(path.join(dir, newest)));
}
