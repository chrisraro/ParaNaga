// Size budget on the real street graph v2 (plan E §C: ≤ 800 KB raw, ≤ 260 KB gzip), built from the
// pinned OSM road snapshot and the reviewed road rules and padyak areas, plus a routing benchmark
// per mode (logged, not asserted). Skipped with a message when the snapshot is not on disk.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseModesSeed } from "@/domain/import/modes-seed";
import { decodeWalkGraph, encodeWalkGraph, padyakAreaCoverage, parseWalkGraph, routeStreet, type StreetMode } from "@/domain/walk/walk-graph";
import { buildStreetGraph } from "@/domain/walk/walk-graph-build";
import { readPinnedRoadsSnapshot, ROADS_DIR, ROADS_FILE_RE } from "../../scripts/lib/roads-snapshot";

const MAX_BYTES = 800 * 1024;
const MAX_GZIP_BYTES = 260 * 1024;
const SEED_PATH = "data/source/research/naga-modes-seed-2026-10-16.json";

const present = existsSync(ROADS_DIR) && readdirSync(ROADS_DIR).some((f) => ROADS_FILE_RE.test(f));
if (!present) console.warn(`walk-graph-budget: skipped, no naga-roads-*.osm.json in ${ROADS_DIR} (required in Task 15)`);

function realGraph() {
  const snapshot = readPinnedRoadsSnapshot();
  if (!snapshot?.roads) throw new Error(`road snapshot refused: ${snapshot?.problems.join("; ")}`);
  const roads = snapshot.roads;
  const seed = parseModesSeed(JSON.parse(readFileSync(SEED_PATH, "utf8")));
  const roadSource = `OSMR-${ROADS_FILE_RE.exec(snapshot.fileName)![1]}`;
  const make = () => buildStreetGraph(roads, seed.roadRules, seed.padyakAreas, { roadSource });
  const { payload, stats } = make();
  const json = JSON.stringify(payload);
  return { make, roadSource, payload, stats, json, bytes: Buffer.byteLength(json, "utf8"), gzip: gzipSync(json).length };
}

describe.skipIf(!present)("street graph v2 on the real road snapshot", () => {
  const { make, roadSource, payload, stats, json, bytes, gzip } = present ? realGraph() : ({} as ReturnType<typeof realGraph>);

  it("fits the budget: ≤ 800 KB JSON and ≤ 260 KB gzip", () => {
    console.info(
      `street graph ${roadSource}: ${stats.nodes} nodes, ${stats.edges} edges, ${payload.geom.length / 2} geometry points; ` +
        `components ${stats.components} (kept ${stats.keptComponents}, dropped ${stats.droppedComponents} with ${stats.droppedNodes} road nodes, ` +
        `${Math.round(stats.droppedLengthM)} m); rules ${payload.rules.map((r) => r.code).join(",")}; areas ${payload.areas.map((a) => `${a.code}:${a.radiusM}`).join(" ")}; ` +
        `${bytes} B JSON, ${gzip} B gzip`,
    );
    expect(payload.v).toBe(2);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(gzip).toBeLessThanOrEqual(MAX_GZIP_BYTES);
  });

  it("is deterministic, parses and round-trips", () => {
    expect(JSON.stringify(make().payload)).toBe(json);
    const parsed = parseWalkGraph(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(encodeWalkGraph(parsed.graph))).toBe(json);
  });

  it("benchmark: 1,000 random origin-destination pairs per mode (logged; target < 30 ms per query)", () => {
    const t0 = performance.now();
    const parsed = parseWalkGraph(JSON.parse(json));
    const parseMs = performance.now() - t0;
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const g = parsed.graph;
    const t1 = performance.now();
    decodeWalkGraph(payload);
    const decodeMs = performance.now() - t1;

    // Deterministic PRNG (mulberry32); points jittered up to ±300 m around random graph nodes.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const randomPoint = () => {
      const n = Math.floor(rand() * g.nodeCount);
      return { lat: g.nodeLat[n]! / 1e5 + (rand() - 0.5) * 0.0054, lng: g.nodeLng[n]! / 1e5 + (rand() - 0.5) * 0.0054 };
    };
    const pairs = Array.from({ length: 1000 }, () => [randomPoint(), randomPoint()] as const);
    const lines: string[] = [];
    for (const mode of ["walk", "tricycle", "padyak"] as StreetMode[]) {
      const now = new Date(Date.UTC(2026, 9, 17, 6)); // 14:00 Manila: restrictions apply
      for (let i = 0; i < 50; i++) routeStreet(g, pairs[i]![0], pairs[i]![1], { mode, now }); // warm-up
      const times: number[] = [];
      const kinds: Record<string, number> = {};
      for (const [from, to] of pairs) {
        const s = performance.now();
        const r = routeStreet(g, from, to, { mode, now });
        times.push(performance.now() - s);
        const k = r.kind === "path" ? "path" : r.reason;
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      times.sort((a, b) => a - b);
      const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!.toFixed(2);
      lines.push(`${mode}: p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms, ${JSON.stringify(kinds)}`);
      expect(kinds.path ?? 0).toBeGreaterThan(mode === "walk" ? 500 : 300);
    }
    console.info(`street routing (Node ${process.version}): parse+decode ${parseMs.toFixed(1)} ms, decode ${decodeMs.toFixed(1)} ms; ${lines.join("; ")}`);
    // Padyak area coverage on a 100 m grid over the bbox (logged for the dry run).
    const pts = [];
    for (let lat = g.bbox[0]; lat <= g.bbox[2]; lat += 90) for (let lng = g.bbox[1]; lng <= g.bbox[3]; lng += 92) pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
    console.info(`padyak coverage: ${padyakAreaCoverage(g, pts).map((c) => `${c.code} r${c.radiusM} ${c.resolved}/${c.inside} fp${c.falsePositives}`).join("; ")}`);
  }, 120_000);
});
