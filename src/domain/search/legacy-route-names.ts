// Legacy route names from research source S28 (Naga City ordinance, 1993), copied verbatim from
// Data_Sets/Naga_Commuter_Research.md §"Route amendments and local names". They are historical
// hints only (decision Q2): never mapped to a current route, and no panel colours are shown
// because the source itself says colours need field confirmation.
import type { LegacyRouteName } from "../api/schemas";

const NAMES = [
  "Concepcion via Panganiban/diversion",
  "Magsaysay",
  "San Felipe/Lomeda",
  "Pacol/Carolina",
  "Cararayan/San Isidro",
  "Bagumbayan/Calauag",
] as const;

export const LEGACY_ROUTE_NAMES: readonly LegacyRouteName[] = NAMES.map((name) => ({
  name,
  sourceCode: "S28" as const,
  year: 1993 as const,
  mappedRouteCode: null,
}));

/** Source codes the search index cites from code rather than from published rows (the sources register lists them too). */
export const INDEX_CODE_SOURCE_CODES: readonly string[] = [...new Set(LEGACY_ROUTE_NAMES.map((n) => n.sourceCode))];
