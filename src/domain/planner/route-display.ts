// How a jeepney route is named everywhere it is shown (cards, lists, search, map Layers, stop and route detail):
// its signboard letter A..J when there is one, then a short street-based "Centro-…" title. Static and pure.
// One table, one set of helpers (route tally 2026-10-20, docs/plans/2026-10-20-route-tally.md).
//
// Sources: City of Naga Ordinance 2025-070 (Sept 23 2025: 8 PUJ routes, 282 units; Route 8 is the Naga Loop Service
// A-D, 71 units; the ordinance, not Resolution 2025-172, is the current text for Loops C and D) names and numbers the
// routes and fixes their streets. The ordinance carries no signboard letters: the letters come from the signs.
// Letter evidence: A-D = the Loop Service letters of the ordinance; B also seen on a sign (owner photo U04);
// E, H, I, J = owner photo U04 (one photo); F, G = INFERRED from the owner's tally 2026-10-20 ("letters E-J follow
// the route numbers 2-7 in order": R2=E, R3=F, R4=G, R5=H, R6=I, R7=J), never seen on a sign; R1's sign row is blurry
// (CX12): no letter, never a guess.
// `unverified` is false only for the loops A, C, D (the ordinance names them); the rest rest on one owner photo or the tally.

export type RouteDisplay = { letter: string | null; title: string; unverified: boolean };

/** Where a letter comes from: shown honestly on the route detail. */
export type LetterEvidence = "ordinance" | "sign" | "inferred" | "none";

type Entry = RouteDisplay & {
  source: string;
  /** Route number of the ordinance (1..8); Loops A-D are all Route 8. */
  routeNumber: number;
  /** Units authorised by Ordinance 2025-070; the four loops share Route 8's 71. */
  authorisedUnits: number;
  unitsShared?: true;
  letterEvidence: LetterEvidence;
};

export const ROUTE_DISPLAY: Readonly<Record<string, Entry>> = {
  R1: { letter: null, title: "Centro-Cararayan-San Isidro", unverified: true, routeNumber: 1, authorisedUnits: 20, letterEvidence: "none", source: "Ord 2025-070 Route 1 Centro-San Isidro via Cararayan; U04 sign name (alias RA11); letter blurred (CX12). Path: Balatas-Cararayan Rd, Cararayan-San Isidro Rd" },
  R2: { letter: null, title: "Centro-Del Rosario via Magsaysay Ave", unverified: true, routeNumber: 2, authorisedUnits: 22, letterEvidence: "none", source: "Ord 2025-070 Route 2; U04 sign name (alias RA06). Path: Magsaysay Ave, Maharlika Hwy" },
  R3: { letter: null, title: "Centro-Del Rosario via Roxas Ave (Diversion)", unverified: true, routeNumber: 3, authorisedUnits: 28, letterEvidence: "none", source: "Ord 2025-070 Route 3 via Roxas Ave; 'Diversion' is the local name (U03). Path: Roxas Ave, Maharlika Hwy" },
  R4: { letter: null, title: "Centro-Del Rosario via Panganiban Drive", unverified: true, routeNumber: 4, authorisedUnits: 55, letterEvidence: "none", source: "Ord 2025-070 Route 4 via Panganiban Drive. Path: Panganiban Dr, Maharlika Hwy" },
  R5: { letter: null, title: "Centro-Francia-San Felipe", unverified: true, routeNumber: 5, authorisedUnits: 33, letterEvidence: "none", source: "Ord 2025-070 Route 5 Centro-San Felipe; owner photo U04; 'Francia' = Peñafrancia Ave. Path: Peñafrancia Ave, San Felipe-Pacol Rd" },
  R6: { letter: null, title: "Centro-Pacol", unverified: true, routeNumber: 6, authorisedUnits: 29, letterEvidence: "none", source: "Ord 2025-070 Route 6; U04 sign name (alias RA07). Path: Peñafrancia Ave, Pacol Rd" },
  R7: { letter: null, title: "Centro-Carolina-Panicuason", unverified: true, routeNumber: 7, authorisedUnits: 24, letterEvidence: "none", source: "Ord 2025-070 Route 7; U04 sign name (alias RA08). Path: Pacol-Carolina-Panicuason Rd" },
  "R8-A": { letter: "A", title: "Centro-Magsaysay Loop A (clockwise)", unverified: false, routeNumber: 8, authorisedUnits: 71, unitsShared: true, letterEvidence: "ordinance", source: "Ord 2025-070 Route 8 Naga Loop Service A, clockwise (alias RA01). Path: Peñafrancia, Magsaysay, Roxas" },
  "R8-B": { letter: "B", title: "Centro-Magsaysay Loop B (counterclockwise)", unverified: true, routeNumber: 8, authorisedUnits: 71, unitsShared: true, letterEvidence: "sign", source: "Ord 2025-070 Route 8 Loop B, the reverse of A; sign letter B by name and direction only (U04, alias RA05). Path: Roxas, Magsaysay, Peñafrancia" },
  "R8-C": { letter: "C", title: "Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise)", unverified: false, routeNumber: 8, authorisedUnits: 71, unitsShared: true, letterEvidence: "ordinance", source: "Ord 2025-070 Route 8 Loop C, clockwise: Gen. Luna, Peñafrancia, Diaz, Elias Angeles, Bagumbayan Sur, M.T. Villanueva, Magsaysay, Roxas, Fraternidad, Biak na Bato (no J. Miranda Ave: Res 2025-172 added it for the dry run only)" },
  "R8-D": { letter: "D", title: "Centro-Roxas-Magsaysay-Bagumbayan Loop D (counterclockwise)", unverified: false, routeNumber: 8, authorisedUnits: 71, unitsShared: true, letterEvidence: "ordinance", source: "Ord 2025-070 Route 8 Loop D, counterclockwise: Gen. Luna, Biak na Bato, Fraternidad, Roxas, Magsaysay, M.T. Villanueva, Bagumbayan, Elias Angeles, Caceres (no J. Miranda Ave, as C)" },
};

const isLoop = (code: string) => code.startsWith("R8-");

/** The display of a route code; an unknown code shows its route name with no letter (never a guessed one). */
export function routeDisplay(routeCode: string, routeName: string): RouteDisplay {
  const e = ROUTE_DISPLAY[routeCode];
  return e ? { letter: e.letter, title: e.title, unverified: e.unverified } : { letter: null, title: routeName, unverified: true };
}

/**
 * One label from a letter and a title, without redundant letters for loops (owner 2026-10-21:
 * "A Centro-Magsaysay Loop A" had redundant A). Loops already name "Loop A" in their title,
 * so they are returned as-is (e.g. "Centro-Magsaysay Loop A (clockwise)").
 * Other lettered routes prepend their letter (e.g. "E Centro-Del Rosario via Magsaysay Ave").
 */
export function formatRouteLabel(letter: string | null, title: string): string {
  if (!letter) return title;
  if (new RegExp(`\\bLoop\\s+${letter}\\b`, "i").test(title)) return title;
  return `${letter} ${title}`;
}

/** The title with its "Loop A" removed, for a list row whose chip already says "Loop A". */
export function routeTitleBesideChip(routeCode: string, routeName: string): string {
  const d = routeDisplay(routeCode, routeName);
  return d.letter ? d.title.replace(new RegExp(`\\s*\\bLoop\\s+${d.letter}\\b`), "").trim() : d.title;
}

/** "Loop A · Centro-Magsaysay (clockwise)"; "E Centro-…" for a lettered line route; just the title with no letter (R1, unknown codes). */
export function routeLabel(routeCode: string, routeName: string): string {
  const d = routeDisplay(routeCode, routeName);
  return formatRouteLabel(d.letter, d.title);
}

/** The short chip of a route in a list: "Loop C", "Route E", or the code ("R1") with no letter. */
export function routeChipText(routeCode: string): string {
  const e = ROUTE_DISPLAY[routeCode];
  if (!e?.letter) return routeCode;
  return isLoop(routeCode) ? `Loop ${e.letter}` : `Route ${e.letter}`;
}

/** Extra names search accepts for a route: its letter, "Route E", "Route 4", "Loop C", and its display title. */
export function routeSearchNames(routeCode: string): string[] {
  const e = ROUTE_DISPLAY[routeCode];
  if (!e) return [];
  const out = [e.title];
  if (e.letter) out.push(e.letter, `Route ${e.letter}`, ...(isLoop(routeCode) ? [`Loop ${e.letter}`] : []));
  if (!isLoop(routeCode)) out.push(`Route ${e.routeNumber}`);
  return out;
}

/** The honest provenance lines of a route detail: ordinance, authorised units, and where the letter comes from. */
export function routeProvenance(routeCode: string): { plan: string; letter: string | null } | null {
  const e = ROUTE_DISPLAY[routeCode];
  if (!e) return null;
  const units = e.unitsShared ? `${e.authorisedUnits} units shared by Loops A-D` : `${e.authorisedUnits} units`;
  const letter =
    e.letterEvidence === "sign" ? "Letter seen on the signboard"
    : e.letterEvidence === "inferred" ? "Letter inferred from the signboard order, not yet confirmed"
    : e.letterEvidence === "ordinance" ? `Letter ${e.letter} of the Loop Service in the ordinance`
    : null;
  return { plan: `Route ${e.routeNumber} of the City of Naga route plan, Ordinance 2025-070 · ${units} authorised`, letter };
}

/** An active jeepney route: one of the 11 services (R1-R7, Loops A-D) of Ordinance 2025-070. Nothing else is listed as one. */
export const isActiveRoute = (routeCode: string): boolean => Object.hasOwn(ROUTE_DISPLAY, routeCode);
