# Trip planner revision (2026-10-20)

Status (2026-10-22): finished (extended by the TODA terminals and two-way roadside suggestions: src/domain/planner/toda-terminals.ts, roadside.ts).

Branch `feat/planner-rev` (worktree `.worktrees/planner-rev`, from origin/master e5b32d4). Domain code, one data file
and tests. No migration, no new dependency, no UI component change (a second agent renders the new fields).

## Owner request (2026-10-20, summary)

Jeepney options must not loop or roam the rider; rides show the sign letter (E, I, J …) and a "Centro-…" title of
the streets or barangays they serve; inside the city centre (bus and van terminals, SM, Robinsons, other malls)
the tricycle is the top option; tricycle options name the terminal or TODA.

## Rules

1. **Detour guard** (`plan.ts`, inside the candidate search, before Pareto, vias, labels and Recommended). A jeepney
   candidate is kept only when its ride metres (all rides summed) are at most
   `JEEP_MAX_DETOUR × straight-line(origin, destination) + JEEP_DETOUR_SLACK_M`. Its drop-off is still within the
   existing alight limits. With none left, the no-jeepney rules apply unchanged (tricycle Recommended at 500 m or
   more, walk under 500 m, far-zone special trip), and `jeepneyReason` is `"roundabout"`
   ("Jeepney routes here go the long way around"). The access option (far zones) is not guarded: it rides outward
   from a loading point.
2. **City centre** (`centro.ts`, `data/planning/centro-2026-10-20.json`). When both ends lie within an anchor's
   radius (and neither is in a far zone):
   - a jeepney is offered only when it passes the guard and drops off within `PASSES_DESTINATION_M` (100 m) of the
     destination; it is never Recommended;
   - at 500 m or more the tricycle is Recommended and listed first; under 500 m the walk keeps Recommended (owner
     walk rule unchanged);
   - with no jeepney left, `jeepneyReason` is `"centro"` ("In the city centre, a tricycle takes you there directly").
3. **Far drop-offs** (owner, 2026-10-20: "When showing trip option for some destination that may have 300 to 400
   meters away from a jeepney usual route and nearest drop, suggest it anyway, but it was not the top option.").
   Destination not in a far zone. For each jeepney route that is not already the last ride of a shown option, the
   planner takes its candidate (fewest rides, then nearest drop-off) whose last drop-off is over the near limit
   (`JEEP_NEAR_DROP_M` 300 m; in the city centre `PASSES_DESTINATION_M` 100 m) and at most `JEEP_FAR_DROP_MAX_M`
   (400 m) straight-line from the destination. The candidate has already passed the detour guard and must-save-walking.
   It is appended after the tricycle and padyak, nearest drop-off first, at most `JEEP_FAR_DROP_MAX_EXTRA` (2) per
   trip, skipping one whose drop-off is within `JEEP_FAR_DROP_DISTINCT_M` (50 m) of a drop-off already shown or added
   (loops sharing a street drop off at one spot), with no label, never Recommended; its walk
   after the drop-off is the usual last walk leg. `jeepneyReason` is null when one is shown. The planner's own picks
   are unchanged (a picked option dropping off 300 m or more away keeps its place and may stay Recommended, e.g.
   Plaza Rizal → Ateneo, about 400 m from the campus centroid). One-Recommended exception: if a far drop-off option
   were the only one able to carry Recommended, the first one would; today it cannot happen, because a far drop-off
   is only added beside a shown jeepney, a walk card or a plain tricycle. The planner keeps that line as a guard.
4. Unchanged: exactly one Recommended (except the legal far/no-jeepney case); far zones (no plain tricycle,
   special-trip card, jeepney via the terminal); the cheapest surviving jeepney is Recommended from 500 m outside
   the centre; tricycle and padyak never in minutes; "Unverified route"; no e-jeepney; modern jeeps on R4 and R7 only.

## Constants

| Constant | Value | Where |
|---|---|---|
| `JEEP_MAX_DETOUR` | 2.0 | `src/domain/planner/plan.ts` (owner-tunable; Jev certainty 0.23, leaning high, controller decision) |
| `JEEP_DETOUR_SLACK_M` | 300 m | `src/domain/planner/plan.ts` |
| `PASSES_DESTINATION_M` | 100 m (existing) | `src/domain/planner/plan.ts` |
| `JEEP_NEAR_DROP_M` | 300 m (far drop-off starts above it, outside the centre) | `src/domain/planner/plan.ts` (owner-tunable) |
| `JEEP_FAR_DROP_MAX_M` | 400 m (farthest far drop-off offered) | `src/domain/planner/plan.ts` (owner-tunable) |
| `JEEP_FAR_DROP_MAX_EXTRA` | 2 far drop-off options per trip at most | `src/domain/planner/plan.ts` (controller decision) |
| `JEEP_FAR_DROP_DISTINCT_M` | 50 m (same drop-off spot) | `src/domain/planner/plan.ts` |
| centro anchor radii | 200–600 m per anchor | `data/planning/centro-2026-10-20.json` |
| tricycle terminal match | 600 m (existing `TRICYCLE_TERMINAL_MAX_M`) | `src/domain/trip/tricycle-hint.ts` |

## Route display table (`src/domain/planner/route-display.ts`)

Format on a card: letter (when confirmed) + title, e.g. "E Centro-Del Rosario via Magsaysay Ave",
"Centro-Francia-San Felipe". Street checks compare each title with the OSM street names along the traced Lines
path (metres of path within 12 m of a named way, `naga-roads-2026-10-16.osm.json`).

| Code | Letter | Title | Unverified | Basis | Path check (main streets, m) |
|---|---|---|---|---|---|
| R1 | none (blurred G/H/K, CX12) | Centro-Cararayan-San Isidro | yes | U04 sign name, owner words | Cararayan-San Isidro Rd 6,289; Balatas-Cararayan Rd 2,212 |
| R2 | E | Centro-Del Rosario via Magsaysay Ave | yes | U04 sign (RA06) | Maharlika Hwy 3,969; Magsaysay Ave 1,500 |
| R3 | none (not found) | Centro-Del Rosario via Roxas Ave (Diversion) | yes | RL01 name; "Diversion" local name (U03) | Maharlika Hwy 8,942; Roxas Ave 3,939 |
| R4 | none (not found) | Centro-Del Rosario via Panganiban Drive | no | RL01 name | Maharlika Hwy 8,930; Panganiban Dr 2,992 |
| R5 | none (blurred G/H, CX12) | Centro-Francia-San Felipe | yes | owner words; sign reads "Centro - San Felipe" | Peñafrancia Ave 1,472; San Felipe-Pacol Rd 848 |
| R6 | I | Centro-Pacol | yes | U04 sign (RA07) | Pacol Rd 6,765; Peñafrancia Ave 1,472 |
| R7 | J | Centro-Carolina-Panicuason | yes | U04 sign (RA08) | Pacol-Carolina-Panicuason Rd 14,032 |
| R8-A | A | Centro-Magsaysay Loop | no | RL01 Loop A; today's route name | Roxas 1,982; Magsaysay 1,577; Peñafrancia 1,354 |
| R8-B | B | Centro-Magsaysay Loop | yes (letter by name and direction) | RL01, U04 (RA05) | Roxas 1,972; Magsaysay 1,264; Peñafrancia 888 |
| R8-C | C | Centro-Bagumbayan-Magsaysay-Roxas Loop | no | RL01/RL02 street list (owner title rejected, see conflicts) | Roxas 1,977; Magsaysay 1,492; M.T. Villanueva 753; Bagumbayan 645 |
| R8-D | D | Centro-Francia-Magsaysay-Diversion | yes | owner words; RL01/RL02 (Loop C reversed) | Roxas 1,958; Magsaysay 1,500; Peñafrancia under 100 |

An unknown route code shows its route name with no letter (`unverified: true`).

## City-centre anchors (`data/planning/centro-2026-10-20.json`)

Coordinates copied from the committed OSM places snapshots; none invented.

| Code | Anchor | Radius | Source |
|---|---|---|---|
| C01 | Plaza Rizal (Centro) | 600 m | OSM way 201276956 |
| C02 | Bicol Central Station (central bus terminal, T01) | 300 m | OSM way 293702439 |
| C03 | UV-Express Southbound Terminal (van terminal) | 250 m | OSM node 4545731190 |
| C04 | LCC Naga Transport Station (Integrated Southbound Terminal, T03) | 300 m | OSM way 23670386 |
| C05 | SM City Naga | 300 m | OSM way 175408605 |
| C06 | Robinsons Place Naga | 300 m | OSM way 515672435 |
| C07 | LCC Mall Naga | 250 m | OSM way 23665048 |
| C08 | Naga City People's Mall | 250 m | OSM way 23674855 |
| C09 | WinWin Mall | 200 m | OSM way 833125840 |
| C10 | Yashano Mall Naga | 200 m | OSM way 835699893 |
| C11 | Metro Gaisano | 200 m | OSM relation 11521639 |
| C12 | Avenue Plaza | 200 m | OSM node 6982064017 |

Ateneo de Naga (840 m from Plaza Rizal) is outside on purpose: Plaza Rizal to Ateneo keeps its direct Recommended
jeepney. Vista Mall (near Del Rosario) is not a centre anchor.

## Tricycle terminals

The plain tricycle option carries `tricycleTerminals`: for each end, the published tricycle terminal nearest it within
600 m (the existing `nearestTricycleTerminal`), once per terminal, with the TODA names on file in the far-areas data.
Today the only located tricycle terminal is T14 Balatas Tricycle Terminal, with no TODA name on file; T15 and T16 have
no coordinate. No TODA name is invented. A special-trip card keeps its own "From …" note instead.

## Effect on the regression baseline

The 200-trip digest was re-recorded after each changed trip was compared with the previous planner: 104 unchanged
(apart from the additive `display`/`tricycleTerminals`), 62 changed by the guard, 18 by the centro rule, 16 by both,
0 unexplained. Jeepney options: 320 → 250. On 774 random city trips, no ride covers 80 % or more of a loop (audit
#5 found 995 such instances, 175 Recommended). Audit examples: the 589 m trip near Ateneo no longer offers the 6.75
km R8-C near-lap, and the 642 m trip no longer offers the 5.4 km R8-C > R4 two-ride (unit tests). Tests moved by the
guard: two via-group test trips (the old ones rode R3/R4 around their circuits) and the far-to-far note (Cararayan
to Pacol: the only jeepney rides in to Centro and out again, so now a special-trip card, reason "roundabout").
Two offline e2e tests planned Plaza Rizal to SM City Naga (now a city-centre trip, tricycle only) to exercise cached
ride lines; they now plan Plaza Rizal to a fixture place past the centre and open the jeepney card.

Far drop-offs (rule 3, branch `feat/far-drop`, capped at 2 distinct spots per trip): 138 of the 200 trips are
unchanged. 62 gain 84 far drop-off jeepney options (1 or 2 each, drop-offs 102 to 400 m). Every earlier option is
byte-identical, Recommended changes on 0 trips, and no option is trimmed. 12 city-centre trips that had no jeepney
(reason "centro") now list jeepneys after the tricycle. Jeepney options: 250 → 334.

## Tests

- Gates: eslint (0 errors, 8 warnings, all in untouched files), typecheck, check:boundaries, `pnpm test` (178 files,
  2,293 tests).
- E2E (mobile, PORT=3571): `anywhere-alight.spec.ts` and `far-cards.spec.ts` pass; `offline.spec.ts` 20/21. The one
  failure ("route detail draws its path from the stored lines…") fails the same way on unchanged master code.

## Conflicts

- **Loop C title.** The owner wrote "Centro-Panganiban-Del Rosario" for Loop C. The traced R8-C path never reaches
  Panganiban Drive or Del Rosario (easternmost point lng 123.201; Del Rosario is at 123.2375), and the RL01/RL02 street
  list has neither. The ordinance-derived title is shown. The owner's wording matches **R4** exactly (Panganiban Dr
  2,992 m + Maharlika Hwy to Del Rosario); R4 shows its official name "Centro-Del Rosario via Panganiban Drive".
- **Loop D title.** "Centro-Francia-Magsaysay-Diversion" is kept: Magsaysay and Roxas (Diversion) are on the path and
  Peñafrancia is in the ordinance list, but the traced Loop D runs on Peñafrancia under 100 m. The same wording fits
  Loops A and B better (Peñafrancia 888–1,354 m); the owner may have meant those.
- **"Diversion" = Roxas Avenue** rests on the owner report U03 (via group label "Roxas (Diversion)").

## Still unverified

- Letters for R1, R3, R4 and R5 (none shown); B by name and direction only; E, I, J from one owner photo.
- Owner titles for R1, R5 and Loop D; the centro anchor radii; the 2.0 detour factor (owner-tunable).
- TODA names: none on file for any located terminal.
