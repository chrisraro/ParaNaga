// Street graph v2 (plan E §C): tricycle direction and restriction windows, exempt crossings, padyak
// bans and areas, v1 compatibility, A* = Dijkstra per mode, boundedDistances = routeStreet.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";
import type { ModesSeedPadyakArea, ModesSeedRoadRule } from "@/domain/import/modes-seed";
import type { PlaceNode, RoadWay } from "@/domain/import/osm-roads";
import { FLAG_PADYAK_BANNED, FLAG_PADYAK_CLASS, FLAG_RULE_SHIFT, FLAG_TRI_AB, FLAG_TRI_BA, FLAG_WALK, walkGraphPayloadSchema } from "@/domain/walk/format";
import { ruleLifted } from "@/domain/walk/rules";
import {
  boundedDistances, decodeWalkGraph, encodeWalkGraph, padyakAreaCoverage, padyakAreas, parseWalkGraph, routeStreet, snapStreet,
  type StreetMode, type WalkGraph, type WalkSnap,
} from "@/domain/walk/walk-graph";
import { buildStreetGraph, buildWalkGraph } from "@/domain/walk/walk-graph-build";
import { fakeRoadGraph, gridRoadGraph } from "./walk-graph-fixtures";

type Tags = RoadWay["tags"];
type Net = { nodes: Map<number, LatLng>; ways: RoadWay[]; places: PlaceNode[] };

function net(points: Record<number, [number, number]>, ways: [number, number[], Tags][], places: PlaceNode[] = []): Net {
  return {
    nodes: new Map(Object.entries(points).map(([id, [lat, lng]]) => [Number(id), { lat, lng }])),
    ways: ways.map(([id, nodeIds, tags]) => ({ id, version: 1, timestamp: "2026-10-16T00:00:00Z", nodeIds, tags })),
    places,
  };
}

const review = { decision: "import" as const, reason: "test", reviewedOn: "2026-10-17" };
function rule(code: string, kind: "exclude" | "exempt", wayIds: number[], extra: Partial<ModesSeedRoadRule> = {}): ModesSeedRoadRule {
  const padyak = code.startsWith("PADYAK");
  return {
    code, ruleCode: padyak ? "PADYAK-SEC132" : "TRI-2006", kind, appliesTo: padyak ? ["padyak"] : ["tricycle"], streets: ["Test St"], ruleText: "test",
    enacted: "2006", exceptWindow: !padyak && kind === "exclude" ? { from: "21:00", to: "05:00" } : null, geometry: wayIds.length > 0 ? "ways" : "not_mapped",
    wayIds, clips: [], junctionNodeId: null, clipNote: "test", evidence: "official", sourceCodes: padyak ? ["RP01"] : ["RT01", "RT02"], review, ...extra,
  };
}
function area(code: string, placeNodeIds: number[], radiusM?: number): ModesSeedPadyakArea {
  return { code, area: code, associations: [], barangays: [code], placeNodeIds, documentedYear: 2001, evidence: "official", sourceCodes: ["RP01"], review, ...(radiusM ? { radiusM } : {}) };
}

const build = (n: Net, rules: ModesSeedRoadRule[] = [], areas: ModesSeedPadyakArea[] = []) => buildStreetGraph(n, rules, areas, { roadSource: "TEST", minComponentNodes: 1 });
const graph = (n: Net, rules: ModesSeedRoadRule[] = [], areas: ModesSeedPadyakArea[] = []) => decodeWalkGraph(build(n, rules, areas).payload);
/** A date at hh:mm Manila (UTC+8) on 2026-10-17. */
const manila = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 17, hh - 8, mm));
const NOON = manila(12);
const ll = ([lat, lng]: [number, number]): LatLng => ({ lat, lng });

// A —primary (restricted TRI-2006, Sec 132 banned)— B, with the middle M1–M2 exempt (clip) and a
// residential side street crossing at M1; a residential detour A–C–D–B north of it.
const A: [number, number] = [13.62, 123.19];
const M1: [number, number] = [13.62, 123.191];
const M2: [number, number] = [13.62, 123.192];
const B: [number, number] = [13.62, 123.193];
const C: [number, number] = [13.623, 123.19];
const D: [number, number] = [13.623, 123.193];
const S: [number, number] = [13.619, 123.191];
const N: [number, number] = [13.621, 123.191];
const roxas = net({ 1: A, 2: M1, 3: M2, 4: B, 5: C, 6: D, 7: S, 8: N }, [
  [100, [1, 2, 3, 4], { highway: "primary", name: "Roxas Avenue" }],
  [101, [1, 5, 6, 4], { highway: "residential" }],
  [102, [7, 2, 8], { highway: "residential" }],
]);
const roxasRules = [
  rule("TRI-2006-P3", "exclude", [100]),
  rule("TRI-2006-X4", "exempt", [100], { clips: [{ wayId: 100, fromNodeId: 2, toNodeId: 3 }] }),
  rule("TRI-2006-X2", "exempt", [], { geometry: "junction", junctionNodeId: 2 }),
  rule("PADYAK-SEC132-3", "exclude", [100]),
];
const DIRECT = haversineMeters(ll(A), ll(B));
const DETOUR = haversineMeters(ll(A), ll(C)) + haversineMeters(ll(C), ll(D)) + haversineMeters(ll(D), ll(B));

describe("tricycle profile: one-way", () => {
  // P → Q one-way (oneway:psv=no does not apply to tricycles), detour P–R–T–Q two-way.
  const P: [number, number] = [13.63, 123.19];
  const Q: [number, number] = [13.63, 123.192];
  const R: [number, number] = [13.632, 123.19];
  const T: [number, number] = [13.632, 123.192];
  const g = graph(
    net({ 11: P, 12: Q, 13: R, 14: T }, [
      [200, [11, 12], { highway: "residential", oneway: "yes", "oneway:psv": "no" }],
      [201, [11, 13, 14, 12], { highway: "residential" }],
    ]),
  );
  const direct = haversineMeters(ll(P), ll(Q));

  it("tricycle uses the one-way street only forward; walking uses it both ways", () => {
    const fwd = routeStreet(g, ll(P), ll(Q), { mode: "tricycle", now: NOON });
    const back = routeStreet(g, ll(Q), ll(P), { mode: "tricycle", now: NOON });
    expect(fwd).toMatchObject({ kind: "path", usedRules: [], usesNationalRoad: false });
    if (fwd.kind === "path") expect(fwd.lengthM).toBeCloseTo(direct, 0);
    if (back.kind === "path") expect(back.lengthM).toBeGreaterThan(2.5 * direct);
    expect(back.kind).toBe("path");
    const walk = routeStreet(g, ll(Q), ll(P), { mode: "walk", now: NOON });
    expect(walk.kind === "path" && walk.lengthM).toBeCloseTo(direct, 0);
  });
});

describe("tricycle restriction windows (Manila clock)", () => {
  const g = graph(roxas, roxasRules);
  const at = (now: Date) => routeStreet(g, ll(A), ll(B), { mode: "tricycle", now });

  it("a restricted way is avoided at 14:00 and 05:00, used at 22:00 and 04:59", () => {
    for (const now of [manila(14), manila(5)]) {
      const r = at(now);
      expect(r).toMatchObject({ kind: "path", usedRules: [] });
      if (r.kind === "path") expect(r.lengthM).toBeCloseTo(DETOUR, 0);
    }
    for (const now of [manila(22), manila(4, 59), manila(21)]) {
      const r = at(now);
      expect(r).toMatchObject({ kind: "path", usedRules: ["TRI-2006"], usesNationalRoad: true });
      if (r.kind === "path") expect(r.lengthM).toBeCloseTo(DIRECT, 0);
    }
  });

  it("windows read only the epoch (no host time zone)", () => {
    const lifted = { liftedFrom: "21:00", liftedTo: "05:00" };
    expect([20.99, 21, 4.99, 5].map((h) => ruleLifted(lifted, new Date(Date.UTC(2026, 0, 1, 0, Math.round(h * 60)) - 8 * 3600_000)))).toEqual([false, true, true, false]);
    expect(ruleLifted({ liftedFrom: null, liftedTo: null }, manila(23))).toBe(false);
  });

  it("an exempt crossing stays usable at noon: the clipped exempt segment and a junction crossing", () => {
    const along = routeStreet(g, { lat: 13.62005, lng: 123.1911 }, { lat: 13.62005, lng: 123.1919 }, { mode: "tricycle", now: NOON });
    expect(along).toMatchObject({ kind: "path", usedRules: [], usesNationalRoad: true });
    if (along.kind === "path") expect(along.lengthM).toBeLessThan(100);
    const across = routeStreet(g, ll(S), ll(N), { mode: "tricycle", now: NOON });
    expect(across).toMatchObject({ kind: "path", usedRules: [] });
    if (across.kind === "path") expect(across.lengthM).toBeCloseTo(haversineMeters(ll(S), ll(N)), 0);
  });

  it("carries the rule once, with its label, sources and window", () => {
    expect(build(roxas, roxasRules).payload.rules).toEqual([
      { code: "TRI-2006", label: "Ordinance 2006-005/015 · check for updates", sourceCodes: ["RT01", "RT02"], liftedFrom: "21:00", liftedTo: "05:00" },
    ]);
  });

  it("aborts when a listed way is not in the snapshot", () => {
    expect(() => build(roxas, [rule("TRI-2006-P2", "exclude", [999])])).toThrow(/way\/999/);
  });
});

describe("padyak", () => {
  const g = graph(roxas, roxasRules);
  it("never uses a Sec 132 banned way; walking does", () => {
    for (const now of [NOON, manila(23)]) {
      const r = routeStreet(g, ll(A), ll(B), { mode: "padyak", now });
      expect(r.kind === "path" && r.lengthM).toBeCloseTo(DETOUR, 0);
    }
    const w = routeStreet(g, ll(A), ll(B), { mode: "walk", now: NOON });
    expect(w.kind === "path" && w.lengthM).toBeCloseTo(DIRECT, 0);
  });

  it("does not ride footways", () => {
    const fw = graph(net({ 1: A, 2: B }, [[1, [1, 2], { highway: "footway" }]]));
    expect(routeStreet(fw, ll(A), ll(B), { mode: "padyak", now: NOON })).toMatchObject({ kind: "straight", reason: "no_mode_data" });
    expect(routeStreet(fw, ll(A), ll(B), { mode: "walk", now: NOON }).kind).toBe("path");
  });
});

describe("padyak areas (effective radius, overlapping anchors)", () => {
  // X at A; Y 500 m east; Z about 2 km east; Z2 a second anchor of Z.
  const place = (id: number, lat: number, lng: number): PlaceNode => ({ id, name: `P${id}`, place: "village", lat, lng });
  const X = place(901, 13.62, 123.19);
  const Y = place(902, 13.62, 123.1946);
  const Z = place(903, 13.62, 123.2085);
  const Z2 = place(904, 13.625, 123.2085);
  const roads = net({ 1: A, 2: B }, [[1, [1, 2], { highway: "residential" }]], [X, Y, Z, Z2]);
  const areas = [area("PA02", [902]), area("PA01", [901]), area("PA03", [903, 904])];

  it("radius = min(seed ?? 1000, max(250, 0.6 × nearest other anchor)); areas sorted by code", () => {
    const p = build(roads, [], areas).payload;
    const xy = haversineMeters(X, Y);
    const yz = haversineMeters(Y, Z);
    expect(p.areas).toEqual([
      { code: "PA01", radiusM: Math.floor(Math.max(250, 0.6 * xy)) },
      { code: "PA02", radiusM: Math.floor(Math.max(250, 0.6 * xy)) },
      { code: "PA03", radiusM: Math.floor(Math.min(1000, 0.6 * yz)) },
    ]);
    expect(p.places).toEqual([
      [901, 1362000, 12319000, 0],
      [902, 1362000, 12319460, 1],
      [903, 1362000, 12320850, 2],
      [904, 1362500, 12320850, 2],
    ]);
    expect(build(roads, [], [areas[0]!, areas[1]!, area("PA03", [903, 904], 400)]).payload.areas[2]).toEqual({ code: "PA03", radiusM: 400 });
    const tiny = build(net({ 1: A, 2: B }, [[1, [1, 2], { highway: "residential" }]], [X, place(905, 13.62, 123.1902)]), [], [area("PA01", [901]), area("PA02", [905])]).payload;
    expect(tiny.areas.map((a) => a.radiusM)).toEqual([250, 250]);
  });

  it("a point is in every area within its radius of any anchor; a third area's disc does not leak", () => {
    const g = graph(roads, [], areas);
    expect(padyakAreas(g, { lat: 13.62, lng: 123.1901 })).toEqual([0]);
    expect(padyakAreas(g, { lat: 13.62, lng: 123.1923 })).toEqual([0, 1]); // midway: both discs (300 m each)
    expect(padyakAreas(g, { lat: 13.6248, lng: 123.2085 })).toEqual([2]); // second anchor of PA03
    expect(padyakAreas(g, { lat: 13.62, lng: 123.1985 })).toEqual([]); // 1,000 m disc would have said PA02
    expect(padyakAreas(g, { lat: 13.64, lng: 123.19 })).toEqual([]);
  });

  it("coverage: recall per area and false positives against the nearest anchor within 1,000 m", () => {
    const g = graph(roads, [], areas);
    const cov = padyakAreaCoverage(g, [
      { lat: 13.62, lng: 123.1901 }, // PA01 nearest, in PA01
      { lat: 13.62, lng: 123.1922 }, // PA01 nearest (by a hair), in PA01 and PA02 → PA02 false positive
      { lat: 13.62, lng: 123.1985 }, // PA02 nearest within 1,000 m, outside every disc
      { lat: 13.62, lng: 123.2085 }, // PA03
    ]);
    expect(cov.map(({ code, inside, resolved, falsePositives }) => [code, inside, resolved, falsePositives])).toEqual([
      ["PA01", 2, 2, 0],
      ["PA02", 1, 0, 1],
      ["PA03", 1, 1, 0],
    ]);
  });

  it("v1 graphs have no areas", () => {
    expect(padyakAreas(decodeWalkGraph(buildWalkGraph(fakeRoadGraph([A, B], [{ a: 0, b: 1 }]), { roadSource: "T" }).payload), ll(A))).toEqual([]);
  });
});

describe("format v2 and v1 compatibility", () => {
  const good = build(roxas, roxasRules).payload;

  it("v2 is deterministic, validates and round-trips; flags carry walk, both tricycle directions, padyak class and rules", () => {
    expect(walkGraphPayloadSchema.safeParse(good).success).toBe(true);
    const shuffled = { ...roxas, ways: [...roxas.ways].reverse() };
    expect(JSON.stringify(build(shuffled, [...roxasRules].reverse()).payload)).toBe(JSON.stringify(good));
    expect(JSON.stringify(encodeWalkGraph(decodeWalkGraph(good)))).toBe(JSON.stringify(good));
    const restricted = good.flags.filter((f) => f >> FLAG_RULE_SHIFT === 1);
    expect(restricted.length).toBe(2); // A–M1 and M2–B; the exempt M1–M2 has no rule
    for (const f of restricted) expect(f & (FLAG_WALK | FLAG_TRI_AB | FLAG_TRI_BA | FLAG_PADYAK_BANNED | FLAG_PADYAK_CLASS)).toBe(63 - 8);
  });

  it("refuses bad flags, rules, areas and places", () => {
    const bad = (patch: object) => parseWalkGraph({ ...good, ...patch }).ok;
    expect(parseWalkGraph(good).ok).toBe(true);
    expect(bad({ flags: good.flags.slice(1) })).toBe(false);
    expect(bad({ flags: good.flags.map(() => 0x40) })).toBe(false);
    expect(bad({ flags: good.flags.map(() => 2 << FLAG_RULE_SHIFT) })).toBe(false);
    expect(bad({ flags: good.flags.map(() => 0x10000) })).toBe(false);
    expect(bad({ flags: good.flags.map(() => -1) })).toBe(false);
    expect(bad({ rules: [{ ...good.rules[0]!, liftedTo: null }] })).toBe(false);
    expect(bad({ rules: [{ ...good.rules[0]!, liftedFrom: "25:00" }] })).toBe(false);
    expect(bad({ areas: [{ code: "PA01", radiusM: 1001 }], places: [] })).toBe(false);
    expect(bad({ areas: [{ code: "PA01", radiusM: 300 }], places: [[1, good.bbox[0], good.bbox[1], 1]] })).toBe(false);
    expect(bad({ areas: [{ code: "PA01", radiusM: 300 }], places: [[1, good.bbox[0] - 1, good.bbox[1], 0]] })).toBe(false);
    expect(bad({ areas: [{ code: "PA01", radiusM: 300 }], places: [[1, good.bbox[0], good.bbox[1], 0]] })).toBe(true);
  });

  it("a v1 payload decodes and routes walk only", () => {
    const grid = gridRoadGraph(3, 3);
    const v1 = buildWalkGraph(fakeRoadGraph(grid.points, grid.pieces), { roadSource: "T" }).payload;
    expect(v1.v).toBe(1);
    const parsed = parseWalkGraph(JSON.parse(JSON.stringify(v1)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [from, to] = [ll(grid.points[0]!), ll(grid.points[8]!)];
    expect(routeStreet(parsed.graph, from, to, { mode: "walk", now: NOON }).kind).toBe("path");
    for (const mode of ["tricycle", "padyak"] as const) expect(routeStreet(parsed.graph, from, to, { mode, now: NOON })).toMatchObject({ kind: "straight", reason: "no_mode_data" });
    expect(encodeWalkGraph(parsed.graph)).toEqual(v1);
  });
});

// --- A* = Dijkstra per mode; boundedDistances = routeStreet --------------------------------------

/** Reference directions per edge, re-derived from the flags (bit 0 a→b, bit 1 b→a). */
function refDirs(g: WalkGraph, e: number, mode: StreetMode, now: Date): number {
  const f = g.flags[e]!;
  if (mode === "walk") return f & FLAG_WALK ? 3 : 0;
  if (mode === "padyak") return f & FLAG_WALK && f & FLAG_PADYAK_CLASS && !(f & FLAG_PADYAK_BANNED) ? 3 : 0;
  const r = f >> FLAG_RULE_SHIFT;
  if (r > 0 && !ruleLifted(g.rules[r - 1]!, now)) return 0;
  return (f & FLAG_TRI_AB ? 1 : 0) | (f & FLAG_TRI_BA ? 2 : 0);
}

/** Plain O(n²) directed Dijkstra from the same snaps. */
function dijkstraLength(g: WalkGraph, sf: WalkSnap, st: WalkSnap, mode: StreetMode, now: Date): number {
  const len = (e: number) => g.edgeLenDm[e]! / 10;
  const dirs = (e: number) => refDirs(g, e, mode, now);
  const dist = new Array<number>(g.nodeCount).fill(Infinity);
  const done = new Array<boolean>(g.nodeCount).fill(false);
  if (dirs(sf.edge) & 2) dist[g.edgeA[sf.edge]!] = Math.min(dist[g.edgeA[sf.edge]!]!, sf.alongM);
  if (dirs(sf.edge) & 1) dist[g.edgeB[sf.edge]!] = Math.min(dist[g.edgeB[sf.edge]!]!, len(sf.edge) - sf.alongM);
  for (;;) {
    let u = -1;
    for (let i = 0; i < g.nodeCount; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done[u] = true;
    for (let k = g.adjStart[u]!; k < g.adjStart[u + 1]!; k++) {
      const e = g.adjEdge[k]!;
      const fromA = g.edgeA[e] === u;
      if (!(dirs(e) & (fromA ? 1 : 2))) continue;
      const v = fromA ? g.edgeB[e]! : g.edgeA[e]!;
      if (dist[u]! + len(e) < dist[v]!) dist[v] = dist[u]! + len(e);
    }
  }
  let best = Infinity;
  if (sf.edge === st.edge && (sf.alongM === st.alongM || dirs(sf.edge) & (sf.alongM <= st.alongM ? 1 : 2))) best = Math.abs(sf.alongM - st.alongM);
  if (dirs(st.edge) & 1) best = Math.min(best, dist[g.edgeA[st.edge]!]! + st.alongM);
  if (dirs(st.edge) & 2) best = Math.min(best, dist[g.edgeB[st.edge]!]! + len(st.edge) - st.alongM);
  return best;
}

describe("A* equals Dijkstra per mode; boundedDistances equals routeStreet (fast-check)", () => {
  const grid = gridRoadGraph(5, 5);
  const points = Object.fromEntries(grid.points.map((p, i) => [i + 1, p]));
  const point = fc.record({ lat: fc.double({ min: 13.6195, max: 13.6245, noNaN: true }), lng: fc.double({ min: 123.1895, max: 123.1945, noNaN: true }) });
  const wayTags = fc.record({
    highway: fc.constantFrom("residential", "footway", "primary", "service", "busway"),
    oneway: fc.constantFrom(undefined, "yes", "-1"),
    restricted: fc.boolean(),
    banned: fc.boolean(),
  });

  it("on random networks, hours and end points", () => {
    fc.assert(
      fc.property(
        fc.array(wayTags, { minLength: grid.pieces.length, maxLength: grid.pieces.length }),
        fc.array(fc.tuple(point, point), { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 0, max: 23 }),
        (tags, pairs, hour) => {
          const ways: [number, number[], Tags][] = grid.pieces.map((p, i) => {
            const t = tags[i]!;
            return [i + 1, [p.a + 1, p.b + 1], { highway: t.highway, ...(t.oneway ? { oneway: t.oneway } : {}) }];
          });
          const rules = [
            rule("TRI-2006-P2", "exclude", tags.flatMap((t, i) => (t.restricted ? [i + 1] : []))),
            rule("PADYAK-SEC132-4", "exclude", tags.flatMap((t, i) => (t.banned ? [i + 1] : []))),
          ];
          const g = graph(net(points, ways), rules);
          const now = manila(hour);
          for (const mode of ["walk", "tricycle", "padyak"] as const) {
            for (const [from, to] of pairs) {
              const opts = { mode, now };
              const r = routeStreet(g, from, to, opts);
              const lookup = boundedDistances(g, from, Infinity, mode, now)(to);
              const sf = snapStreet(g, from, opts);
              const st = snapStreet(g, to, opts);
              const ref = sf && st ? dijkstraLength(g, sf, st, mode, now) : Infinity;
              if (ref === Infinity) {
                expect(r.kind).toBe("straight");
                expect(lookup).toBeNull();
                continue;
              }
              expect(r.kind).toBe("path");
              if (r.kind !== "path") continue;
              expect(Math.abs(r.lengthM - r.snapFromM - r.snapToM - ref)).toBeLessThan(1e-3);
              expect(Math.abs(lookup! - r.lengthM)).toBeLessThan(1);
              if (mode !== "tricycle") expect(r.usedRules).toEqual([]);
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("boundedDistances respects the radius", () => {
    const g = graph(net(points, grid.pieces.map((p, i) => [i + 1, [p.a + 1, p.b + 1], { highway: "residential" }])));
    const from = ll(grid.points[0]!);
    const far = ll(grid.points[24]!);
    const full = routeStreet(g, from, far, { mode: "walk", now: NOON });
    expect(full.kind).toBe("path");
    if (full.kind !== "path") return;
    expect(boundedDistances(g, from, full.lengthM + 1, "walk")(far)).toBeCloseTo(full.lengthM, 6);
    expect(boundedDistances(g, from, full.lengthM / 2, "walk")(far)).toBeNull();
    expect(boundedDistances(g, { lat: 14, lng: 124 }, 1000, "walk")(far)).toBeNull();
  });
});
