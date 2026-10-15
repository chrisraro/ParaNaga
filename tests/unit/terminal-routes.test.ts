// Which routes name a terminal (src/domain/network/terminal-routes.ts): a case-insensitive exact
// substring of the terminal's full name in a legal street list (legal_plan) or trial circuit (trial).
import { describe, expect, it } from "vitest";
import { routesNamingTerminal, type TerminalRouteVariant } from "@/domain/network/terminal-routes";
import { realSearchSource } from "../fixtures/search-source";
import { normalizeSeed } from "@/domain/import/seed";
import { readFileSync } from "node:fs";

const seed = normalizeSeed(JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8")));
const variants: TerminalRouteVariant[] = [
  ...seed.routes.map((r) => ({
    routeCode: r.publicCode, routeName: r.name, kind: "permanent", legalStreets: r.legalStreets, sourceCodes: r.sourceCodes,
  })),
  ...seed.trialChanges.map((t) => ({
    routeCode: t.routeCode, routeName: seed.routes.find((r) => r.publicCode === t.routeCode)!.name, kind: "trial",
    legalStreets: { inbound: null, outbound: null, circuit: t.simplifiedCircuit }, sourceCodes: [t.sourceCode],
  })),
];
const terminals = realSearchSource().terminals;
const name = (code: string) => terminals.find((t) => t.code === code)!.name;

describe("routesNamingTerminal on the real data", () => {
  it("T01 Bicol Central Station: R8-A and R8-B on the legal plan and on the trial", () => {
    const routes = routesNamingTerminal(name("T01"), variants);
    expect(routes.map((r) => [r.routeCode, r.basis])).toEqual([
      ["R8-A", "legal_plan"], ["R8-A", "trial"], ["R8-B", "legal_plan"], ["R8-B", "trial"],
    ]);
    expect(routes.find((r) => r.basis === "trial")!.sourceCodes).toEqual(["S03"]);
    expect(routes[0]!.routeName).toBe("Centro–Magsaysay Loop A");
  });

  it("T02 Eastbound Terminal: named only by the trial circuits", () => {
    expect(routesNamingTerminal(name("T02"), variants).map((r) => [r.routeCode, r.basis])).toEqual([
      ["R8-A", "trial"], ["R8-B", "trial"],
    ]);
  });

  it("T06 Naga PNR railway station: no routes", () => {
    expect(routesNamingTerminal(name("T06"), variants)).toEqual([]);
  });

  it("matches case-insensitively but never a partial name", () => {
    const v: TerminalRouteVariant = {
      routeCode: "X", routeName: "X", kind: "permanent", sourceCodes: ["S01"],
      legalStreets: { inbound: ["bicol central station gate"], outbound: ["Bicol Central"], circuit: null },
    };
    expect(routesNamingTerminal("Bicol Central Station", [v])).toHaveLength(1);
    expect(routesNamingTerminal("Bicol Central Station", [{ ...v, legalStreets: { inbound: ["Bicol Central"], outbound: null, circuit: null } }])).toEqual([]);
  });
});
