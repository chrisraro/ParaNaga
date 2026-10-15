// Routes that name a terminal in their documents. Pure.
// A route "names" a terminal when one of its street entries contains the terminal's full name as a
// case-insensitive exact substring ("Eastbound Terminal, Anciano St" names "Eastbound Terminal").
// Basis: a permanent variant's legal street list → "legal_plan"; a trial circuit → "trial". This
// is document text, not a stop: no boarding point or bay is implied.
import { compareCodeUnits } from "../import/hash";

export type TerminalRouteVariant = {
  routeCode: string;
  routeName: string;
  kind: string;
  legalStreets: { inbound: string[] | null; outbound: string[] | null; circuit: string[] | null };
  sourceCodes: string[];
};

export type TerminalRoute = {
  routeCode: string;
  routeName: string;
  basis: "legal_plan" | "trial";
  sourceCodes: string[];
};

const basisOf = (kind: string): TerminalRoute["basis"] | null =>
  kind === "permanent" ? "legal_plan" : kind === "trial" ? "trial" : null;

/** One entry per (route, basis), in input route order, legal_plan before trial. */
export function routesNamingTerminal(terminalName: string, variants: readonly TerminalRouteVariant[]): TerminalRoute[] {
  const needle = terminalName.trim().toLowerCase();
  if (needle === "") return [];
  const found = new Map<string, TerminalRoute>();
  for (const v of variants) {
    const basis = basisOf(v.kind);
    if (!basis) continue;
    const { inbound, outbound, circuit } = v.legalStreets;
    const streets = [...(inbound ?? []), ...(outbound ?? []), ...(circuit ?? [])];
    if (!streets.some((s) => s.toLowerCase().includes(needle))) continue;
    const key = `${v.routeCode}\u0000${basis}`;
    const entry = found.get(key) ?? { routeCode: v.routeCode, routeName: v.routeName, basis, sourceCodes: [] };
    entry.sourceCodes = [...new Set([...entry.sourceCodes, ...v.sourceCodes])].sort(compareCodeUnits);
    found.set(key, entry);
  }
  const routeOrder = new Map<string, number>();
  for (const v of variants) if (!routeOrder.has(v.routeCode)) routeOrder.set(v.routeCode, routeOrder.size);
  return [...found.values()]
    .sort((a, b) => routeOrder.get(a.routeCode)! - routeOrder.get(b.routeCode)! || (a.basis === "legal_plan" ? -1 : 1));
}
