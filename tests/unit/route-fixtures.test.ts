// The captured route responses (tests/e2e/fixtures/network, real data from a throwaway Neon
// branch) cover all 11 routes of the approved plan, and each one has what Route detail needs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeDetailSchema, routeListSchema } from "@/domain/api/schemas";
import { directionLabels, routeFareTile, vehicleTile } from "@/domain/network/present";

const DIR = path.resolve("tests/e2e/fixtures/network");
const read = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));
const routeFiles = readdirSync(DIR).filter((f) => /^route-.+\.json$/.test(f));

describe("route detail fixtures", () => {
  it("cover exactly the 11 routes the route list publishes", () => {
    const list = routeListSchema.parse(read("routes.json"));
    const listed = list.groups.flatMap((g) => g.routes.map((r) => r.code)).sort();
    expect(listed).toHaveLength(11);
    const captured = routeFiles.map((f) => routeDetailSchema.parse(read(f)).route.code).sort();
    expect(captured).toEqual(listed);
  });

  it.each(routeFiles)("%s has a street order, an estimate fare and plan-only vehicle data", (file) => {
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
  });
});
