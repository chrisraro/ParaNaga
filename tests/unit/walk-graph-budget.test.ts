// D7 size budget on the real walk graph, built from the pinned OSM road snapshot, plus a routing
// benchmark (logged, not asserted). Skipped with a message when the snapshot is not on disk;
// Task 15 requires it to run.
import { existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildRoadGraph } from "@/domain/geo/road-graph";
import { decodeWalkGraph, encodeWalkGraph, parseWalkGraph, routeWalk } from "@/domain/walk/walk-graph";
import { buildWalkGraph } from "@/domain/walk/walk-graph-build";
import { readPinnedRoadsSnapshot, ROADS_DIR, ROADS_FILE_RE } from "../../scripts/lib/roads-snapshot";

const MAX_BYTES = 600 * 1024;
const MAX_GZIP_BYTES = 220 * 1024;

const present = existsSync(ROADS_DIR) && readdirSync(ROADS_DIR).some((f) => ROADS_FILE_RE.test(f));
if (!present) console.warn(`walk-graph-budget: skipped, no naga-roads-*.osm.json in ${ROADS_DIR} (required in Task 15)`);

function realGraph() {
  const snapshot = readPinnedRoadsSnapshot();
  if (!snapshot?.roads) throw new Error(`road snapshot refused: ${snapshot?.problems.join("; ")}`);
  const roads = snapshot.roads;
  const roadSource = `OSMR-${ROADS_FILE_RE.exec(snapshot.fileName)![1]}`;
  const { payload, stats } = buildWalkGraph(buildRoadGraph(roads, { profile: "walk" }), { roadSource });
  const json = JSON.stringify(payload);
  return { roads, roadSource, payload, stats, json, bytes: Buffer.byteLength(json, "utf8"), gzip: gzipSync(json).length };
}

describe.skipIf(!present)("walk graph on the real road snapshot", () => {
  const { roads, roadSource, payload, stats, json, bytes, gzip } = present ? realGraph() : ({} as ReturnType<typeof realGraph>);

  it("fits the D7 budget: ≤ 600 KB JSON and ≤ 220 KB gzip", () => {
    console.info(
      `walk graph ${roadSource}: ${stats.nodes} nodes, ${stats.edges} edges, ${payload.geom.length / 2} geometry points; ` +
        `components ${stats.components} (kept ${stats.keptComponents}, dropped ${stats.droppedComponents} with ${stats.droppedNodes} road nodes, ` +
        `${Math.round(stats.droppedLengthM)} m); ${bytes} B JSON, ${gzip} B gzip`,
    );
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(gzip).toBeLessThanOrEqual(MAX_GZIP_BYTES);
  });

  it("is deterministic, parses and round-trips", () => {
    expect(JSON.stringify(buildWalkGraph(buildRoadGraph(roads, { profile: "walk" }), { roadSource }).payload)).toBe(json);
    const parsed = parseWalkGraph(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(encodeWalkGraph(parsed.graph))).toBe(json);
  });

  it("benchmark: 1,000 random origin-destination pairs (logged; target < 30 ms per query)", () => {
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
    for (let i = 0; i < 50; i++) routeWalk(g, randomPoint(), randomPoint()); // warm-up
    const times: number[] = [];
    const kinds: Record<string, number> = {};
    let pathM = 0;
    for (let i = 0; i < 1000; i++) {
      const from = randomPoint();
      const to = randomPoint();
      const s = performance.now();
      const r = routeWalk(g, from, to);
      times.push(performance.now() - s);
      const k = r.kind === "path" ? "path" : r.reason;
      kinds[k] = (kinds[k] ?? 0) + 1;
      if (r.kind === "path") pathM += r.lengthM;
    }
    times.sort((a, b) => a - b);
    const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!.toFixed(2);
    console.info(
      `walk routing (Node ${process.version}): parse+decode ${parseMs.toFixed(1)} ms, decode ${decodeMs.toFixed(1)} ms; ` +
        `per query p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, p99 ${q(0.99)} ms, max ${q(1)} ms; ` +
        `results ${JSON.stringify(kinds)}, mean path ${Math.round(pathM / Math.max(1, kinds.path ?? 0))} m`,
    );
    expect(kinds.path ?? 0).toBeGreaterThan(500);
  }, 60_000);
});
