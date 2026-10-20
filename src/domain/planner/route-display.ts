// How a jeepney ride names its route on a card (planner revision 2026-10-20): the stop-sign letter when one is
// confirmed, then a "Centro-…" title of the streets or barangays it serves. Static and pure; every entry cites
// its source. A letter is never guessed: R1 and R5 are blurred on the only photo (CX12), R3 and R4 are not on it.
// `unverified` is true when only the owner's photo (U04) or the owner's words (2026-10-20) support the entry.
// Street checks: each title was compared with the traced Lines path's OSM street names (docs/plans/2026-10-20-planner-revision.md).

export type RouteDisplay = { letter: string | null; title: string; unverified: boolean };

type Entry = RouteDisplay & { source: string };

export const ROUTE_DISPLAY: Readonly<Record<string, Entry>> = {
  R1: { letter: null, title: "Centro-Cararayan-San Isidro", unverified: true, source: "U04 sign name (alias RA11); owner 2026-10-20; letter blurred (CX12). Path: Balatas-Cararayan Rd, Cararayan-San Isidro Rd" },
  R2: { letter: "E", title: "Centro-Del Rosario via Magsaysay Ave", unverified: true, source: "U04 sign letter E and name (alias RA06). Path: Magsaysay Ave, Maharlika Hwy" },
  R3: { letter: null, title: "Centro-Del Rosario via Roxas Ave (Diversion)", unverified: true, source: "RL01 route name; 'Diversion' is the local name (U03, via group VG-CENTRO-DELROSARIO); letter not found. Path: Roxas Ave, Maharlika Hwy" },
  R4: { letter: null, title: "Centro-Del Rosario via Panganiban Drive", unverified: false, source: "RL01 route name (Ord 2025-070); letter not found. Path: Panganiban Dr, Maharlika Hwy" },
  R5: { letter: null, title: "Centro-Francia-San Felipe", unverified: true, source: "Owner 2026-10-20; U04 sign reads 'Centro - San Felipe'; letter blurred (CX12). Path: Peñafrancia Ave, San Felipe-Pacol Rd" },
  R6: { letter: "I", title: "Centro-Pacol", unverified: true, source: "U04 sign letter I and name (alias RA07). Path: Peñafrancia Ave, Pacol Rd" },
  R7: { letter: "J", title: "Centro-Carolina-Panicuason", unverified: true, source: "U04 sign letter J and name (alias RA08). Path: Pacol-Carolina-Panicuason Rd" },
  "R8-A": { letter: "A", title: "Centro-Magsaysay Loop", unverified: false, source: "RL01 Naga Loop Service A (alias RA01); title is today's route name. Path: Peñafrancia, Magsaysay, Roxas" },
  "R8-B": { letter: "B", title: "Centro-Magsaysay Loop", unverified: true, source: "RL01 Loop B; sign letter B by name and direction only (U04, alias RA05). Path: Roxas, Magsaysay, Peñafrancia" },
  "R8-C": { letter: "C", title: "Centro-Bagumbayan-Magsaysay-Roxas Loop", unverified: false, source: "RL01/RL02 Naga Loop Service C street list. Owner title 'Centro-Panganiban-Del Rosario' conflicts: the path never reaches Panganiban Dr or Del Rosario" },
  "R8-D": { letter: "D", title: "Centro-Francia-Magsaysay-Diversion", unverified: true, source: "Owner 2026-10-20; RL01/RL02 Loop D = Loop C streets reversed. Path: Roxas Ave (Diversion), Magsaysay Ave; Peñafrancia only briefly on the traced path" },
};

/** The display of a route code; an unknown code shows its route name with no letter (never a guessed one). */
export function routeDisplay(routeCode: string, routeName: string): RouteDisplay {
  const e = ROUTE_DISPLAY[routeCode];
  return e ? { letter: e.letter, title: e.title, unverified: e.unverified } : { letter: null, title: routeName, unverified: true };
}
