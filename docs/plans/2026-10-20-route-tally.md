# Route tally: letters A-J for the 11 active jeepney services (2026-10-20)

Status (2026-10-22): stale letters. The inferred letters E to J for R2 to R7 were removed (commits 695b027, dc6c0f5; src/domain/planner/route-display.ts now has letter null for R1 to R7).

Owner's request: show the current, official routes in sync and accurate everywhere, with the Rationalized routes
tallied to the letters A, B, C, D, E, F, G, H, I, J. The static table is `src/domain/planner/route-display.ts`;
every list, search result, route detail, Layers list and stop/terminal "routes serving" list reads it through
`routeLabel`, `routeChipText`, `routeSearchNames`, `routeProvenance` and `isActiveRoute`.

## Official sources (City of Naga Sangguniang Panlungsod, www2.naga.gov.ph)

| Document | Date | Used for |
|---|---|---|
| Ordinance No. 2025-070, Naga City Public Transport Route Rationalization Ordinance of 2025 (institutionalizes the LPTRP, DOTr-LTFRB Board Resolution 204 s.2025) | enacted Sept 23, 2025 | the current text: 8 PUJ Class 2 routes, 282 units, street lists, Route 8 Naga Loop Service A-D (71 units) |
| Resolution No. 2025-172 | Apr 22, 2025 (earlier) | history only: the 90-day dry run added J. Miranda Ave to Loops C and D. The later ordinance lists C and D without it, so the app follows the ordinance |
| Resolution No. 2025-735 | earlier | history: 30-day dry run of Loops A and B adding the Eastbound Terminal |
| Ordinance 2001-040 (Magsaysay Loop Service A/B); 1998 amendment (Loops C, D) | older | history |

**Update 2026-10-22.** The letters E to J for R2 to R7 in the table below were removed from the app (commits 695b027, dc6c0f5): `src/domain/planner/route-display.ts` now has `letter: null` for R1 to R7, titles stay, and only Loops A to D keep their ordinance letters. Loop labels drop a redundant letter ("Centro-Magsaysay Loop A (clockwise)"). The table, evidence column and "How the app says it" below record the 2026-10-20 state and are historical.

## The tally

| Letter | Route no. | Official name (Ord. 2025-070) | Units | Display title | Streets (ordinance) | Evidence for the letter | Confidence |
|---|---|---|---|---|---|---|---|
| none | 1 | Centro-San Isidro via Cararayan | 20 | Centro-Cararayan-San Isidro | Cararayan-San Isidro Rd, Balatas Rd, Magsaysay Ave, Penafrancia Ave, Diaz St, Elias Angeles St, Caceres St; back via Panganiban Drive, Dayangdang St | sign row blurry (CX12): no letter, never a guess | route: official; letter: unknown |
| E | 2 | Centro-Del Rosario via Magsaysay Avenue | 22 | Centro-Del Rosario via Magsaysay Ave | Maharlika Hwy, Magsaysay Ave, Penafrancia Ave, Diaz St, Elias Angeles St, Padian St; back via Gen. Luna, P. Burgos | owner sign photo U04 (letter E) | one photo |
| F | 3 | Centro-Del Rosario via Roxas Avenue | 28 | Centro-Del Rosario via Roxas Ave (Diversion) | AH26, Roxas Ave, Fraternidad St, Biak na Bato St, Gen. Luna St, P. Burgos St, J. Hernandez Ave; plus Almeda Hwy/Felix Plaxo St to the Southbound Terminal | INFERRED from route-number order, never seen | unverified |
| G | 4 | Centro-Del Rosario via Panganiban Drive | 55 | Centro-Del Rosario via Panganiban Drive | AH26, Panganiban Drive, Penafrancia Ave, Arana St, J. Hernandez Ave, Caceres St, Dinaga St | INFERRED from route-number order, never seen | unverified |
| H | 5 | Centro-San Felipe | 33 | Centro-Francia-San Felipe | Pacol Rd, Penafrancia Ave ("Francia"), Diaz St, Elias Angeles St, Padian St, Gen. Luna St, P. Burgos St | owner photo U04 (orange H), consistent with the order | one photo |
| I | 6 | Centro-Pacol | 29 | Centro-Pacol | Pacol Rd, Penafrancia Ave, Diaz St, Elias Angeles St, Padian St, Dinaga St | owner sign photo U04 | one photo |
| J | 7 | Centro-Carolina-Panicuason | 24 | Centro-Carolina-Panicuason | Panicuason Rd, Carolina Rd, Pacol Rd, Penafrancia Ave, Diaz St, Elias Angeles St, Padian St, Dinaga St | owner sign photo U04 | one photo |
| A | 8 | Naga Loop Service, Loop A (clockwise) | 71 shared | Centro-Magsaysay Loop A (clockwise) | Gen. Luna, P. Burgos, Penafrancia, Magsaysay, Taal, J. Miranda, Leon SA Aureus/Mayflower, Roxas, Bicol Central Station, Fraternidad, Biak na Bato | the ordinance names Loop A | official |
| B | 8 | Loop B (counterclockwise) | 71 shared | Centro-Magsaysay Loop B (counterclockwise) | the reverse of Loop A | ordinance Loop B, and the letter on the sign (U04) | official; `unverified` stays true |
| C | 8 | Loop C (clockwise) | 71 shared | Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise) | Gen. Luna, P. Burgos, Penafrancia, Diaz, Elias Angeles, Bagumbayan Sur Rd, M.T. Villanueva Ave, Magsaysay, Roxas, Fraternidad, Biak na Bato | the ordinance names Loop C | official |
| D | 8 | Loop D (counterclockwise) | 71 shared | Centro-Roxas-Magsaysay-Bagumbayan Loop D (counterclockwise) | Gen. Luna, Biak na Bato, Fraternidad, Roxas, Magsaysay, M.T. Villanueva, Bagumbayan Rd, Elias Angeles, Caceres | the ordinance names Loop D | official |

Units: 20 + 22 + 28 + 55 + 33 + 29 + 24 + 71 = 282, the ordinance total. The ordinance gives no per-loop split of Route 8's 71 units.

Public codes: R1-R7 are Routes 1-7; R8-A..R8-D are Loops A-D of Route 8.

## What is inferred

- The rule "letters E-J follow route numbers 2-7 in order" is the owner's tally (2026-10-20). Seen on a sign in the owner's photo U04: E, I, J, B, and H (orange). Never seen: F (Route 3) and G (Route 4); they are assigned by the rule only.
- No letter for R1: the sign row is blurry and a letter beyond J would be a guess.
- Titles are short and street-based, each checked against the ordinance street lists above. "Francia" is the local name of Penafrancia Ave; "Diversion" is the local name of the Roxas Ave road (U03).

## How the app says it

- Route detail: the letter and title as the heading, then "Route N of the City of Naga route plan, Ordinance 2025-070 · N units authorised" and one letter line:
  - "Letter seen on the signboard" (E, H, I, J, B);
  - "Letter C of the Loop Service in the ordinance" (A, C, D);
  - "Letter inferred from the signboard order, not yet confirmed" (F, G);
  - nothing for R1.
- Lists (Explore Routes, Layers, stop and terminal "routes serving"): chip "Route E" / "Loop C" / "R1" and the full title.
- Search finds a route by its letter, "Route E", "Route 4", "Loop C", its code, its published name or any street of its plan.
- Only these 11 services are listed as routes. Tricycle feeder codes (TRI-*) are not listed as routes; they stay under Terminals. Saved trips keep their stored text.
- The loop direction ("clockwise") is part of the loop title, so it is not repeated beside the chip.

## The owner must confirm

1. Letters F and G (Routes 3 and 4): inferred only.
2. The letter of Route 1 (Centro-San Isidro via Cararayan): unknown; shown without one.
3. Whether the letters on the signboards follow the ordinance's route numbers or are a separate local scheme (E, H, I, J are consistent with the order; one photo).
4. Loop B's sign letter (seen once).
