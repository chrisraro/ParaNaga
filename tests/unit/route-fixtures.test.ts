// The captured route responses (tests/e2e/fixtures/network, real data from a throwaway Neon
// branch) cover all 11 routes of the approved plan plus the VISTODA tricycle feeder, and each one
// has what Route detail needs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeDetailSchema, routeListSchema } from "@/domain/api/schemas";
import { directionLabels, routeFareTile, vehicleTile } from "@/domain/network/present";

const DIR = path.resolve("tests/e2e/fixtures/network");
const read = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));
const routeFiles = readdirSync(DIR).filter((f) => /^route-.+\.json$/.test(f));

describe("route detail fixtures", () => {
  it("cover the 11 LPTRP routes the route list publishes, and a tricycle feeder", () => {
    const list = routeListSchema.parse(read("routes.json"));
    const routes = list.groups.flatMap((g) => g.routes);
    const lptrp = routes.filter((r) => r.mode === "jeepney").map((r) => r.code).sort();
    expect(lptrp).toHaveLength(11);
    expect(routes.filter((r) => r.mode === "tricycle").map((r) => r.code).sort()).toEqual(["TRI-DECALANGON", "TRI-VISTODA"]);
    const captured = routeFiles.map((f) => routeDetailSchema.parse(read(f)).route.code).sort();
    expect(captured).toEqual([...lptrp, "TRI-VISTODA"].sort());
  });

  it("route-tri-vistoda.json: two branch variants without stops, the tricycle minimum fare only", () => {
    const r = routeDetailSchema.parse(read("route-tri-vistoda.json"));
    expect(r.route).toMatchObject({ mode: "tricycle", serviceStatus: "authorized_feeder", operatingStatus: null, verification: "unverified" });
    expect(r.variants.map((v) => [v.direction, v.stops.length])).toEqual([["branch", 0], ["branch", 0]]);
    expect(r.fareEvidence.rules.map((x) => x.code)).toEqual(["F03"]);
    expect(r.route.fleet.label).toBe("Tricycle (special trimobile) · authorized 2025 · operation not verified");
  });

  it.each(routeFiles.filter((f) => !f.startsWith("route-tri-")))("%s has a street order, an estimate fare and plan-only vehicle data", (file) => {
    const r = routeDetailSchema.parse(read(file));
    const { inbound, outbound, circuit } = r.route.legalStreets;
    const twoWay = inbound !== null && outbound !== null;
    expect(twoWay || (circuit !== null && circuit.length > 1)).toBe(true);
    if (twoWay) expect(directionLabels(r.route.name).inbound).toBe("Toward Centro");
    const fare = routeFareTile(r.fareEvidence.rules);
    expect(fare.note).toBe("Estimate");
    expect(fare.value).toMatch(/^₱\d+(–₱\d+)?$/);
    expect(vehicleTile(r.route.modeCode)).toEqual({ value: "Class 2", note: "Plan only" });
    // Only Loops A and B have provisional stops and the trial; nothing is verified.
    const ab = r.route.code === "R8-A" || r.route.code === "R8-B";
    expect(r.route.hasProvisionalStops).toBe(ab);
    expect(r.trials.length > 0).toBe(ab);
    expect(r.route.verification).toBe("unverified");
    // Owner-confirmed service (2026-10-16) never makes the stops or paths verified.
    expect(r.route.operatingStatus).toMatchObject({ status: "operating", confirmsServiceOnly: true });
    const mixed = r.route.code === "R4" || r.route.code === "R7";
    expect(r.route.fleet.label).toBe(mixed ? "Traditional and modern jeepneys" : "Traditional jeepneys");
    expect(r.route.fleet.colourKey).toBe(mixed ? "mixed_trad_modern" : "traditional_puj");
    expect(JSON.stringify(r)).not.toMatch(/e[-_ ]?jeep/i);
  });
});
