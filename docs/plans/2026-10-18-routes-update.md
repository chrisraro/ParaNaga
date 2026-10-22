# Routes update: stop-sign letters for the Naga PUJ routes (2026-10-18)

Status (2026-10-22): superseded by 2026-10-20-route-tally.md (its inferred letters were later removed).

Branch `feat/routes-update` (worktree `.worktrees/routes-update`, from origin/master cf97f2b). Data and
import code only, plus search and one route-detail caption. No migration and no new stop points. The
planner is unchanged, and the 200-trip regression digest passes without re-recording.

## Evidence

- **U04 (new): the owner's field photo, 2026-10-18.** It shows a PUJ stop sign at CSNHS for
  southbound traffic. Each row has a coloured letter and a route name: B (blue) Naga Loop Service;
  E (yellow) Centro - Del Rosario via Magsaysay Ave; G or H (orange) Centro - San Felipe; I (teal)
  Centro - Pacol; J (green) Centro - Carolina - Panicuason; G or H (purple) Centro - Cararayan -
  San Isidro. The owner contributed it as field evidence with no URL. Rights: owner-contributed
  (`rights-catalog.json`, status `owner_report`).
- **The web search on 2026-10-18 found no source for the E–J lettering.** The places checked were
  naga.gov.ph ordinances and resolutions, the LPTRP draft and the enacted ordinance, LTFRB and DOTr,
  OSM, news, and the city commuter guide. The current legal network numbers its routes 1 to 8, and
  only Route 8 has letters: Loops A to D. The sources used are:
  - Ord 2025-070, enacted 2025-09-23 (RL01, N30, S01).
  - The LPTRP draft NB8 2025-1008, which matches RL01:
    https://www2.naga.gov.ph/wp-content/uploads/2025/09/NB8_2025-1008-Hon.-Buenafe-NC-Public-Transport-Route-Rationalization.pdf
    (retrieved 2026-10-18).
  - Res 2025-128 (RL02), Res 2025-172 (RL03) and Res 2025-735 (RL04).
- **Older letters exist in RL06, RL09 and RL10.** They come from Ord 2001-040 and Ords 98-013,
  99-065, 99-064 and 2014-053. The letters are Magsaysay Loops A and B, Loops C and D
  (Bagumbayan-Calauag), and multicab Loops G, H, I and J. These are a different and older scheme
  (CX11).
- **Ord 1996-069 gave colour-coded panel routes, but its colour table was not retrieved.** No colour
  is stored. Its catalogue page is https://www2.naga.gov.ph/transport-and-traffic/ (RL18), retrieved
  2026-10-18.

## Route table (letter to old code)

| Letter | Name on sign | Our code | Official (Ord 2025-070) | Terminals and via (legal plan) | Behaviour | Confidence | Sources |
|---|---|---|---|---|---|---|---|
| A | (not on this sign) | R8-A | Route 8 Naga Loop Service A | Gen. Luna to P. Burgos, Peñafrancia, Magsaysay, Taal, J. Miranda, Mayflower, Magsaysay, Roxas, Bicol Central Station, Roxas, Fraternidad, Biak na Bato | loop, clockwise | official name; the letter on a sign is not seen | RL01 |
| B | Naga Loop Service | R8-B | Route 8 Loop B | The Loop A streets in reverse; runs southbound on Peñafrancia past CSNHS | loop, counterclockwise | name official; sign letter B matched by name and direction (unverified) | RL01, U04 |
| C | (not on sign) | R8-C | Route 8 Loop C | Gen. Luna, P. Burgos, Peñafrancia, Diaz, Elias Angeles, Bagumbayan Sur, M.T. Villanueva, Magsaysay, Roxas, Fraternidad, Biak na Bato | loop, clockwise | official name | RL01, RL02 |
| D | (not on sign) | R8-D | Route 8 Loop D | The Loop C streets reversed (with Caceres) | loop, counterclockwise | official name | RL01, RL02 |
| E | Centro - Del Rosario via Magsaysay Ave | R2 | Route 2 | Del Rosario (Maharlika Hwy), Magsaysay, Peñafrancia, Diaz, Elias Angeles, Padian (Centro) | two-way | letter: owner photo only (unverified); route by exact name | U04, RL01 |
| F | not on sign, not found | (R3?) | Route 3, Del Rosario via Roxas | AH26, Roxas, Fraternidad, Biak na Bato, Gen. Luna, P. Burgos, J. Hernandez | circuit | **missing**; F = R3 is an inference only, not stored | none |
| G | not on sign, not found | (R4?) | Route 4, Del Rosario via Panganiban | AH26, Panganiban, Peñafrancia, Arana, J. Hernandez, Caceres, Dinaga | circuit | **missing**; inference only, not stored | none |
| G or H (blurred) | Centro - San Felipe | R5 | Route 5 | Pacol Rd, Peñafrancia, Diaz, Elias Angeles, Padian, Gen. Luna | two-way | route by name; **letter excluded** (CX12) | U04 |
| I | Centro - Pacol | R6 | Route 6 | Pacol Rd, Peñafrancia, Diaz, Elias Angeles; out via Padian, Dinaga | two-way | letter: owner photo only (unverified) | U04, RL01 |
| J | Centro - Carolina - Panicuason | R7 | Route 7 | Panicuason Rd, Carolina Rd, Pacol Rd, Peñafrancia, Diaz, Elias Angeles | two-way | letter: owner photo only (unverified) | U04, RL01 |
| G, H or K (blurred) | Centro - Cararayan - San Isidro | R1 | Route 1, Centro - San Isidro via Cararayan | Cararayan-San Isidro Rd, Balatas, Magsaysay, Peñafrancia, Diaz, Elias Angeles, Caceres; out via Panganiban, Dayangdang | two-way | route by name; sign name stored as an alias; **letter excluded** (CX12) | U04, RL01 |
| K | not found | (R1?) | none | none | none | **missing** | none |

Operating cooperatives are unchanged (the existing `cooperatives` records). The fleet is unchanged:
traditional jeeps on every route, and modern jeeps only on R4 and R7 (U01). There are no e-jeepneys.
Fares are unchanged and estimate-only.

Letters found are B, E, I and J from the sign, and A, C and D as official loop names. Letters still
missing are F, G, H and K, plus the exact San Felipe and Cararayan letters.

## What changed in the data

`data/source/research/naga-modes-seed-2026-10-16.json` was revised in place, following the
revised-seed policy in ADR 010. Its new hash makes a batch `modes-2026-10-16.<n>`. The changes are:

- **Source U04** (`user_report_unverified`).
- **Conflicts CX11 and CX12.**
- **New `routeAliases` section (RA01 to RA11).** Each alias has kind `signboard`, `isHistorical:
  false`, an evidence level and sources.
  - RA01–RA04 "Naga Loop Service A/B/C/D" go to R8-A..D. Evidence: official (RL01, RL02).
  - RA05 "B" goes to R8-B (U04, RL01). RA06 "E" goes to R2, RA07 "I" to R6 and RA08 "J" to R7.
    Evidence for all four: `owner_report_unverified`.
  - RA11 "Centro - Cararayan - San Isidro" goes to R1 (U04, RL01).
  - RA09 (R5 "H") and RA10 (R1 "G") are **excluded**, with the reason recorded (blurred letter).
- **Code:**
  - The schema `src/domain/import/modes-seed.ts` adds the `RouteAlias` record type (strict) and
    validation. Each alias must name a known route, cite known and non-excluded sources, and follow
    the owner-only evidence rule. One current alias text can name only one route, and an alias may
    not equal a route code.
  - The importer `scripts/lib/modes-plan.ts` and `modes-writer.ts` write `transit.route_alias` rows
    plus revision members. `route_alias` is a modes-owned kind. An identical row is reused, and a row
    that differs is refused.
  - Search: the search index routes carry `aliases`. "E", "Route E" and the sign name find the
    route, with the subtitle "Also called E".
  - Route detail: the caption reads "Also signed B · Naga Loop Service B · not yet verified".
- **No new stop points or terminals.** The sign's position is not recorded in any source, so
  nothing gets a coordinate. The "Unverified route" and "approximate path" honesty is unchanged.

## Conflicts

- **CX11: the old ordinance letters differ from the 2026 sign.** In the old scheme, I and J were
  multicab loops; on the sign, I is Pacol and J is Panicuason. The sign is newer, and the old
  letters are not kept.
- **CX12: the San Felipe and Cararayan letters are blurred.** Possible readings are G or H, and K
  for Cararayan.
  - If the letters followed the plan numbers with an offset of 3 (E = 2, I = 6, J = 7), then San
    Felipe (Route 5) would be H, R3 would be F and R4 would be G.
  - Cararayan (Route 1) would then collide with Loop D, so it may be K, and K and H look alike when
    blurred.
  - All of this is inference, and nothing is stored from it.
- **The loop direction is unconfirmed on the street.** The legal plan has Loop B running
  counterclockwise, and B is matched by name and the southbound side of the stop. No street
  observation confirms it.

## Still unverified or missing

- **The letters F, G, H and K**, and which of them belong to R3 (Roxas) and R4 (Panganiban).
- **The San Felipe and Cararayan letters.** A clearer photo or a city document would settle them.
- **Route colours.** None are stored, because the sign colours come from one photo.
- **Stop names and coordinates for any letter route.** No source gives a stop list. The only stops
  on file are still the provisional Loop A–D public map pins.
- **Whether the lettering is citywide or only on some signs.**

## Tests

- `tests/unit/import-modes-seed.test.ts` (new block):
  - the real file validates;
  - every alias names an LPTRP route and cites known sources;
  - the letters map B to R8-B, E to R2, I to R6 and J to R7;
  - current aliases are unique;
  - sign letters are `owner_report_unverified` and cite U04;
  - RA09 and RA10 are excluded;
  - the validator refuses an unknown route, a duplicate letter, an unknown source, owner-only
    evidence labelled official, and an alias that equals a route code;
  - the section defaults to empty.
- `tests/unit/import-plan.test.ts`: the counts change (sources 135, conflicts 12, route_aliases 9),
  and the planned aliases are listed.
- `tests/unit/search.test.ts`: E, Route E, route i and J find R2, R6 and R7, and the sign name
  finds R1. A code match keeps a plain row.
- `tests/integration/import-modes-seed.test.ts`: the published revision has 9 `route_alias`
  members. This test runs in CI only.
- Local gates are green:
  - `pnpm exec eslint src tests scripts` (warnings that were already there only);
  - `pnpm typecheck`;
  - `pnpm check:boundaries`;
  - `pnpm test`: 162 files and 2023 tests, with the planner regression digest unchanged;
  - `node scripts/check-source-rights.mjs`;
  - `pnpm db:import --dry-run`, run without database variables: no problems, route_aliases 9, and
    RA09 and RA10 listed as excluded.

## Import (controller runs; nothing was imported by this branch)

Run these after the PR is merged and deployed. Deploying first is safe because an older snapshot
reads `aliases` as `[]`. Follow the usual Neon order: take a backup branch first, use the owner
connection `DATABASE_URL_UNPOOLED`, and never print it.

```
pnpm db:import --dry-run   # expect: modes counts route_aliases 9, sources 135, research_conflicts 12; RA09/RA10 excluded; no problems
pnpm db:import --commit    # writes revised batch modes-seed:2026-10-16:<sha12>, publishes modes-2026-10-16.<n>, then anywhere-alight-2026-10-16.<n>
```

Smoke test afterwards:
- search "E" shows R2 with the subtitle "Also called E";
- the R8-B detail caption shows "Also signed B · Naga Loop Service B · not yet verified";
- the Plaza Rizal to Pacol trip is unchanged.

Rollback: re-publish the previous revision label noted before the commit.
