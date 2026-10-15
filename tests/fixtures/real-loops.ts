// Snapshot-shaped fixture built from the real Data_Sets files: Loop A (A1…A30) and Loop B
// (B1…B31) in their provisional order, plus the seed's F01/F02 fare rules. Stop and variant ids
// are derived deterministically from source identities (the database assigns its own ids).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NetworkSnapshot } from "@/domain/api/schemas";
import { buildSnapshot, parseGeojsonStops, withIdentities } from "@/domain/import/mapped-stops";
import { provisionalLoopSequence } from "@/domain/import/provisional-loops";
import { normalizeSeed } from "@/domain/import/seed";

const read = (f: string) => readFileSync(`Data_Sets/${f}`, "utf8");

function idFor(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function realLoopsSnapshot(): NetworkSnapshot {
  const kml = read("naga_mapped_stops_source.kml");
  const geojson = read("naga_mapped_stops.geojson");
  const csv = read("naga_mapped_stops.csv");
  const mapId = parseGeojsonStops(geojson).metadata.mapId;
  const records = withIdentities(buildSnapshot(kml, geojson, csv).records, mapId);
  const byIdentity = new Map(records.map((r) => [r.sourceIdentity, r]));
  const seed = normalizeSeed(JSON.parse(read("naga_transport_seed.json")));

  const loops = (["R8-A", "R8-B"] as const).map((routeCode) => {
    const seq = provisionalLoopSequence(records, routeCode)!;
    return { routeCode, recs: seq.map((s) => byIdentity.get(s.recordIdentity)!) };
  });
  const loopRecords = loops.flatMap((l) => l.recs);

  return {
    revision: { revisionId: idFor("revision"), label: "real-loops fixture", kind: "provisional", publishedAt: null },
    stops: loopRecords.map((r) => ({
      id: idFor(r.sourceIdentity), name: r.label || r.code, lat: r.lat, lng: r.lng, status: "candidate" as const,
      navigationApproved: false, source: { layer: r.sourceLayer, code: r.code, label: r.label },
    })),
    variants: loops.map((l) => ({
      variantId: idFor(`variant:${l.routeCode}`), routeId: idFor(`route:${l.routeCode}`), routeCode: l.routeCode,
      routeName: l.routeCode === "R8-A" ? "Loop A" : "Loop B",
      direction: l.routeCode === "R8-A" ? ("clockwise" as const) : ("counterclockwise" as const),
      kind: "permanent" as const, evidenceLevel: "provisional" as const, verification: "unverified" as const,
      isCircular: true, stopIds: l.recs.map((r) => idFor(r.sourceIdentity)),
    })),
    fareRules: seed.fareRules
      .filter((f) => f.code === "F01" || f.code === "F02")
      .map((f) => ({
        code: f.code, modeCode: f.modeCode, vehicleClass: null, baseCentavos: f.baseCentavos, baseKm: f.baseKm,
        incrementCentavosPerKm: f.incrementCentavosPerKm, discountPercent: f.discountPercent,
        discountedBaseCentavos: f.discountedBaseCentavos, discountGroups: f.discountGroups, rounding: f.rounding,
        effectiveFrom: f.effectiveFrom, enactedOn: f.enactedOn, evidenceStatus: f.evidenceStatus, status: "reported",
        publishExact: false, isEstimate: true as const, sourceCodes: f.sourceCodes,
      })),
  };
}
