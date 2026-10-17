// Far-areas data (Increment F, T1): schema, zoneOf, and the committed JSON checked against the pinned road
// snapshot, the Data_Sets routes, the modes seed and the committed Lines paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { projectOnLine } from "@/domain/geo/measure";
import { decodePolyline } from "@/domain/geo/polyline";
import { parseModesSeed } from "@/domain/import/modes-seed";
import { parseFarAreas, ROUTE_BOARDING_LINK_M, zoneOf, type FarAreas } from "@/domain/planner/far-areas";
import { realLines } from "../fixtures/real-lines";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const mini = () => ({
  header: { schemaVersion: 1, preparedOn: "2026-10-18", roadSnapshot: "x.osm.json", reviewer: "t" },
  barangayAnchors: [
    { osmNodeId: 1, name: "Near", place: "quarter", lat: 13.62, lng: 123.18 },
    { osmNodeId: 2, name: "Far", place: "village", lat: 13.66, lng: 123.25 },
  ],
  farZones: [{ code: "FZ01", name: "Far", nodeIds: [2], routes: ["R6"], evidence: "owner_report_unverified", sourceCodes: ["U03"] }],
  routeBoarding: [],
  viaGroups: [] as unknown[],
  tricycleTerminals: [],
});

describe("parseFarAreas and zoneOf (synthetic)", () => {
  it("accepts a valid file and rejects unknown fields, bad source codes and short via groups", () => {
    expect(() => parseFarAreas(mini())).not.toThrow();
    expect(() => parseFarAreas({ ...mini(), extra: 1 })).toThrow();
    const bad = mini();
    bad.farZones[0]!.sourceCodes = ["X1"];
    expect(() => parseFarAreas(bad)).toThrow();
    const oneRoute = mini();
    oneRoute.viaGroups = [{ code: "G", routes: [{ routeCode: "R2", via: "A" }], evidence: "official", sourceCodes: ["RH02"] }];
    expect(() => parseFarAreas(oneRoute)).toThrow();
  });

  it("zoneOf returns the zone of the nearest anchor, else null", () => {
    const d = parseFarAreas(mini());
    expect(zoneOf({ lat: 13.659, lng: 123.249 }, d)).toBe("FZ01");
    expect(zoneOf({ lat: 13.621, lng: 123.181 }, d)).toBeNull();
  });
});

describe("committed far-areas-2026-10-18.json", () => {
  const data: FarAreas = parseFarAreas(read("data/planning/far-areas-2026-10-18.json"));
  const roads = read(`data/source/osm/${data.header.roadSnapshot}`).response.elements as {
    type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>;
  }[];
  const nodes = new Map(roads.filter((e) => e.type === "node").map((e) => [e.id, e]));
  const seed = parseModesSeed(read("data/source/research/naga-modes-seed-2026-10-16.json"));
  const terminals = new Map(seed.terminals.map((t) => [t.code, t]));
  // R1-R8 live in Data_Sets (the modes seed holds only the tricycle routes); the Lines fixture holds their paths.
  const routeCodes = new Set<string>([
    ...(read("Data_Sets/naga_transport_seed.json").routes as { route_id: string }[]).map((r) => r.route_id),
    ...realLines().lines.map((l) => l.routeCode),
  ]);

  it("has 27 barangay anchors, each a place node in the pinned road snapshot with the stated name, place and position", () => {
    expect(data.barangayAnchors).toHaveLength(27);
    expect(new Set(data.barangayAnchors.map((a) => a.osmNodeId)).size).toBe(27);
    for (const a of data.barangayAnchors) {
      const n = nodes.get(a.osmNodeId);
      expect(n, `node ${a.osmNodeId} ${a.name}`).toBeDefined();
      expect(n!.tags?.name).toBe(a.name);
      expect(n!.tags?.place).toBe(a.place);
      expect(haversineMeters(a, { lat: n!.lat!, lng: n!.lon! })).toBeLessThan(1);
    }
    expect(data.barangayAnchors.filter((a) => a.place === "village").map((a) => a.osmNodeId).sort()).toEqual(
      [11112006649, 12717296941, 12717296950, 12717296954, 14084819763],
    );
  });

  it("far zones: members are anchors, node sets are disjoint, routes exist", () => {
    expect(data.farZones.map((z) => z.code)).toEqual(["FZ01", "FZ02", "FZ03"]);
    const anchorIds = new Set(data.barangayAnchors.map((a) => a.osmNodeId));
    const seen = new Set<number>();
    for (const z of data.farZones) {
      for (const id of z.nodeIds) {
        expect(anchorIds.has(id), `${z.code} ${id}`).toBe(true);
        expect(seen.has(id), `${id} in two zones`).toBe(false);
        seen.add(id);
      }
      for (const r of z.routes) expect(routeCodes.has(r), r).toBe(true);
    }
  });

  it("each via group has 2+ routes that exist", () => {
    expect(data.viaGroups.map((g) => g.code)).toEqual(["VG-CENTRO-DELROSARIO"]);
    for (const g of data.viaGroups) {
      expect(g.routes.length).toBeGreaterThanOrEqual(2);
      for (const r of g.routes) expect(routeCodes.has(r.routeCode), r.routeCode).toBe(true);
    }
    expect(data.viaGroups[0]!.routes.map((r) => [r.routeCode, r.via])).toEqual([["R2", "Magsaysay"], ["R3", "Roxas (Diversion)"], ["R4", "Panganiban"]]);
  });

  it("terminal codes T10, T11 and T14 exist in the modes seed with coordinates", () => {
    const used = [
      ...data.routeBoarding.flatMap((b) => ("terminalCode" in b.boarding ? [b.boarding.terminalCode] : [])),
      ...data.tricycleTerminals.map((t) => t.terminalCode),
    ];
    expect([...new Set(used)].sort()).toEqual(["T10", "T11", "T14"]);
    for (const c of used) expect(terminals.get(c)?.coordinate, c).toBeTruthy();
  });

  it("routeBoarding links: pathLinkOk equals the measured terminal-to-path distance (<= ROUTE_BOARDING_LINK_M, 150 m)", () => {
    const lines = realLines().lines;
    for (const b of data.routeBoarding) {
      expect(routeCodes.has(b.routeCode), b.routeCode).toBe(true);
      if (!("terminalCode" in b.boarding)) {
        expect(b.pathLinkOk).toBeUndefined();
        continue;
      }
      const c = terminals.get(b.boarding.terminalCode)!.coordinate!;
      const dists = lines.filter((l) => l.routeCode === b.routeCode).map((l) => projectOnLine(decodePolyline(l.encoded), c).distM);
      expect(dists.length).toBeGreaterThan(0);
      const min = Math.min(...dists);
      expect(b.pathLinkOk, `${b.routeCode} ${b.boarding.terminalCode} min ${min.toFixed(1)} m`).toBe(min <= ROUTE_BOARDING_LINK_M);
    }
  });

  it("T14 serves FZ01 as an unverified owner report (U03)", () => {
    expect(data.tricycleTerminals).toEqual([
      expect.objectContaining({ terminalCode: "T14", serves: [{ farZone: "FZ01" }], evidence: "owner_report_unverified", sourceCodes: ["U03"] }),
    ]);
  });

  it("every sourceCodes entry in the far-areas file exists as an imported source in the modes seed", () => {
    const known = new Set(seed.sources.filter((s) => s.review.decision === "import").map((s) => s.code));
    const cited = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (k === "sourceCodes") for (const c of x as string[]) cited.add(c);
          else walk(x);
        }
      }
    };
    walk(data);
    expect(cited.size).toBeGreaterThan(0);
    for (const c of cited) expect(known.has(c), c).toBe(true);
  });

  it("zoneOf on anchors and city points", () => {
    const at = (id: number) => ({ lat: nodes.get(id)!.lat!, lng: nodes.get(id)!.lon! });
    expect(zoneOf(at(12717296950), data)).toBe("FZ01");
    expect(zoneOf(at(12717296941), data)).toBe("FZ02");
    expect(zoneOf(at(11112006649), data)).toBe("FZ03");
    expect(zoneOf({ lat: 13.6247, lng: 123.1861 }, data)).toBeNull(); // Plaza Rizal area
    expect(zoneOf(at(1875494497), data)).toBeNull(); // Balatas
  });
});
