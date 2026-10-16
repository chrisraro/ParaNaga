# Plan: all modes, terminals, map lines and time estimates (Increment D)

Date: 2026-10-16 · Branch: `feat/modes-lines-eta` (worktree `.worktrees/modes-lines-eta`, from master `e77c081`, which holds increments 1–A: data import, provisional Loop A/B planner, commuter screens, OSM places, guidance, offline PWA).
Research: `.superpowers/research/naga-transport-research-2026-10.md` (sources N01–N41, Jev scores, including the section "Modernized jeepneys: Del Rosario and Pacol–Carolina–Panicuason") and `.superpowers/research/naga-transport-candidates-2026-10.json` (routes, terminals, fares, ETA inputs, cooperatives, claim tests).
Spec: `docs/spec/02-features.md` (F-A1 map layers, F-A5 terminals, F-A6 routes and shapes, F-B1/F-B2 trip options and detail, F-B3 guidance), `03-architecture.md` (§3.4 request paths, §3.6 planner, §3.7 fares, §3.11 PWA), `04-data-model.md` (`shape_version`, `terminal`, `fare_rule`), `06-screens.md` (S1, S4, S5, S6–S9, S11, S12, §6.5 copy rules, §6.6 accessibility).
Earlier plans: `2026-10-15-data-and-provisional-planner.md`, `2026-10-15-maps-core.md`, `2026-10-16-commuter-screens.md`. Their decisions still apply unless this plan names the one it replaces.

Goal: show every mode the research supports (jeepneys with their mixed fleets, tricycles and e-tricycles, UV Express, buses, rail stations), their terminals per mode, an approximate path for each route, a walk-and-ride guide on the map when start and destination are set, and an honest time estimate that knows the documented peak windows. Everything is labelled as an estimate with its basis, and nothing new is planned on routes that have no sourced stop order.

User requests (2026-10-16): show all routes; add tricycle and other options; label each route and option by vehicle type (traditional PUJ, modern jeepney, e-jeepney, tricycle, e-tricycle, UV Express, bus); when start and destination are set, draw walking as a dotted line and rides as solid lines coloured by vehicle type, with a legend; show terminals per mode; show a time estimate aware of rush hour and daily traffic; use the deep research with Jev.

## Data reality (binding for every task)

### What the research supports

| Topic | What exists | Sources | How it is shown |
|---|---|---|---|
| Jeepney network | Ordinance 2025-070 (LPTRP): 8 groups, 11 route records R1–R8-D, 282 units, all "PUJ Class 2". No 2026 amendment. Street lists only. | N30 (S01/S02 already in seed) | Unchanged legal plan. The "Class 2" text is the planned class, not what runs today. |
| Loops A/B | Provisional pin order A1…A30, B1…B31 (earlier decision). | S39/S40 | Planned (provisional), badged. |
| Loops C/D | 2025 dry-run street sequences match the seed. No pin order. | N10 | Path drawn from streets only. Not planned. |
| Fleet per route (controller ruling, 2026-10-16) | **R4** Centro–Del Rosario via Panganiban: traditional (LPTRP) and modern. NACIATRASCO launched about 10 air-conditioned modern units on 17 Apr 2023 [N14]. 10 units reported Jan 2024 [N38]; still operating May 2024 [N39]. **R7** Centro–Carolina–Panicuason: traditional and modern. 5 NACIATRASCO units Jan 2024 [N38]; 5 CAPATRANSCO units on installment, Jun 2024 [N15]; possibly the same vehicles. **R2, R3, R6**: modern units "reported, not confirmed". Sources are a private guide [N20] plus the user's own report (recorded as source type "user report, unverified"). Everything else: traditional only (LPTRP). | N14, N15, N20, N30, N38, N39, N40, N41, U01 | Per route: a list of vehicle classes, each with its evidence level and last-reported date. |
| E-jeepney | One legal route from 2017 (Ordinance 2017-036, Villa Corazon–Almeda–Roxas–BCS–LCC loop). Jev gives p = 0.07 that it runs now. No route has confirmed electric propulsion. | N09, N20 | Shown as "documented 2017 route · status unknown, not confirmed running". Not planned. **No LPTRP route is labelled e-jeepney.** |
| Cooperatives | Registered names (OTC masterlist, July 2023). Corridor links from CDA and news. Chairperson names conflict between N14/N40 and N41. | N14, N15, N38–N41 | Cooperative names on route detail, with source and date. **Never chair names or addresses.** |
| Tricycles | Fare: ₱15 minimum (Ordinance 2024-002) with a 20% discount for listed groups. Discount eligibility is unverified, so it is not applied. Authorized feeder routes: VISTODA/LAVISTODA (Ordinance 2025-067: 33 units; Langon–Ateneo via Vistansa, Langon–Centro Cararayan via Salunguigui; waiting areas Deca Vistansa and Cararayan Proper) and Deca Vistansa–Langon (Ordinance 2025-023: 10 units; probably superseded). One OSM terminal: Balatas Tricycle Terminal. | N05, N06, N33, N02 | Feeder routes, terminals and a "Tricycle may serve this" hint (below). |
| E-tricycles | A franchise is required (Ordinance 2025-128). Same ₱15 fare. No routes, terminals or unit counts. | N08, N33 | Shown in "Vehicle types in Naga" and the legend only. Nothing on the map. |
| Terminals and loading points | OSM coordinates (community, ODbL) for BCS, Northbound, LCC, PNR, Eaglestar, Milaor, the Dinaga/Pacol/Carolina/Del Rosario jeepney stations, the Plaza Rizal platform and Balatas tricycle. No coordinates for the Eastbound terminal (street conflict) or the VISTODA waiting areas. | N02, N12, N19, N31 | Terminals layer with a mode filter. Coordinate badge "Community-mapped location (OpenStreetMap)". |
| UV Express / buses | Regional. Routes mapped in OSM (Goa, Lagonoy, Sabang, Pasacao, Tabaco UV, PITX, Santa Rosa ITT). National rates from 28 Sep 2026: UV provisional ₱2.60 (traditional) or ₱3.00 (modern) per km; bus ordinary ₱12 for the first 5 km + ₱2.20/km; aircon ₱2.45, deluxe ₱2.60, super deluxe ₱2.70, luxury ₱3.35 per km. | N01, N17 | Terminal destinations with fare estimates. Not drawn. Not planned. |
| Jeepney fares | F01 ₱14 + ₱2.00/km and F02 ₱17 + ₱2.40/km (first 4 km), effective 28 Sep 2026. **Checked: the seed's F01/F02 already equal the national rates [S05/S06]. N17 and N32 confirm them.** The local matrix is not retrieved. | S05, S06, N17, N32 | Values unchanged. Sources added. "Estimate" labelling kept. |
| Road network | OSM highways (ODbL). No intra-city PUJ route relation exists in OSM. | N01 | Basis for the approximate paths and the walk graph. |
| Speeds | Walking 4.238 km/h [N28]. Naga jeepney baseline about 10 km/h [N16]. Comparable-city observed peak 13.3–15.4 km/h [N29]. LPTRP planning assumption 30 km/h (upper bound only, never used). | N16, N28, N29 | ETA model parameters. |
| Peak windows | 06:00–08:00, 11:00–13:00 and 16:00–19:00 (Ordinance 2025-110, Roxas Ave truck-ban hours; the most recent official statement). | N04 | Slower ride band inside these windows. |

### What stays unknown, and is never shown as known

- **Vehicles and service:** headways, waiting times and dwell times; service hours; which vehicle a given trip will get; propulsion (electric or diesel) on any route; 2025–2026 modern unit counts.
- **Route geometry:** verified route shapes; the true path between two streets on the legal list; curb and boarding sides.
- **Tricycles:** tricycle zones and TODA terminals (the 2025 LPTRP zone map was not retrieved); tricycle speed (the PIDS 19.9 km/h figure is unverified and is not imported); the tricycle distance matrix.
- **Terminals:** franchise status of the Northbound and LCC terminals; the Eastbound terminal's location. The OSM "UV-Express Southbound Terminal" is a conflict and stays off the map.
- **Fares and rail:** regional ticket prices after 28 Sep 2026 (the Jan 2026 prices have Jev p(current) = 0.09 and are not used); PNR timetable and fares.
- **Traffic:** live or typical traffic. There is no third-party traffic API (Jev 1.0).
- **Day of week:** no source gives day-of-week variation, so the peak windows apply every day (D9).

## Decisions

### Jev decisions (model `typesafe/jev-1.13-20260917`; the user delegated product calls to Jev) — binding

- **J1 Ride lines (p 0.96).** At import time, precompute an approximate path for each route variant by following the LPTRP street list on the OSM road network. The road snapshot is pinned, dated, stripped of contributor data, and carries ODbL attribution. Draw it solid in the mode colour, always labelled **"Approximate path, not a verified route shape"**. For Loops A/B the path must also pass the provisional pins in order.
- **J2 Walk lines (0.94).** Compute the shortest path on a bundled OSM walkable-street graph for Naga, on the phone (works offline, within a size budget). Draw it dotted and label it approximate. When the graph has no path, fall back to a straight dotted line.
- **J3 ETA (1.0).** Use ParaNaga's own range model:
  - walking at 4.24 km/h;
  - a jeepney speed band, slower in the peak windows (Asia/Manila);
  - boarding wait shown as unknown;
  - always labelled as an estimate with its basis; never "arriving in";
  - no third-party traffic API.
- **J4 Tricycles (1.0).**
  - Show tricycle terminals and the two documented feeder lines, with their sources.
  - Offer "Tricycle may serve this" only from documented terminals, with the ₱15 minimum fare estimate (discount not applied) and "confirm with the driver".
- **J5 E-jeepney 2017 (0.99).** A documented 2017 route with status "unknown, not confirmed running". Not used for planning.
- **J6 UV Express and buses.** Regional. Show their terminals (OSM coordinates where available) and destinations, with fares from the 28 Sep 2026 per-km rules as estimates. Not part of intra-city planning.
- **J7 Jeepney fares.** National 28 Sep 2026 rates, checked against F01/F02. Update the sources. Keep the "Estimate" label.
- **J8 Vehicle class per route only from sources.** Otherwise "vehicle type not confirmed".

### Controller rulings (2026-10-16, mixed fleets)

- **C1 Mixed fleet model.** A route lists several vehicle classes. Each class carries an evidence level, a first- and last-reported date, a unit note and sources (table `transit.route_vehicle_class`, migration 0006).
- **C2 R4.** Traditional PUJ (LPTRP) plus modern PUJ (NACIATRASCO, about 10 air-conditioned units, launched 2023-04-17, last reported May 2024 [N39]). Label: **"Traditional and modern jeepneys · modern units last reported May 2024"**.
- **C3 R7.** Traditional plus modern (NACIATRASCO / CAPATRANSCO, about 5 units, 2023–2024). Label: **"Traditional and modern jeepneys · modern units last reported June 2024"**. Note that the two cooperatives' 5 units may be the same vehicles.
- **C4 R2, R3, R6.** Modern units are "reported, not confirmed" (private guide N20, plus user report U01 recorded as "user report, unverified"). Label: **"Traditional jeepneys · modern units reported, not confirmed"**.
- **C5 No route is labelled e-jeepney.** The e-jeepney class appears only on the 2017 historical route.
- **C6 Fares.**
  - A modern-only option would use the national modern rate as an estimate.
  - When a route has both classes, the range spans the traditional minimum to the modern maximum.
  - Because no route's street fleet is confirmed as one class (the LPTRP record is a planned class), every current jeepney leg keeps the F01–F02 span. This matches today's `fares.ts`.
- **C7 Chips per option.** Show vehicle-class chips per ride, for example "Jeepney · modern units reported".
- **C8 Cooperatives.**
  - Names may be shown on route detail with source and date.
  - The conflicting chair names are recorded in the conflicts register and never shown. Addresses are never shown either.
  - A registry-only cooperative whose name matches a corridor is shown as "Registered cooperative whose name matches this corridor (OTC masterlist, July 2023) · route not confirmed".

### Defaults decided here (Jev-decidable; change before Task 1 if you disagree)

- **D1 Reviewed seed file.**
  - The research JSON is never read by the app or the importer.
  - `scripts/draft-modes-seed.ts` (one-off) transforms it into `data/source/research/naga-modes-seed-2026-10-16.json`. The file is then reviewed by hand, record by record: each record carries `review: { decision: "import" | "exclude", reason, reviewedOn }`.
  - The importer reads only that reviewed file.
  - It is not stored under `Data_Sets/`, because that folder is the original research package and `readDataFiles("Data_Sets")` reads every file in it.
- **D2 Source codes.** Import N01–N41 into `ingest.source` with codes `N01`… Add the user report as **`U01`** (title "User report to ParaNaga (2026-10-16): modern jeepney units on Del Rosario and Pacol routes", evidence type `user_report_unverified`, no URL). Add `OSMR-YYYY-MM-DD` for the road snapshot.
- **D3 Fleet colours.**
  - Line colour comes from the fleet classes with evidence of news report or better: a single class gives a solid line in that class's colour. Traditional plus modern (R4, R7) gives a solid two-tone line: a traditional base with modern overlay segments (24 px on, 24 px off over the base, so there are no gaps). The legend calls this "Traditional and modern (alternating colours)".
  - Classes that are only "reported, not confirmed" never change the colour. They appear as text on the chip.
  - A route with no class record uses the "vehicle type not confirmed" colour.
- **D4 Regional lines are not drawn.** They leave the map's bounds (Naga only). Terminal detail lists their destinations instead.
- **D5 Regional distances.**
  - The owner-run road fetch also measures each listed OSM regional route relation. It stores only id, version, timestamp, name, ref and length_km, never the geometry.
  - A destination without a relation shows "distance not on file" and its per-km rate, with no total.
- **D6 Trace quality gate.** A variant gets a published path only when:
  - every listed street matches at least one OSM way (or a reviewed alias);
  - no more than 15% of the path's length is on streets that are not on the list;
  - the path is continuous;
  - for Loops A/B, every pin snaps within 60 m of the road graph.

  Otherwise the variant shows **"Path could not be traced from the street list"** and has no line. Failing variants are reported in the import dry-run. They do not abort it.
- **D7 Walk graph budget.** At most **600 KB** of JSON (identity-encoded, before HTTP compression) and at most **220 KB** gzip, enforced by a unit test on the real build. Coordinates use precision 5 (about 1.1 m). Degree-2 nodes are contracted into edge polylines. Excluded: `highway=motorway|motorway_link|construction|proposed`, `foot=no`, and `access=private|no` unless `foot=yes|designated`. Snap radius is 100 m; beyond it the walk falls back to a straight line.
- **D8 Walk time range.**
  - Low end: `d / 4.238 km/h`. High end: the low end × **1.25** (assumption A1, "crossings, waiting at roads, slower walkers"; stored with `is_assumption = true` and no source).
  - `d` is the graph path length. When there is no graph path, `d` is round(straight-line × 1.3), as today.
- **D9 Ride band.**
  - Off-peak: **10–15 km/h** (N16 baseline, N29 observed upper).
  - Peak: **7–13 km/h**. The 13 is N29's 13.3 rounded down. The 7 is assumption A2: 30% below the Naga baseline, flagged as an assumption.
  - Peak windows come from N04 and apply every day (assumption A3: there is no day-of-week source).
  - A trip uses the peak band when [departure, departure + total high estimate] overlaps a window.
  - Departure is "now" on the device clock, converted to Asia/Manila as fixed UTC+8 (no DST).
- **D10 Wait.** Waiting is not estimated: the research found no published headways for Naga. Every total says **"+ waiting (unknown)"** once per ride. There is no range for waiting.
- **D11 Tricycle time.** No tricycle speed is imported, so a tricycle never adds minutes. The hint card says "Tricycle time not estimated".
- **D12 Durations only, never clock times.** For example "Estimate 18–27 min + waiting (unknown)". There is no "arrive by". In UI copy the word "ETA" is never used; the copy says "time estimate".
- **D13 Ride distance basis.**
  - When a variant has a published path, ride distance is measured along the path between the board and alight pins (pin measures stored at import). Fares and time estimates both use it, labelled "distance along the approximate path".
  - Otherwise the existing straight-line stop-to-stop sum is used, labelled so.
  - The planner's walk caps stay on straight-line distance (unchanged).
- **D14 "Must save walking" re-check on the phone.**
  - After the walk paths are computed, compare like with like: if the direct walk and every walk leg of an option have graph paths, compare graph lengths. Otherwise compare the ×1.3 estimates (today's rule).
  - Options that fail are dropped. If none remain, show the existing `walk_shorter` state.
- **D15 Tricycle hint rule.**
  - **Trigger.** A "Tricycle may serve this" card appears below the trip options (it is not a ranked option) when either:
    - a published tricycle terminal with a coordinate lies within 600 m straight-line of the start or destination; or
    - a published tricycle feeder path passes within 300 m of either.
  - **Content.** The card shows the terminal or feeder, the distance, "Routes and zones are not documented", "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver", and "Tricycle time not estimated".
  - **Map.** The terminal marker is emphasized. No ride line is drawn for the tricycle.
- **D16 Routes overview on by default.** The user asked to "show all routes". On the home map without a trip, the Routes layer is on, showing the jeepney routes plus the tricycle feeder routes.
  - The 2017 e-jeepney route is behind the switch "Show historical routes" (off by default).
  - When a trip is shown, the overview is hidden and the trip's lines are drawn instead.
  - Layer and filter choices are a device preference.
- **D17 Terminal records.**
  - The terminal identities T01–T06 are kept. New terminals become T07…T16 (see Task 1).
  - `transit.terminal` gains versions (`terminal_version`). Old revisions keep pointing at the legacy row (`version_id = entity_id`), so rollback still works. New revisions point at version rows.
- **D18 Lines and the walk graph are separate immutable resources** (`/api/v1/network/lines/:revisionId`, `/api/v1/network/walk-graph/:revisionId`). They are not part of the snapshot, which stays small for planning. The walk graph is fetched lazily, the first time a trip is shown, and then cached. It is not prefetched when low-data mode or `navigator.connection.saveData` is on.

### Decisions this plan replaces

- "No drawn path" (data-and-provisional-planner, provisional routing) is replaced by J1/J2: approximate paths are drawn, always labelled.
- "There are no times / no time fields" (commuter-screens, guidance Task 9, Help "How trips are planned", the saved-card meta line "Time not available") is replaced by J3/D8–D12: duration ranges labelled "Estimate", with their basis.
- "Walking distances are straight-line estimates (× 1.3)" is replaced by D8/D14: the graph path where one exists, else × 1.3, labelled which.

## Global Constraints

- **Stack and rules unchanged.**
  - Next.js 16.4: read `node_modules/next/dist/docs/` before Next-specific code (AGENTS.md).
  - React 19, strict TS, Tailwind v4 tokens, React-Leaflet (no MapLibre).
  - `src/domain/**` is pure. `src/client` and `src/ui` never import `src/server`. Every server module imports `server-only`.
  - All DB access goes through `withRequestContext`. Zod at every boundary: API params and bodies, cached JSON, `localStorage`/IndexedDB reads, seed and snapshot files.
  - No secrets are printed or committed. `pnpm check:boundaries` and `pnpm check:bundle-secrets` stay green.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Database.**
  - Hand-written migrations `0006`–`0008`. Every new table has `ENABLE` + `FORCE ROW LEVEL SECURITY`, `paranaga_app` select through `using (true)` policies, and writes only by `paranaga_import` on draft rows. `pnpm db:check-rls` passes.
  - PostGIS calls are schema-qualified (`extensions.…`). Every new transit row carries `is_synthetic`, and `transit.publish_revision` refuses synthetic rows.
  - Integration tests run on a throwaway Neon branch (`scripts/with-neon-branch.sh`), never on `main`.
- **No network at import, build or runtime** except the owner-run fetch scripts (`scripts/fetch-osm-roads.ts`). Snapshots are committed, dated and stripped of `user`/`uid`/`changeset`. They are read only from disk (same rules as `data/source/osm/README.md`). There is no third-party traffic, routing or geocoding API.
- **Licences.**
  - Everything derived from OSM (paths, walk graph, terminal coordinates, regional lengths) is a derived database under ODbL 1.0.
  - Whenever lines, walk paths or OSM terminal coordinates are on screen, the map shows **"Map data © OpenStreetMap contributors"**, linked to `https://www.openstreetmap.org/copyright`. This applies in low-data mode too; today's "Boundary" prefix becomes "Map data".
  - Terminal detail with an OSM coordinate also shows the `OsmAttribution` line.
- **Honesty.**
  - Every ride line says "Approximate path, not a verified route shape". Every walk line says "Approximate walking path · crossings not checked", or "Straight line · no street path found".
  - Every time is a range labelled "Estimate", with a "How times are estimated" link and "+ waiting (unknown)" when the trip has rides.
  - A vehicle class appears only with its evidence label and date. "Vehicle type not confirmed" is shown when there is no record.
  - Copy never says: "live", "arriving", "arrives in", "ETA", "guaranteed", "official" (except a cited official source), or "e-jeep" for any LPTRP route.
  - Existing badges stay: `Unverified route — confirm with the driver`, `Mapped candidate`, `Documented only`, `Trial — permanence unconfirmed`.
- **Accessibility (WCAG 2.2 AA).**
  - Colour is never the only cue. Every mode has an icon, a text label and a line pattern (walk dotted, ride solid, mixed fleet two-tone), plus chips with text on the map.
  - Map lines meet 1.4.11 non-text contrast at 3:1 (palette below), and a unit test computes it.
  - Every map layer has a list equivalent. Targets are at least 44 px. The legend is reachable by keyboard.
  - Use `aria-live="polite"` for new time estimates in guidance. Focus rules from earlier plans still apply.
- **Privacy.**
  - Walk routing, time estimates and the tricycle hint run on the device. Nothing new is sent to the server: the plan POST body is unchanged and no time or clock value is sent.
  - The walk graph and lines are public, immutable, per-revision files.
- **Tests and process.**
  - Vitest unit tests for the domain, written TDD with `fast-check` properties where stated. Testing Library for components.
  - Integration tests for Tasks 2, 3 and 7.
  - Playwright mobile project with tiles aborted and fixtures under `tests/e2e/fixtures/network/`. `@axe-core/playwright` runs on every new or changed screen in light and dark, and high-contrast where stated.
  - **Review fix rounds run only the affected Playwright specs; the full suite runs in CI.**
  - **Reviewer "Minor" findings go to `.superpowers/sdd/backlog.md`**; they do not block the task.
  - `pnpm verify` and `pnpm test:e2e` stay green on the branch.

## Colour palette and non-colour cues

**Two palettes.** Leaflet draws the same raster tiles in both themes, so lines usually sit on a light basemap even in dark theme. Lines therefore use:
- **Palette L** (with a white casing) whenever a tile layer is drawn, and in light theme.
- **Palette D** (with a casing of `#0B1220`) only when the theme is dark **and** no tile layer is drawn (low-data mode, or no tile URL), so the line sits on dark land `#1E2633`.

**Why both palettes pass 3:1.** The casing (2 px each side; 3 px in high contrast) means the line's core always touches a known colour, so the core-to-casing contrast holds on any tile colour (parks, water, roads). The table also lists contrast against the plain backgrounds. Ratios are WCAG relative-luminance ratios, computed for this plan.

| Vehicle class / leg | Icon (inline SVG, 20 px) + map chip text | Pattern | L core | vs white casing | vs land `#F2EFE9` | vs OSM road `#FCD6A4` | D core | vs casing `#0B1220` | vs dark land `#1E2633` |
|---|---|---|---|---|---|---|---|---|---|
| Traditional PUJ | side-view jeepney · "Jeep" | solid | `#B45309` | 5.02 | 4.38 | 3.66 | `#F59E0B` | 8.72 | 7.08 |
| Modern PUJ | box minibus · "Modern" | solid | `#1D4ED8` | 6.70 | 5.84 | 4.88 | `#60A5FA` | 7.36 | 5.98 |
| E-jeepney (2017 route only) | minibus + bolt · "E-jeep" | solid | `#15803D` | 5.02 | 4.37 | 3.65 | `#4ADE80` | 10.74 | 8.73 |
| Tricycle | motorcycle + sidecar · "Trike" | solid | `#A21CAF` | 6.32 | 5.51 | 4.60 | `#E879F9` | 7.61 | 6.18 |
| E-tricycle | trike + bolt · "E-trike" | solid (legend only today) | `#0E7490` | 5.36 | 4.67 | 3.90 | `#22D3EE` | 10.36 | 8.42 |
| UV Express | van · "UV" | terminals only | `#BE123C` | 6.29 | 5.48 | 4.58 | `#FB7185` | 6.96 | 5.65 |
| Bus | bus · "Bus" | terminals only | `#6D28D9` | 7.10 | 6.19 | 5.17 | `#A78BFA` | 6.88 | 5.59 |
| Jeepney, type not confirmed | jeepney + "?" · "Jeep ?" | solid | `#57534E` | 7.63 | 6.65 | 5.56 | `#D6D3D1` | 12.57 | 10.21 |
| Walk | walking person · "Walk" | dotted (round caps, dash `1 9`, 5 px) | `#0F1E3D` | 16.49 | 14.37 | 12.01 | `#E2E8F0` | 15.19 | 12.34 |
| Rail (stations only) | train · "Train" | marker only | `#0F1E3D` marker with white glyph | — | 14.37 | — | `#E2E8F0` | — | 12.34 |

**Other cues.**
- **Mixed fleet (R4, R7):** a solid traditional base with modern overlay segments, plus the chip "Jeep + Modern". The legend explains it.
- **Direction:** a chevron marker (in the casing colour, 3:1 against the core) every 250 m on the trip and on route detail.
- **Line widths:** trip ride 6 px core; walk 5 px dots; overview routes 3 px core with 1.5 px casing; selected overview route 5 px. In high contrast every width gets +1 px and the casing is 3 px.
- **Legend swatches** sit on the sheet background: Palette L on white is ≥ 5:1; Palette D on `#111A2E` is ≥ 6.3:1.
- **Mode chips in lists:** icon + text label + a 4 px colour stripe. The text label alone carries the meaning.

Tokens live in `src/domain/modes/palette.ts` (pure, so the unit test computes every ratio) and are mirrored as CSS custom properties in `src/ui/modes/modes.css`: `--pn-mode-{class}`, `--pn-mode-{class}-casing`. Both are selected by `[data-map-surface="light|dark"]` on `.pn-map`, which is set from the theme and whether tiles are drawn.

## New migrations

### `0006_modes_fleet_terminals.sql`

- **`ingest.source.code` check:** also allow `^N[0-9]{2}$`, `^U[0-9]{2}$` and `^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$`.
- **`transit.route`:**
  - Add `mode text not null default 'jeepney' check (mode in ('jeepney','tricycle','uv_express','bus','rail'))`. Backfill: every existing route is `jeepney`.
  - Add `service_status text check (service_status in ('legal_plan','authorized_feeder','historical_unknown'))`. Existing routes are backfilled to `legal_plan`.
  - Add `planning text not null default 'none' check (planning in ('provisional','none'))`, backfilled to `provisional` for R8-A and R8-B only. This is informational; the planner still decides from variants that have stops.
  - The columns are additive and backfilled by the owner migration. Released revisions keep pointing at the same rows.
- **`transit.route_vehicle_class`** (new entity kind `route_vehicle_class`; rows immutable once released; a change is a new row):
  - Columns: `route_id`, `vehicle_class` (check in `traditional_puj`, `modern_puj`, `e_jeepney`, `tricycle`, `e_tricycle`, `uv_express`, `bus`), `evidence_level` (check in `legal_plan`, `official_report`, `news_report`, `registry`, `secondary_claim`, `user_report`), `status` (check in `planned`, `reported`, `reported_not_confirmed`), `first_reported_on date`, `last_reported_on date`, `units_note text` (e.g. "about 10 air-conditioned units"), `cooperatives text[]` (names only), `source_codes text[]` (check: cardinality ≥ 1), `conflict_notes text[]`, `notes`, `is_synthetic`.
  - Unique (`route_id`, `vehicle_class`, `evidence_level`, `last_reported_on`).
  - Check: `status = 'reported_not_confirmed'` exactly when `evidence_level in ('secondary_claim','user_report')`.
- **`transit.route_cooperative`** (entity kind `route_cooperative`):
  - Columns: `route_id`, `name`, `basis` (check in `corridor_reported`, `name_matches_corridor`), `source_codes`, `reported_on date`, `notes`, `is_synthetic`.
  - **There is no column for chair names or addresses.**
- **`transit.terminal_version`** (D17):
  - Columns: `terminal_id`, `name`, `kind` (check in `terminal`, `loading_point`, `waiting_area`, `station`), `location_text`, `modes text[]` (each in the mode list), `modes_raw text[]` (verbatim), `mode_sources jsonb` (`{mode: [codes]}`), `geog geography(Point,4326)` (nullable, with the service-area check from 0001), `coord_source` (check in `osm_node`, `osm_way_centroid`), `osm_type`, `osm_id`, `osm_version`, `osm_timestamp`, `coord_note`, `verification text`, `status_note text`, `notes`, `source_codes`, `content_hash`, `is_synthetic`, `created_at`.
  - Check: when `geog` is not null, `coord_source`, `osm_type` and `osm_id` are not null. A GiST index on `geog`.
  - The legacy `transit.terminal` row stays the identity. A membership with `version_id = entity_id` means "legacy row" (old revisions); new revisions use version rows.
- **`transit.regional_service` + `regional_service_version`** (entity kind `regional_service`):
  - `regional_service`: `code` `^RS[0-9]{2}$`.
  - `regional_service_version`: `mode` (`uv_express`, `bus`, `jeepney`), `name`, `operators text[]`, `terminal_code`, `destination`, `osm_relation_ids bigint[]`, `osm_relation_versions int[]`, `distance_km numeric` (nullable; from D5), `distance_basis text`, `status` (`community_mapped`), `fare_rule_codes text[]`, `source_codes`, `content_hash`, `is_synthetic`.
- **`transit.revision_member.entity_kind` check:** add `route_vehicle_class`, `route_cooperative`, `regional_service`.
- **`transit.publish_revision`** (`create or replace`, keeping every 0003 check):
  - New kinds join the synthetic check. `terminal` accepts a legacy row or a version row.
  - A `route_vehicle_class` or `route_cooperative` whose route is not a member is refused.
  - A `regional_service` whose `terminal_code` is not a member terminal is refused.
- **RLS** on all new tables as in the Global Constraints.

### `0007_shapes_walk_graph_eta.sql`

- **`transit.shape`** (`id`, `variant_id` unique, `is_synthetic`) **and `transit.shape_version`** (entity kind `shape`):
  - Columns: `shape_id`, `geog geography(LineString,4326)`, `length_m numeric not null check > 0`, `evidence_kind text check in ('approximate_street_trace')`, `approximate boolean not null default true check (approximate)`, `label text not null default 'Approximate path, not a verified route shape'`, `stop_measures jsonb` (`[{seq, stopPointVersionId, measureM, snapM}]`, null for variants without stops), `trace_quality jsonb` (matched and unmatched streets, off-list share, max snap, builder version), `inputs_hash text` (street list + pin ids + road snapshot sha256), `road_source_code text not null`, `content_hash`, `is_synthetic`, `created_at`.
  - Check: `ST_CoveredBy` of the service area buffered by 200 m.
  - This is spec 04 `shape_version` with the evidence kind narrowed to what exists.
- **`transit.walk_graph` + `walk_graph_version`** (entity kind `walk_graph`):
  - `walk_graph`: `key` unique, `naga-walk`.
  - `walk_graph_version`: `format_version int`, `payload text not null` (compact JSON, Task 6), `bytes int check (bytes <= 614400)`, `sha256`, `node_count`, `edge_count`, `road_source_code`, `builder_version`, `content_hash`, `is_synthetic`.
- **`transit.eta_param` + `eta_param_version`** (entity kind `eta_param`):
  - `eta_param`: `key` check in `walk_speed_kmh`, `walk_slowdown_factor`, `jeepney_speed_offpeak_kmh`, `jeepney_speed_peak_kmh`, `peak_windows`.
  - `eta_param_version`: `value_low numeric`, `value_high numeric`, `unit` check in `km_per_h`, `factor`, `windows`, `windows jsonb` (`[{start:"06:00", end:"08:00"}]`, Asia/Manila), `days text` (`every_day`), `applies_to text[]` (`walk` or `jeepney`), `is_assumption boolean`, `assumption_note text`, `basis text not null`, `source_codes text[]`, `content_hash`, `is_synthetic`.
  - Check: `is_assumption or cardinality(source_codes) > 0`, and when `is_assumption` then `assumption_note` is not null.
  - **Mixed bands** (one end sourced, the other an assumption) are stored with `is_assumption = true` and both the sources and the note, so the UI can say which end is which.
- **`entity_kind` check:** add `shape`, `walk_graph`, `eta_param`.
- **`publish_revision` additions:**
  - A shape's variant must be a member, and its stop measures must reference the member stop point versions of that variant.
  - At most one `walk_graph` member.
  - If any `eta_param` is a member, all five keys must be members.
- **RLS** as above.

### `0008_published_mode_views.sql` (views only, `security_invoker = true`, synthetic hidden, `grant select … to paranaga_app`)

- `create or replace view v_published_routes`: add `mode`, `service_status` and `planning`.
- `v_published_terminals` (replaced, version-aware): `coalesce` of the version row over the legacy row; adds `lat`/`lng` and the OSM coordinate provenance.
- `v_published_route_vehicle_classes`, `v_published_route_cooperatives`, `v_published_regional_services`.
- `v_published_shapes`: `variant_id`, `route_code`, `geojson` (`ST_AsGeoJSON(geog, 6)`), `length_m`, `stop_measures`, `trace_quality`, `label`, `road_source_code`.
- `v_published_walk_graph`: payload, sha256, bytes.
- `v_published_eta_params`.
- `create or replace view v_published_sources`: also unions the source codes of every new view.
- `pnpm db:check-rls` passes.

## Importer extensions (summary; details in Tasks 2, 5, 7)

1. **Reviewed seed → transit** (`src/domain/import/modes-seed.ts`, Zod).
   - Inputs: sources N01–N41 and U01; terminal updates and additions (T01–T16); tricycle feeder routes and their variants (street text and anchors); the e-jeepney 2017 route; fleet records; cooperatives (names only); regional services; fare-rule source additions and new fare rules F06–F12; ETA parameters.
   - Only records with `review.decision = "import"` are used. Excluded records are printed with their reason.
2. **OSM road snapshot** → road graph (directed for vehicles: `oneway`, `junction=roundabout`; undirected for walking). Two derived outputs:
   - **(a) Route paths:** a tracer per variant (Task 5), quality-gated (D6).
   - **(b) The walk graph payload** (Task 6), budget-gated (D7).
3. **Carry-forward revision.** Today's places path copies the published membership into a new draft. This generalizes it into `carryForwardRevision(published, { add, replace })`, so a new seed or road snapshot publishes **`modes-lines-{date}`** with the transit stop and route ids unchanged (saved trips stay valid). Re-running with the same files reports `unchanged`.
4. **Dry run** prints, among other things:
   - counts per kind and the excluded seed records;
   - per variant: matched/unmatched streets, off-list share, maximum snap, length, and pass/fail;
   - walk graph nodes, edges, bytes and gzip bytes;
   - regional relation lengths.

## API changes

| Endpoint | Change | Cache |
|---|---|---|
| `GET /api/v1/network/snapshot/:revisionId` | `variants[]` gains:<br>• `mode`<br>• `fleet` (`[{vehicleClass, evidenceLevel, status, lastReportedOn, label}]`, from `route_vehicle_class`)<br>• `measuresM: number[] \| null` (per route_stop seq)<br>• `pathLengthM: number \| null`<br>New top-level fields:<br>• `terminals[]` (code, name, kind, modes, lat/lng or null, coordSource, verification)<br>• `etaModel` (all five params with low/high, windows, basis, sources, assumption flags)<br>• `fareRules` gains F06–F12 (already generic) | unchanged (immutable) |
| `GET /api/v1/network/lines/:revisionId` **(new)** | `{ revision, attribution, lines: [{ variantId, routeCode, routeName, mode, fleet, colourKey, direction, kind, serviceStatus, planning, encoded (polyline, precision 5), lengthM, label, quality: {matchedStreets, unmatchedStreets[], offListShare} }], untraced: [{variantId, routeCode, reason}] }`. `colourKey` is `traditional_puj`, `modern_puj`, `mixed_trad_modern`, `e_jeepney`, `tricycle` or `unconfirmed`. Budget ≤ 150 KB. | `public, s-maxage=31536000, immutable`; 404 for an unknown revision |
| `GET /api/v1/network/walk-graph/:revisionId` **(new)** | Payload verbatim (Task 6 format) + `ETag` = sha256 | immutable |
| `POST /api/v1/plan` | Request unchanged. Ride legs gain:<br>• `mode`, `fleet`<br>• `distanceBasis: "approximate_path" \| "stop_to_stop_straight_line"`<br>• `boardMeasureM` / `alightMeasureM` (null without a path)<br>• `fare` computed on the D13 distance<br>No time fields: time estimates are computed on the device (they depend on the clock). | unchanged (`no-store`) |
| `GET /api/v1/routes`, `/routes/:code` | Add `mode`, `serviceStatus`, `planning`, `fleet[]` (with sources and dates), `cooperatives[]` (name, basis, sources, date), and `pathStatus` per variant (`traced` \| `untraced:{reason}`) | unchanged |
| `GET /api/v1/terminals/:code` | Add:<br>• `kind`; `lat`/`lng` + `coordinate: {source, osmType, osmId, osmVersion, licence}`<br>• `modes` with per-mode sources; `statusNote`<br>• `regionalServices[]`: name, mode, operators, destination, `distanceKm` or null, `fareEstimate` (pure `regionalFareEstimate`, below), sources<br>Code param regex unchanged (`^T\d{2}$`). | unchanged |
| `GET /api/v1/network/search-index/:revisionId` | Routes carry `mode` and the fleet label; tricycle feeders, the 2017 e-jeepney route and the new terminals are included through the existing builder | unchanged |

**`regionalFareEstimate(distanceKm, rules)`** (pure, `src/domain/fares/regional.ts`):
- **UV Express:** `[floor(F06 × km), ceil(F07 × km)]`, as "Estimate ₱X–₱Y (provisional per-km rate, 28 Sep 2026)".
- **Bus ordinary:** `F08 base + ceil(max(0, km − 5)) × ₱2.20`.
- **Aircon to luxury:** listed as per-km rates only: "₱2.45–₱3.35/km for air-conditioned classes (no base fare published)".
- Distance null: no total, only the rates and "distance not on file".
- Always ends with "operator prices may differ".

## UI changes (summary; details in Tasks 9–13)

- **Mode system:** `ModeIcon`, `ModeChip` (icon + label + stripe), `FleetChips` (one chip per class with its evidence text, for example "Modern units last reported May 2024"), all built on the palette.
- **Map:**
  - `RouteLinesLayer`: the overview, using the filter.
  - `TripLinesLayer`: walk dotted, rides solid or two-tone, direction chevrons, a mode chip at each ride's midpoint and a walk chip on walks over 150 m.
  - `TerminalsLayer`: rounded-square markers with mode glyphs; multi-mode terminals show up to 3 glyphs plus "+n".
  - `MapLegend`: a collapsible "Legend" button above the attribution, listing only what is drawn plus the fixed footnote "Lines are approximate paths, not verified route shapes."
  - `LayersSheet`: switches for Routes, Terminals and "Show historical routes"; mode filter chips All · Jeepney · Tricycle · UV Express · Bus · Train; list equivalents "Routes on the map ({n})" and "Terminals ({n})".
- **Trip options:** each card gains vehicle-class chips per ride (C7), a time estimate line, and a peak note when it applies. A "Tricycle may serve this" card appears below the options when D15 holds.
- **Trip detail:**
  - Per leg: the time estimate, the distance basis and the line label.
  - "How times are estimated" opens a sheet with the parameters and their sources.
  - The fare line for a mixed-fleet route reads "Estimate ₱14–₱17 · traditional to modern rate · matrix not verified".
- **Guidance:** remaining-time ranges on Walk, Ride and Transfer (`aria-live="polite"`, at most once every 30 s).
- **Saved cards:** the estimate is computed when the card opens. Offline it uses the cached snapshot's `etaModel`.
- **Route detail:**
  - The route's paths, with chevrons and the line label.
  - Trace status: "Traced along {k} of {n} listed streets", or "Path could not be traced from the street list" with the unmatched streets.
  - A Fleet section and a Cooperatives section.
  - For the 2017 e-jeepney route: "Documented 2017 route · status unknown, not confirmed running · not used for trip suggestions".
- **Terminal detail:** the map with the terminal marker when there is a coordinate (with the badge and attribution), modes with sources, regional destinations with fare estimates, and the status note.
- **Help:** new articles "Vehicle types in Naga" (`/app/help/modes`) and "How times are estimated" (`/app/help/times`). "How trips are planned" is updated. The About-data badges gain "Approximate path".

## PWA cache additions

- **`src/domain/pwa/sw-routes.ts`:**
  - Add patterns `LINES = ^/api/v1/network/lines/{uuid}$` (CacheFirst, cache kind `lines`, 3 revisions) and `WALK_GRAPH = ^/api/v1/network/walk-graph/{uuid}$` (CacheFirst, cache kind `walk-graph`, **2** revisions because of its size).
  - `CACHE_KINDS` gains both. `acceptHandoff` accepts both; `HANDOFF_MAX_BYTES` stays 2 MB, which is more than the walk graph budget.
  - `SHELL_PATHS` gains `/app/help/modes` and `/app/help/times`.
- **Lazy fetch (D18):**
  - The lines file is fetched with the snapshot on first visit, because the overview is on by default. It is skipped in low-data mode.
  - The walk graph is fetched the first time a trip is shown, then cached. While it is missing, walks are drawn as straight dotted lines with the fallback label.
- **"Clear data on this device"** removes both caches (`cachesToClear` already keeps only the precache and shells).
- **Offline planning** keeps working: the snapshot carries measures, fleet and `etaModel`; lines and the walk graph come from the cache when present.

---

### Task 1: Reviewed modes seed file (sources, terminals, fleets, feeders, fares, time-estimate parameters)

Files: `scripts/draft-modes-seed.ts` (one-off; reads the research JSON, writes a draft), `data/source/research/naga-modes-seed-2026-10-16.json` (reviewed), `data/source/research/README.md`, `src/domain/import/modes-seed.ts` (Zod schema + pure parser + cross-checks), `tests/unit/import-modes-seed.test.ts`, `tests/fixtures/modes/modes-seed-synthetic.json` (flagged `"synthetic": true`, obviously fake names).

- **File shape:**
  - `header`: `{ schemaVersion: 1, preparedOn, preparedFrom: ["naga-transport-candidates-2026-10.json@sha256…"], reviewer: "controller", jevModel }`.
  - Record arrays: `sources`, `terminals`, `routes` (new: `TRI-VISTODA`, `TRI-DECALANGON`, `EJ-2017`), `fleet`, `cooperatives`, `regionalServices`, `fareRules`, `fareRuleSourceAdditions`, `etaParams`, `streetAliases`, `conflicts`.
  - Every record carries `review` (D1).
- **Sources:** N01–N41 verbatim (title, url, publisher, date, type, retrieved; Jev scores stored in `properties` for provenance) plus U01 (D2).
- **Terminals** (D17), each with `modes`, `modeSources`, `kind`, coordinates only from OSM with type/id/version/timestamp, `verification` and `statusNote`:
  - **Existing T01–T06:**
    - T01 BCS: OSM way 293702439 centroid, note "centroid, not an entrance". Modes bus [S09, N02] and uv_express [N01, community].
    - T02 Eastbound: no coordinate. Status note "Street conflicts: Anciano St vs Waling-Waling St".
    - T03 LCC: way 23670386, note "franchise to about July 2025; renewal not found".
    - T04 Northbound: node 4545731100.
    - T05 Centro loading cluster: unchanged.
    - T06 PNR: way 23662289. Status note "Naga–Legazpi reported suspended; Naga–Lupi Viejo reported running (fan site, 15 Oct 2026) · confirm with PNR".
  - **New:**

    | Code | Name | Kind | Mode | OSM object |
    |---|---|---|---|---|
    | T07 | Eaglestar Naga Terminal | terminal | bus | node 5947830172 |
    | T08 | Milaor Jeepney Terminal | terminal | jeepney | node 4545730692 |
    | T09 | Jeepney station to Concepcion and Del Rosario | loading_point | jeepney | node 4850021524 |
    | T10 | Jeepney station to Pacol | loading_point | jeepney | node 4850042233 |
    | T11 | Jeepney station to Carolina and Panicuason | loading_point | jeepney | node 4850021531 |
    | T12 | Del Rosario → Centro jeepney station | loading_point | jeepney | node 5054596823 |
    | T13 | Gen. Luna St at Plaza Rizal (PUJ platform) | loading_point | jeepney | node 4850021530 |
    | T14 | Balatas Tricycle Terminal | terminal | tricycle | node 14053567159 |
    | T15 | Deca Vistansa special-trimobile waiting area | waiting_area | tricycle | no coordinate [N06] |
    | T16 | Cararayan Proper special-trimobile waiting area | waiting_area | tricycle | no coordinate [N06] |

  - **Excluded:** `CT-UV-SOUTHBOUND-OSM`, with reason "OSM name conflicts with the official southbound site (LCC, Sabang); field-verify". Its conflict is recorded.
- **Routes:**
  - `TRI-VISTODA`: mode tricycle, service status `authorized_feeder`, 33 units, sources N06. Two variants (`branch` direction):
    - "Langon – Ateneo de Naga via Vistansa Subd"
    - "Langon – Centro Cararayan (San Miguel St / Tecla San Andres-Ziga Rd corner) via Sitio Salunguigui"

    Each variant has street text and **anchors** for tracing: `{kind:"junction", streets:[a,b]}` or `{kind:"osm_place", osmType, osmId}` or `{kind:"osm_places_snapshot", key}`. Restriction text: "No entry to Tecla San Andres-Ziga Rd".
  - `TRI-DECALANGON`: service status `authorized_feeder`, 10 units, N05, with the conflict note "title says Cararayan proper; Section 1 says Deca Vistansa proper" and "probably superseded by Ordinance 2025-067".
  - `EJ-2017`: mode jeepney, service status `historical_unknown`, one circuit variant with the N09 street sequence, note "Jev p(running) = 0.07".
- **Fleet (C1–C5):**

  | Route | Class | Evidence level | Status | Dates | Sources | Notes |
  |---|---|---|---|---|---|---|
  | Every R1–R8-D | traditional_puj | legal_plan | planned | — | N30 | text "PUJ Class 2 in the 2025 route plan" |
  | R4 | modern_puj | official_report + news_report | reported | first 2023-04-17, last 2024-05-07 | N14, N38, N39 | "about 10 air-conditioned units"; cooperatives NACIATRASCO |
  | R7 | modern_puj | news_report | reported | first 2024-01-16, last 2024-06-24 | N38, N15, N41 | "about 5 units"; cooperatives NACIATRASCO, CAPATRANSCO; conflict "the two cooperatives' 5 units may be the same vehicles" |
  | R2, R3, R6 | modern_puj | secondary_claim | reported_not_confirmed | — | N20 | — |
  | R2, R3, R6 | modern_puj | user_report | reported_not_confirmed | — | U01 | — |
  | EJ-2017 | e_jeepney | legal_plan | planned | 2017-06-06 | N09 | — |
  | TRI-* | tricycle | legal_plan | planned | — | N05/N06 | — |

  **No e_jeepney record exists on any LPTRP route** (the parser rejects one: C5).
- **Cooperatives (C8):**
  - R4: NACIATRASCO, `corridor_reported` [N14, N38].
  - R7: NACIATRASCO [N38], CAPATRANSCO `corridor_reported` [N15, N41].
  - R4, name match: Centro Panganiban Del Rosario TC and DCPC-BAPAGTRANSCO, `name_matches_corridor` [N40].
  - R3: Naga Concepcion Diversion Del Rosario TC, `name_matches_corridor` [N40].
  - R6: Naga City – Pacol Allied TC, `name_matches_corridor` [N40].
  - MATCo: excluded, reason "corridor unclear (R2 or R8); registry address error".
  - The schema has no chair or address fields. The parser refuses unknown keys (`.strict()`). The chair conflict goes to `conflicts`.
- **Regional services RS01–RS07:**

  | Code | Service | Mode | Terminal | OSM relations |
  |---|---|---|---|---|
  | RS01 | Naga–Goa | jeepney | T03 | 11498944/5 |
  | RS02 | Florencia Naga–Goa | bus | T01 | 11495322/3 |
  | RS03 | Florencia/JC Liner Naga–Lagonoy | bus | T01 | 11495326/7 |
  | RS04 | Naga–Pasacao | jeepney | T03 | 14065995/6 |
  | RS05 | UV Express Naga–Tabaco via Sabluyon | uv_express | T01 | 11498948/9 |
  | RS06 | PITX–Naga (Philtranco; Bicol Isarog) | bus | T01 | 9732639, 10594406, 10939369 |
  | RS07 | Santa Rosa ITT–Naga (Raymond) | bus | T01 | 11488879 |

  - The terminal assignment is a candidate, noted "terminal from OSM tags/name; confirm".
  - The two Sabang routes are **excluded**, with reason "which Sabang is unconfirmed".
- **Fares:**
  - `fareRuleSourceAdditions`: F01/F02 += N17, N32; F03 += N33. The parser asserts that F01/F02 base, base km and increment equal ₱14/4/₱2.00 and ₱17/4/₱2.40, and fails if not (the check J7 asks for).
  - New rules: F06 UV traditional ₱2.60/km and F07 UV modern ₱3.00/km (`evidence_status: "provisional_national_rate"`, no base); F08 bus ordinary ₱12 for the first 5 km + ₱2.20/km; F09–F12 bus aircon, deluxe, super deluxe and luxury per km. All effective 2026-09-28, source N17, `publish_exact: false`.
  - Excluded: the pre-hike regional prices (p current 0.09) and the Eastbound dispatch fee (an operator fee).
- **Time-estimate parameters (D8–D9):**

  | Key | Low | High | Unit | Sources | Assumption |
  |---|---|---|---|---|---|
  | `walk_speed_kmh` | 4.238 | 4.238 | km_per_h | N28 | no |
  | `walk_slowdown_factor` | 1 | 1.25 | factor | — | A1 |
  | `jeepney_speed_offpeak_kmh` | 10 | 15 | km_per_h | N16, N29 | no |
  | `jeepney_speed_peak_kmh` | 7 | 13 | km_per_h | N29 (high end) | A2 (low end) |
  | `peak_windows` | — | — | windows | N04 | A3 ("applied every day; no day-of-week source") |

  Windows are 06:00–08:00, 11:00–13:00 and 16:00–19:00. The tricycle speed is excluded, with reason "unverified excerpt (PIDS page 404)".
- **`streetAliases`:** reviewed mappings from legal-text names to OSM names, for example "Diversion Rd" → "Roxas Avenue". They start empty and are filled in Task 5 from the dry-run's unmatched list. Each one needs a reason.
- **README:** provenance, the review rule, licences (OSM-derived fields are ODbL), and the fact that no chair names or addresses are kept.

Tests (TDD):
- the schema accepts the real file and rejects unknown keys;
- an e_jeepney fleet record on an R-route is rejected;
- `reported_not_confirmed` ⇔ secondary or user evidence;
- every `source_codes` entry exists in `sources`;
- excluded records are never returned by `importableRecords()`;
- terminal coordinates are inside the Naga boundary, and an OSM id is present when there is a coordinate;
- the F01/F02 equality check passes, and a tampered copy fails;
- the A1–A3 parameters carry an `assumption_note`;
- the real file has 16 terminals, 3 new routes, R4/R7 `reported` and R2/R3/R6 `reported_not_confirmed`.

### Task 2: Migration 0006 and seed import (fleets, cooperatives, versioned terminals, regional services, fares, sources)

Files: `db/migrations/0006_modes_fleet_terminals.sql`, `scripts/lib/import-plan.ts` (read the newest `data/source/research/naga-modes-seed-*.json`), `scripts/lib/import-writer.ts` (`carryForwardRevision`, writers for the new kinds), `scripts/import-naga.ts` (print), `src/server/db/schema.ts` (Drizzle mirrors), `tests/integration/import-modes-seed.test.ts`, `tests/integration/transit-schema.test.ts` (new constraints), `tests/unit/import-plan.test.ts`.

- Migration 0006 as specified above, including `create or replace function transit.publish_revision` with every 0003 check kept (diff-review it against 0003).
- **Writer:**
  - Sources go to `ingest.source` (insert, or skip when identical).
  - Terminal versions are written only when `content_hash` changed.
  - Routes, variants and variant versions are written for the new routes.
  - `route_vehicle_class`, `route_cooperative`, `regional_service(_version)`, fare-rule versions (sources added means a new content hash, so a new version) and new fare rules.
  - `carryForwardRevision` publishes `modes-lines-{date}` (or `modes-{date}` when Task 7's road outputs are absent) with stop/route ids unchanged.
- **Dry run** prints counts, exclusions with reasons, and conflicts.

Tests:
- **Integration (throwaway branch):**
  - The migration applies on 0005; `check-rls` passes.
  - `paranaga_app` reads and cannot write.
  - A route_vehicle_class whose route is not a member is refused by publish.
  - A terminal version with a coordinate but no OSM id is refused by the check.
  - Old revisions still read their terminals through the legacy row; rollback to the previous revision restores T01 with `geog null`.
  - Importing the synthetic seed → publish refused.
  - Importing the real seed → revision `modes-…` whose stop and variant memberships for R1–R8 equal the previous revision's; a second run → `unchanged`.
- **Unit:** the plan builder merges the seed with `Data_Sets` and reports exclusions.

### Task 3: Read model and API for modes (views 0008 part 1, snapshot, routes, terminals, search index)

Files: `db/migrations/0008_published_mode_views.sql` (the views for 0006 objects; the shape, walk-graph and ETA views are appended in Task 7 as `0009` if 0008 has already merged; otherwise they are added to 0008 before merge), `src/server/repos/network-repo.ts`, `src/server/repos/reference-repo.ts`, `src/domain/api/schemas.ts` (fleet, terminal, regional, eta model schemas), `src/domain/fares/regional.ts`, `src/domain/modes/fleet.ts` (pure `fleetLabel(records, today)`, `colourKey(records)`), `src/domain/search/index-build.ts`, route handlers, `tests/unit/fleet-label.test.ts`, `tests/unit/regional-fare.test.ts`, `tests/unit/api-schemas.test.ts`, `tests/integration/public-api.test.ts`, `tests/integration/reference-api.test.ts`, e2e fixtures (`snapshot.json`, `routes.json`, `route-r4.json`, `route-r7.json`, `terminal-t01.json`, `terminal-t14.json`, `search-index.json`) regenerated with `tests/integration/fixture-capture.ts`.

- **`fleetLabel`, exact copy:**
  - R4: "Traditional and modern jeepneys · modern units last reported May 2024"
  - R7: "Traditional and modern jeepneys · modern units last reported June 2024"
  - R2, R3, R6: "Traditional jeepneys · modern units reported, not confirmed"
  - other R routes: "Traditional jeepneys (2025 route plan) · vehicles on the street not confirmed"
  - EJ-2017: "E-jeepney (2017 ordinance) · status unknown, not confirmed running"
  - tricycle feeders: "Tricycle (special trimobile) · authorized 2025 · operation not verified"
  - no record: "Vehicle type not confirmed"
- **Option chip text (C7):**
  - R4/R7: "Jeepney · traditional + modern"
  - R2/R3/R6: "Jeepney · modern units reported"
  - otherwise: "Jeepney · type not confirmed" (with traditional colour when there is an LPTRP record)
- **`colourKey`** follows D3. Only `official_report`/`news_report` records with status `reported` count toward `mixed_trad_modern`.
- **Snapshot, routes, terminals and search index** gain the fields listed under "API changes". The handlers keep Zod params, the error envelope and the cache headers.

Tests:
- **Unit:** `fleetLabel` for every row above; date formatting is month + year from `last_reported_on`; `colourKey` never returns `e_jeepney` for an R-route; regional fare (RS05 at 103 km → UV range rounded outward; null distance → rates only; bus ordinary at 3 km → ₱12); schema round trips.
- **Integration:**
  - The snapshot has 16 terminals (T15/T16 with null coordinates), fleets on R4/R7, and no e-jeepney on R-routes.
  - `/terminals/T01` lists RS02, RS03, RS05, RS06 and RS07 with sources and the BCS coordinate provenance.
  - `/routes/R4` lists cooperatives, with no field named `chair` or `address` anywhere in the JSON (deep key scan).
  - The search index contains `TRI-VISTODA` and T14.

### Task 4: OpenStreetMap road snapshot (fetch, strip, parse, road graph)

Files: `scripts/fetch-osm-roads.ts` (owner-run, never in CI or at build), `data/source/osm/naga-roads-YYYY-MM-DD.osm.json` (committed after review; `.gitattributes` `*.osm.json -text` already applies), `data/source/osm/README.md` (new section), `src/domain/import/osm-roads.ts` (Zod + parser), `src/domain/geo/street-names.ts` (normalizer), `src/domain/geo/road-graph.ts`, `tests/fixtures/osm/roads-synthetic.osm.json` (a small fake grid: named streets, one one-way, one roundabout, one footway, one `access=private`, flagged synthetic), `tests/unit/osm-roads.test.ts`, `tests/unit/street-names.test.ts`, `tests/unit/road-graph.test.ts`.

- **Query:** the area of relation 3084673 buffered by about 300 m (an `around` filter on the boundary ways), using `way[highway]` plus `node[place~"^(village|hamlet|neighbourhood|locality|quarter)$"][name]` (feeder anchors), with `out body; >; out skel qt;`.
  - Kept: ways with `type`, `id`, `version`, `timestamp`, `nodes` and the tags `highway`, `name`, `alt_name`, `old_name`, `official_name`, `ref`, `oneway`, `junction`, `access`, `foot`, `area`; nodes with id, lat and lon; place nodes with name and place.
  - Dropped: `user`, `uid`, `changeset` and every other tag. The header carries `removedFields`, `responseSha256` and `osmBaseTimestamp`.
- **Second query (D5):** the RS01–RS07 relations with `out geom`. The script computes `lengthKm` (sum of member way lengths, each way counted once, roles `""`, `forward` and `backward`) and stores **only** `{ relationId, version, timestamp, name, ref, from, to, lengthKm }` in `header.regionalRelations`. The geometry is discarded.
- **`street-names.ts`:**
  - Normalize: NFC; strip diacritics for matching only (Peñafrancia ≡ Penafrancia); case-fold; expand abbreviations (`Ave`/`Ave.` → avenue, `St` → street, `Dr` → drive, `Rd` → road, `Hwy` → highway, `Gen.` → general); remove punctuation; collapse spaces.
  - `matchStreet(legalName, way, aliases)` checks name, alt_name, old_name, official_name and reviewed aliases.
- **`road-graph.ts`:**
  - `buildRoadGraph(snapshot, { profile: "vehicle" | "walk" })`.
  - Vehicle profile: drivable highway classes (`motorway`…`residential`, `unclassified`, `service`, `living_street`, `*_link`); one-way respected (`oneway=yes|1|-1`, `junction=roundabout`).
  - Walk profile: D7 classes, undirected.
  - Edges carry way id, normalized street names and length (haversine).
  - Plus a spatial grid index (about 100 m cells) and `nearestEdge(point, maxM)` → `{edge, t, distM}` (projection onto a segment).
- **Owner step after review:** the controller runs the fetch once, records file, base, counts and sha256 in the README table, and commits.

Tests (TDD):
- the parser refuses `user`/`uid`/`changeset`;
- unknown tags are absent from the output;
- a one-way edge exists in only one direction in the vehicle profile and in both in the walk profile;
- `access=private` is excluded from walking unless `foot=yes`;
- normalization treats "Peñafrancia Ave." and "Penafrancia Avenue" as equal;
- the nearest-edge projection is correct on the fixture;
- the relation length of a fixture relation is correct to within 1 m.

### Task 5: Approximate route path tracer (pure) and preview

Files: `src/domain/import/trace-route.ts`, `src/domain/geo/polyline.ts` (encode/decode, precision 5), `src/domain/geo/measure.ts` (line length, point-to-line projection measure), `scripts/preview-route-paths.ts` (writes `tmp/route-paths-preview.geojson`, git-ignored, for review in a local GIS tool; never uploaded), `tests/unit/trace-route.test.ts`, `tests/unit/polyline.test.ts`.

- **`traceVariant({ streets, anchors?, pins?, isCircular }, graph, aliases)` → `{ ok: true, line, lengthM, stopMeasures, quality } | { ok: false, reason, quality }`.**
- **Street-list mode (R1–R7, Loops C/D, EJ-2017, trial circuits):**
  1. Resolve each listed street to its matching edges. A list item that names a landmark, not a street (for example "Bicol Central Station", "SM", "LCC Terminal"), resolves to the OSM places snapshot key given in the seed's anchors, or is skipped and reported as `landmark_unresolved`.
  2. **Waypoints:** the junction nodes where street *i* meets street *i+1*, chosen as the junction closest along the previous waypoint's street.
  3. **Between waypoints:** a directed shortest path where edges on street *i* cost ×1, edges on any listed street ×3, and others ×10.
  4. **Circuits** close back to the first waypoint.
- **Pin mode (R8-A, R8-B, plus their street lists):**
  - Waypoints are the provisional pins in order, each snapped to the nearest drivable edge (≤ 60 m, else fail).
  - Between pins: a directed shortest path with costs ×1 on listed streets, ×4 elsewhere.
  - Stop measures are the cumulative length at each snapped pin; for circuits they increase within one circuit, and `pathLengthM` is used to wrap (as the spec's `route_stop` note says).
- **Anchors (tricycle feeders):** a junction of two named streets, or a place node. A missing anchor → `{ ok:false, reason:"anchor_unresolved" }`.
- **Quality and gate (D6):** `matchedStreets`, `unmatchedStreets[]`, `offListShare`, `maxSnapM`, `continuous` and `builderVersion`.
- **Determinism:** ties are broken by node id, and the output is identical across runs (property test).
- **Preview:** after the real snapshot exists, the controller runs `pnpm data:preview-paths`, inspects every traced line against the legal text, and adds `streetAliases` (with reasons) to the seed until the R-routes pass, or records why one cannot. The result table (variant → pass/fail, off-list share) goes into the Task 5 report.

Tests (TDD) on the synthetic grid:
- the street list A→B→C yields a path using only A, B and C edges;
- a one-way street forces the legal direction;
- an unmatched street → `ok:false` with the street listed;
- off-list share 20% → fails the gate;
- pins in order produce monotonic measures; a circuit's measures increase and wrap;
- a pin 80 m from any road → fail;
- encode/decode round trip within 1e-5;
- same input → byte-identical output (`fast-check`).

### Task 6: Walk graph builder and on-device walk routing (pure)

Files: `src/domain/walk/walk-graph-build.ts` (import side), `src/domain/walk/walk-graph.ts` (decode, grid index, snap, A*), `src/domain/walk/format.ts` (Zod schema of the payload), `tests/unit/walk-graph-build.test.ts`, `tests/unit/walk-graph-route.test.ts`, `tests/unit/walk-graph-budget.test.ts` (runs only when the real road snapshot exists; it is skipped with a message otherwise, and is required in Task 15).

- **Payload format v1 (compact JSON):** `{ v:1, roadSource, bbox, nodes: [latE5, lngE5, …] (delta-encoded ints), edges: [a, b, lengthDm, polylineDeltaIdx?], geom: [delta ints for contracted intermediate points] }`. Degree-2 nodes are contracted (their coordinates are kept in `geom` for drawing). Edge length is in decimetres.
- **`buildWalkGraph(roadGraph)`:** D7 filters; the largest connected component plus every component over 50 nodes (smaller islands are dropped and counted); deterministic order.
- **`routeWalk(graph, from, to)`:**
  - Snap both ends to the nearest edge (≤ 100 m).
  - A* with a haversine heuristic over the edge endpoints, including the partial edges at the snapped points.
  - Returns `{ kind: "path", coords, lengthM, snapFromM, snapToM }`, or `{ kind: "straight", reason: "no_edge_near_start" | "no_edge_near_end" | "no_path" }`.
  - The reported length includes the two snap legs.
  - Performance target: < 30 ms per query on the real graph (benchmark test, logged, not asserted in CI).

Tests (TDD):
- a path on a fixture equals a hand-computed shortest path;
- a disconnected island → `no_path`;
- an end 150 m from any edge → straight;
- A* equals Dijkstra on random fixture pairs (`fast-check`);
- the decode → encode round trip is stable;
- **budget test (real data):** payload ≤ 600 KB and gzip ≤ 220 KB (`zlib.gzipSync`).

### Task 7: Migration 0007, geometry and time-estimate parameter import, lines and walk-graph endpoints

Files: `db/migrations/0007_shapes_walk_graph_eta.sql`, `0008` additions (or `0009_published_geometry_views.sql`, see Task 3), `scripts/lib/import-plan.ts` (read the newest `naga-roads-*.osm.json`; trace every variant; build the walk graph; attach regional lengths), `scripts/lib/import-writer.ts`, `scripts/import-naga.ts` (dry-run table), `src/server/repos/network-repo.ts` (`getLines`, `getWalkGraph`, snapshot `measuresM`/`pathLengthM`/`etaModel`), `src/app/api/v1/network/lines/[revisionId]/route.ts`, `src/app/api/v1/network/walk-graph/[revisionId]/route.ts`, `src/domain/api/schemas.ts` (`linesSchema`), `tests/integration/import-geometry.test.ts`, `tests/unit/api-lines-handlers.test.ts`, e2e fixtures `lines.json`, `walk-graph.json` (a small real-shaped extract around Centro, flagged synthetic in a fixture header), regenerated `snapshot.json`.

- **Import:**
  - One `shape_version` per variant that passes D6, with `road_source_code = OSMR-…`.
  - `eta_param_version` rows from the seed.
  - One `walk_graph_version`.
  - `regional_service_version.distance_km` from `header.regionalRelations` (matched by relation id; the shorter direction is used when two directions differ, recorded in `distance_basis`).
  - Published through `carryForwardRevision`, label `modes-lines-{roads date}`.
  - **Abort** when the walk graph is over budget or an ETA key is missing. **Report and continue** for untraced variants.
- **Endpoints:** as in "API changes". `lines` is built from `v_published_shapes` + the routes view + the fleet `colourKey`; it includes `untraced[]` and `attribution: "Map data © OpenStreetMap contributors (ODbL)"`. `walk-graph` streams the payload text with `Content-Type: application/json` and `ETag`.

Tests:
- **Integration:**
  - The migration applies; `check-rls` passes.
  - Publish refuses a shape whose variant is not a member, two walk graphs, and an incomplete ETA parameter set.
  - Importing the synthetic roads and seed → refused (synthetic).
  - The real import → shapes for every passing variant; measures reference member stop versions; a re-run → `unchanged`.
  - `GET lines` returns encoded lines that decode inside the service area; an unknown revision → 404; the walk graph's sha256 matches its `ETag`.
- **Unit:** handler validation and cache headers.

### Task 8: Planner, path distances and vehicle classes on ride legs

Files: `src/domain/planner/graph.ts` (forward ride metres from `measuresM` when present, wrap by `pathLengthM` on circuits), `src/domain/planner/plan.ts` (leg fields), `src/domain/planner/fares.ts` (distance input documented; C6 span unchanged; the `ruleCodes` comment notes the mixed-fleet reason), `src/domain/api/plan.ts` (response schema), `src/domain/trip/present.ts` (`distanceBasisText`, fare text for a mixed fleet), `tests/unit/planner-graph.test.ts`, `tests/unit/planner-plan.test.ts`, `tests/unit/planner-real-loops.test.ts`, `tests/unit/planner-fares.test.ts`, `tests/e2e/fixtures/plan-responses.ts`.

- A ride leg's `distanceMeters` = `measure(alight) − measure(board)` (mod `pathLengthM` on circuits) when the variant has measures; otherwise today's straight-line sum. Add `distanceBasis`, `boardMeasureM`, `alightMeasureM`, `mode` and `fleet`.
- The score and Pareto logic are unchanged (they now see path metres).
- Copy: "≈ 3.4 km along the approximate path" or "≈ 3.1 km stop to stop (straight line)". Fare line for a mixed fleet: "Estimate ₱14–₱17 · traditional to modern rate · matrix not verified". For a fleet that is not confirmed, the existing wording.

Tests (TDD):
- with measures, a circuit ride that passes the start wraps correctly; without measures the output is identical to before (regression snapshot of `planner-real-loops` with measures stripped);
- path distance ≥ straight-line sum on the real loops (property);
- the fare uses the D13 distance;
- `fleet` is copied from the snapshot variant;
- the option id is unchanged by the new fields (saved trips stay valid).

### Task 9: Time-estimate domain (pure, TDD)

Files: `src/domain/eta/manila-time.ts`, `src/domain/eta/eta.ts`, `src/domain/eta/format.ts`, `src/domain/eta/basis.ts` (sheet copy from `etaModel`), `tests/unit/eta.test.ts`, `tests/unit/eta-format.test.ts`, `tests/unit/manila-time.test.ts`.

- `manilaMinutesOfDay(date)` = (UTC minutes + 480) mod 1440. `inPeakWindow(dep, durHighMin, windows)` checks interval overlap, including windows crossed after midnight.
- **`estimateOption(option, walkLengths, model, departure)`** → `{ legs: [{ kind, lowMin, highMin, basis: "graph_path" | "straight_x1_3" | "approximate_path" | "stop_to_stop", band: "offpeak" | "peak" | null, estimated: boolean }], total: { lowMin, highMin, waitUnknown: rides > 0, peak: boolean, partial: boolean } }`.
  - Walk: D8.
  - Ride (jeepney): `d / high-speed` to `d / low-speed`, in the peak band when the trip overlaps a window (D9). The band is decided in two passes: first with the off-peak band, then, if [dep, dep + high total] overlaps a window, every ride leg uses the peak band.
  - A tricycle or other leg without a speed: `estimated: false`, and `partial: true` on the total.
- **Rounding:** minutes floor(low) to ceil(high), minimum 1; at 60 min and above, "1 h 5 min".
- **`format.ts`, exact copy:**
  - total: "Estimate {a}–{b} min" + (rides ? " + waiting (unknown)" : ""); "Estimate {a}–{b} min walk" for walk-only; when partial, append " · tricycle time not estimated";
  - peak note: "Peak hours · slower estimate ({windows})";
  - per leg: "≈ {a}–{b} min walk", "≈ {a}–{b} min ride";
  - guidance remaining: "About {a}–{b} min left (estimate)" / "About {a}–{b} min of riding left (estimate)".
  - **Never** "arriv", "ETA" or a clock time.
- **`basis.ts`** builds the "How times are estimated" rows from the model: "Walking: 4.24 km/h (Tolentino & Sigua 2022, N28); up to 25% slower for crossings (ParaNaga assumption)", "Jeepney off-peak: 10–15 km/h (SafeTravelPH 2025, N16; Puerto Princesa study 2025, N29)", "Jeepney peak: 7–13 km/h (upper from N29; lower is a ParaNaga assumption)", "Peak windows: 06:00–08:00, 11:00–13:00, 16:00–19:00 (Ordinance 2025-110, N04), applied every day (no day-of-week data)", "Waiting: unknown — no published schedules or headways for Naga", "Not live traffic. ParaNaga uses no traffic service."
- **Honesty property update** (`tests/unit/guidance-view.test.ts` `FORBIDDEN`): replace `/\d\s*(min|…)/` with a rule that a minutes token may appear only inside a string that also matches `/estimate/i` or starts with "≈"/"About". `\bETA\b`, "arriving" and "arrives in" stay forbidden.

Tests (TDD, `fast-check`):
- low ≤ high for every leg and the total;
- the peak band is never faster than off-peak;
- 07:00 Manila departure → peak; 09:30 with a 20 min high → off-peak; 10:50 with a 15 min high → peak (overlaps 11:00);
- UTC dates around midnight map correctly;
- a walk-only option has no waiting text;
- a tricycle leg → partial;
- formatted strings never contain "arriv" or "ETA" (property over random inputs).

### Task 10: On-device walk paths, "must save walking" re-check, tricycle hint

Files: `src/client/network/use-walk-graph.ts` (lazy fetch; Zod; in-memory + SW cache; respects low-data and `saveData`), `src/client/network/use-lines.ts`, `src/domain/trip/enrich.ts` (pure: `enrichPlan(plan, walkGraph | null, snapshot)` → walk paths per leg + D14 re-check), `src/domain/trip/tricycle-hint.ts` (pure, D15), `src/client/trip/use-trip-plan.ts` (applies the enrichment online and offline), `tests/unit/trip-enrich.test.ts`, `tests/unit/tricycle-hint.test.ts`, `tests/unit/use-walk-graph.test.tsx`.

- **`enrichPlan`:**
  - Per walk leg, `routeWalk`. The direct walk is routed too.
  - Walk legs get `path: {kind, coords?, lengthM}`.
  - The D14 re-check drops failing options, keeps the labels of the remaining ones (relabelling with today's `pickLabelled` order when the "Recommended" option was dropped), and sets `reason: "walk_shorter"` when none remain.
  - Pure, so the offline planner path uses it too.
- **The tricycle hint** uses the snapshot terminals (`mode` includes tricycle, coordinate present) and the lines file's tricycle feeder paths (point-to-polyline distance). It returns `{ terminal?: {code, name, distanceM}, feeder?: {routeCode, name, distanceM} } | null` and the exact copy from D15.
- **Walk graph loading:** it loads only after a plan exists. While it loads, walks are drawn straight with "Straight line · loading street paths…" (polite status). On failure, straight with the fallback label.

Tests:
- enrichment keeps an option whose graph walk is shorter than the direct graph walk and drops one that is longer; it falls back to ×1.3 comparisons when any leg is straight;
- relabelling is deterministic;
- the hint is triggered by T14 within 600 m and not at 700 m; a feeder within 300 m triggers it; a waiting area without a coordinate never triggers;
- the hook does not fetch the walk graph in low-data mode or before a plan exists;
- the request URL carries the revision id only (no coordinates).

### Task 11: Mode visual system (palette, icons, chips, legend), accessible

Files: `src/domain/modes/modes.ts` (classes, modes, display names, chip abbreviations), `src/domain/modes/palette.ts`, `src/ui/modes/mode-icon.tsx` (one inline SVG per class + walk + rail; `aria-hidden`, with a text label beside it), `src/ui/modes/mode-chip.tsx`, `src/ui/modes/fleet-chips.tsx`, `src/ui/map/map-legend.tsx`, `src/ui/modes/modes.css`, `tests/unit/palette-contrast.test.ts`, `tests/unit/mode-chip.test.tsx`, `tests/unit/map-legend.test.tsx`.

- Palette L/D exactly as the table above. `data-map-surface` is chosen by `mapSurface(theme, tilesDrawn)`.
- **`palette-contrast.test.ts`** computes WCAG ratios for every core vs its casing and its surface (L: white, `#F2EFE9`, `#FCD6A4`; D: `#0B1220`, `#1E2633`), and for legend swatches vs the sheet backgrounds (white, `#111A2E`). It asserts every ratio ≥ 3.0. High-contrast widths are asserted from the tokens.
- **`ModeChip`:** icon + text (e.g. "Jeepney · traditional + modern") + stripe. The accessible name is the text. It is never colour-only: a test renders it with CSS colours removed and checks the text.
- **`MapLegend`:** a button "Legend" (`aria-expanded`); the list shows a line sample (an SVG with the real pattern and casing), the icon and the label per item drawn. The fixed footnote reads "Lines are approximate paths, not verified route shapes." For walks: "Dotted: approximate walking path · crossings not checked". For a mixed fleet: "Alternating colours: traditional and modern jeepneys reported". It is keyboard operable, Escape closes it, and it is placed above the attribution and clear of the zoom controls.

Tests: the contrast test (above); chip text for every class; the legend lists only the classes passed; axe light/dark/high-contrast on a story page (`tests/e2e/modes-kit.spec.ts` using the existing component test route pattern, or the trip screen when that is simpler).

### Task 12: Map lines: trip guide, route overview, route detail paths

Files: `src/ui/map/trip-lines-layer.tsx`, `src/ui/map/route-lines-layer.tsx`, `src/ui/map/direction-chevrons.ts`, `src/ui/map/naga-map-leaflet.tsx` (new props `tripLines`, `routeLines`, `legend`, `mapSurface`; attribution text "Map data" when tiles are off), `src/ui/map/types.ts`, `src/ui/map/layers-sheet.tsx`, `src/client/prefs/use-prefs.ts` (+ `layers: { routes: boolean, terminals: boolean, historical: boolean, modes: Mode[] }`, Zod, defaults per D16), `src/ui/home/home-screen.tsx`, `src/ui/routes/route-detail.tsx`, `src/ui/trip/trip-detail.tsx` (line labels per leg), `tests/unit/trip-lines.test.ts` (pure slicing), `tests/e2e/map-lines.spec.ts`, `tests/e2e/routes.spec.ts` (or extend `map.spec.ts`/`trip.spec.ts`).

- **Trip lines** (start and destination set, an option selected):
  - Walk legs dotted (graph path or straight fallback).
  - Ride legs: the shape slice `[boardMeasureM, alightMeasureM]` (wrapping on circuits), solid in the `colourKey` colour (two-tone for mixed); no line when the variant is untraced, with the trip detail note "Path could not be traced from the street list; stops shown only".
  - Chevrons. Chips at mid-leg ("Jeep + Modern", "Walk").
  - The existing board/alight markers stay above the lines.
  - The map fits all lines; `FitHighlights` includes the line bounds.
  - The legend shows automatically, collapsed, with a polite announcement "Trip drawn: walk, Loop A, walk. Lines are approximate."
- **Route overview** (no trip): every traced line passing the mode filter, thin with casing. Tapping a line selects it: a bottom card "{chip} {name}" + fleet label + "Approximate path, not a verified route shape" + "Route details" → `/app/routes/{code}`. Lines are not focusable; the list equivalent is in the Layers sheet.
- **Layers sheet** (button in the map controls, 48 px, label "Layers"):
  - switches Routes / Terminals / Show historical routes; mode chips (multi-select, "All" resets);
  - lists "Routes on the map ({n})" → route detail and "Terminals ({n})" → terminal detail;
  - note: "Regional UV Express and bus routes leave the city; see their terminals."
- **Route detail:**
  - A map with the route's variants (an inbound/outbound segmented control), chevrons, the label and the trace status.
  - Fleet section: one row per class with the label, the evidence ("CDA, 17 Apr 2023 · Brigada News, May 2024"), the dates and source chips. "Reported, not confirmed" rows add "Private guide, Oct 2025 · user report, unverified".
  - Cooperatives section: "{name}" / "Reported on this corridor · {source}, {date}" or "Registered cooperative whose name matches this corridor (OTC masterlist, July 2023) · route not confirmed"; the footnote "Cooperative leaders' names are not shown; sources disagree."
  - For EJ-2017: the J5 copy and a `Historical` badge.

Tests:
- **Unit:** slicing a circuit across the start; two-tone layering order.
- **e2e** (fixtures; tiles aborted):
  - set start and destination (fixture plan) → SVG paths exist with the classes `pn-line--walk` (with `stroke-dasharray`) and `pn-line--ride` (solid); the legend lists Walk and the ride class; the text "Approximate path, not a verified route shape" is visible in trip detail;
  - offline after the first visit, lines still draw from the cache;
  - the overview on the home map with no trip shows lines; filtering to Tricycle shows only `TRI-*`; the historical switch shows EJ-2017;
  - tapping a line opens the card and "Route details";
  - R4 detail shows the fleet label exactly as C2 and no chair names;
  - axe light/dark/high-contrast on the home map with lines, the Layers sheet and route detail.

### Task 13: Terminals layer, terminal detail and the tricycle hint card

Files: `src/ui/map/terminals-layer.tsx` (one Leaflet layer of DOM markers ≤ 16, or canvas if more), `src/ui/terminals/terminal-detail.tsx`, `src/ui/trip/tricycle-hint.tsx`, `src/ui/trip/trip-options.tsx` (renders the hint below the options), `src/ui/explore/explore-screen.tsx` (Terminals directory: mode filter, kind sub-label), `tests/unit/terminals-layer.test.tsx`, `tests/e2e/terminals.spec.ts`, `tests/e2e/places.spec.ts` (T01/T06 expectations updated).

- **Markers:**
  - A rounded square in the mode colour; the glyph(s) in white (L) or `#0B1220` (D); terminals of several modes show stacked glyphs.
  - Only terminals with a coordinate; the accessible name is "{name}, {modes} terminal, community-mapped location".
  - Tapping one opens terminal detail. The mode filter is shared with the overview (D16).
- **Terminal detail changes:**
  - With a coordinate: the map centred on it with the marker; badge "Community-mapped location (OpenStreetMap)"; the row "Location · OSM {type}/{id} v{version} · {note e.g. 'centroid, not an entrance'}"; `OsmAttribution`; "Directions to here" sets the destination to the coordinate, labelled "{name} (map point, entrance not mapped)".
  - Without one: today's "Location not mapped".
  - "Modes" row with chips and per-mode source chips.
  - "Regional destinations" with `regionalServices` rows: "{mode chip} {destination} · {operators}" / "≈ {km} km by the community-mapped route · {fare estimate}" or "Distance not on file · {rates}".
  - Status note (e.g. the PNR line, the franchise note).
  - T02: "Street conflicts: Anciano St (Res. 2025-735) vs Waling-Waling St (Wikivoyage 2023)".
- **Tricycle hint card** (D15 copy), with a "Show on map" button that recentres on the terminal; for a waiting area without a coordinate, nothing is shown.
- **Explore → Terminals directory:** 16 rows, mode chips, kind sub-label ("Loading point", "Waiting area"), and "Location not mapped" where null.

Tests:
- e2e: the terminals layer shows 14 markers (T02, T05, T15 and T16 have no coordinates; the count is checked against the fixture); the Tricycle filter shows only T14; T01 detail shows the coordinate badge, attribution, RS05 with a UV fare estimate and "operator prices may differ";
- a plan near T14 (fixture) shows "A tricycle may serve this" with ₱15, "discounts not applied" and "confirm with the driver", and no minutes for the tricycle;
- axe light/dark.

### Task 14: Time estimates in trip options, trip detail, guidance, saved trips and Help

Files: `src/ui/trip/eta-text.tsx`, `src/ui/trip/eta-basis-sheet.tsx`, `src/ui/trip/trip-options.tsx`, `src/ui/trip/trip-detail.tsx`, `src/domain/guidance/view.ts` (remaining-time fields), `src/ui/guidance/walk-step.tsx`, `ride-step.tsx`, `transfer-step.tsx`, `src/ui/saved/saved-screen.tsx`, `src/app/offline/page.tsx` (saved cards), `src/ui/help/articles.ts`, `src/app/app/help/[article]/page.tsx`, `src/ui/help/help-screen.tsx`, `tests/unit/guidance-view.test.ts`, `tests/unit/saved-screen.test.tsx`, `tests/unit/help-screens.test.tsx`, `tests/e2e/trip.spec.ts`, `tests/e2e/guidance.spec.ts`, `tests/e2e/saved.spec.ts`, `tests/e2e/help.spec.ts`.

- The time estimate is computed in the client from `enrichPlan` output + `etaModel` + `new Date()`. It is recomputed when the minute changes while visible (at most once per 60 s), and announced politely only in guidance.
- **Trip options card:** "Estimate 18–27 min + waiting (unknown)" + the peak note when applicable; chips per ride (C7).
- **Trip detail:** the total line + "How times are estimated" (opens `EtaBasisSheet`); per-leg "≈ 5–7 min walk · along streets (approximate)" or "· straight line" / "≈ 9–14 min ride · along the approximate path".
- **Guidance:**
  - Walk shows "About {a}–{b} min to {stop} (estimate)" (from GPS remaining distance when watching, else the plan).
  - Ride shows "About {a}–{b} min of riding left (estimate)" (measures-based when the ride progress index is known: the distance from the last passed stop's measure to the alight measure).
  - Transfer shows the walk estimate.
  - **No "arriving"**, no clock times.
- **Saved cards:** the meta line becomes "{estimate text} · {fare chip} · data from {date}". Offline it uses the cached snapshot model and walk graph if cached, else straight walks (labelled).
- **Help:**
  - New article "How times are estimated" (copy from `basis.ts`, plus "Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.").
  - New article "Vehicle types in Naga": one section per class with what is known, the fare rule, the status and the sources:
    - traditional: "₱14 first 4 km + ₱2.00/km, national rate 28 Sep 2026";
    - modern: "₱17 + ₱2.40/km; reported on R4 and R7 (2023–2024)";
    - e-jeepney: "one 2017 route, status unknown; no current route confirmed electric";
    - tricycle and e-tricycle: "₱15 minimum (Ordinance 2024-002); discounts exist for students, seniors, PWD and solo parents but eligibility is not verified, so ParaNaga does not apply them; e-trikes need a franchise";
    - UV Express and bus: "regional; per-km rates; see terminals".
  - "How trips are planned" updated (approximate paths, walk paths, the time estimate, the must-save-walking rule).
  - About data adds the badge "Approximate path".

Tests:
- unit: the guidance view yields remaining-time strings that pass the updated FORBIDDEN rules; the saved card shows the estimate and never "Time not available";
- e2e with a fixed clock (`page.clock.setFixedTime` at 07:10 Manila) → the peak note is present; at 09:30 → absent;
- guidance shows "About … min of riding left (estimate)" after "I boarded";
- the "How times are estimated" sheet lists N28/N16/N29/N04 and the assumptions;
- no element contains "arriving", "arrives in", "ETA" or a minutes token without "Estimate"/"≈"/"About";
- axe light/dark on options, detail, the sheet and both articles.

### Task 15: PWA cache additions and offline behaviour

Files: `src/domain/pwa/sw-routes.ts`, `src/app/sw.ts`, `src/client/pwa/data-handoff.ts` (accept lines and walk graph), `src/domain/pwa/offline-copy.ts` (straight-walk offline note), `tests/unit/sw-routes.test.ts`, `tests/e2e/offline.spec.ts`.

- Changes as in "PWA cache additions".
- Offline with the walk graph not yet cached: straight dotted walks + "Street paths need a connection the first time." Offline with both cached: identical drawing to online.
- `cachesToClear` covers both new caches.

Tests:
- unit: classify `GET /api/v1/network/lines/{uuid}` → cache-first `lines`; walk graph → `walk-graph`; with a query string → network-only; POST → network-only; handoff accepts both and refuses a 3 MB body;
- e2e (production build): first visit online with a plan → reload offline → the trip lines and the walk path draw from the cache, the time estimate is shown, and Cache Storage has no `/api/v1/plan` entry;
- "Clear data" removes `pn-lines-*` and `pn-walk-graph-*`.

### Task 16: Verification, docs, owner data steps and readiness

- **Owner and controller steps (after Tasks 4–7 review):**
  - run `scripts/fetch-osm-roads.ts` once and commit the snapshot (README row);
  - iterate street aliases (Task 5 preview);
  - `pnpm db:import --dry-run`;
  - create a Neon backup branch of `main`;
  - `pnpm db:import --commit`;
  - verify the published revision `modes-lines-{date}` and the API on the preview deployment.
- **Checks:** `pnpm verify`, `pnpm test:integration` (throwaway branch) and the full `pnpm test:e2e` in CI. Reviewers: `ecc:database-reviewer` (0006–0008, publish function diff), `ecc:typescript-reviewer`, `ecc:react-reviewer`, `ecc:security-reviewer` (new endpoints, payload sizes, no coordinates in URLs, handoff), `ecc:a11y-architect` (palette, legend, layers sheet, list equivalents).
- **Visual check** with `ecc:browser-qa` on Pixel 7 and 360×640, in light, dark, high contrast and low-data (dark land surface), covering every changed screen.
- **Copy audit:** grep the built UI for "arriv", "ETA", "live", "e-jeep" (allowed only on EJ-2017 and the Help article), "official", "exact", and minutes without "Estimate"/"≈"/"About"; justify every hit.
- **Docs:**
  - `docs/spec/04-data-model.md`: `route_vehicle_class`, `route_cooperative`, `terminal_version`, `regional_service`, `shape_version` (approximate trace), `walk_graph`, `eta_param`; the source code families N/U/OSMR.
  - `03-architecture.md`: §3.4 lines and walk-graph endpoints; §3.6 path distances, on-device walk routing, the D14 re-check; §3.7 the mixed-fleet fare span and regional per-km estimates; §3.11 the new caches.
  - `06-screens.md`: §6.5 copy rules for time estimates and approximate paths; the legend and Layers sheet; S11/S12 changes.
  - `02-features.md`: F-A6 "approximate paths" vs "reviewed shapes".
  - `07-delivery.md`: new §7.10 readiness (template §7.6), listing what is still missing (headways, verified shapes, TODA zones, fleet registry, PNR).
  - `data/source/osm/README.md` and `data/source/research/README.md`; `docs/setup.md` (road snapshot refresh procedure).
- **Backlog:** carry the reviewer Minors into `.superpowers/sdd/backlog.md`.

## Task order and sizing

Each task is sized for one implementer and one reviewer.

**Dependencies:** 1 → 2 → 3; 4 → 5 → 6; (3, 6) → 7 → 8 → 9 → 10; 11 can start after 1 (pure plus UI kit); 12 needs 7, 10 and 11; 13 needs 3, 10 and 11; 14 needs 9, 10 and 12; 15 needs 7 and 12; 16 last.

**Parallel tracks:**
- Tasks 1–3 (seed and modes data) and Tasks 4–6 (roads, tracer, walk graph) run in parallel.
- Task 9 (pure time-estimate domain) can start right after Task 1, against fixture parameters.
- Task 11 runs alongside Tasks 4–8.
- Tasks 12 and 13 run in parallel.

**Owner steps:** the road fetch (after Task 4 review), alias iteration (Task 5), and the Neon `main` import (Task 16).

1. Reviewed modes seed file (sources, terminals, fleets, feeders, fares, time-estimate parameters)
2. Migration 0006 and seed import (fleets, cooperatives, versioned terminals, regional services, fares, sources)
3. Read model and API for modes (views, snapshot, routes, terminals, search index)
4. OpenStreetMap road snapshot (fetch, strip, parse, road graph)
5. Approximate route path tracer (pure) and preview
6. Walk graph builder and on-device walk routing (pure)
7. Migration 0007, geometry and time-estimate parameter import, lines and walk-graph endpoints
8. Planner: path distances and vehicle classes on ride legs
9. Time-estimate domain (pure, TDD)
10. On-device walk paths, "must save walking" re-check, tricycle hint
11. Mode visual system (palette, icons, chips, legend), accessible
12. Map lines: trip guide, route overview, route detail paths
13. Terminals layer, terminal detail and the tricycle hint card
14. Time estimates in trip options, trip detail, guidance, saved trips and Help
15. PWA cache additions and offline behaviour
16. Verification, docs, owner data steps and readiness

## Out of scope here

- Live or typical traffic (TomTom only after its terms are verified, and only with a new Jev decision).
- Regional route lines on the map.
- Planning on tricycles, UV Express, buses, the 2017 e-jeepney route or Loops C/D.
- TODA zones, waiting times and headways, clock-time arrival.
- Admin shape editing and GPS ride-log calibration (Increment B and later), offline map tiles, translations.

## Open questions for the user

None block Task 1. Every product call above is either a Jev decision (J1–J8), a controller ruling (C1–C8) or a stated default (D1–D18) that you can change before Task 1. Two questions need you:

1. **Your report of modern jeepneys on Del Rosario and Pacol routes (U01).**
   - What is recorded: it is stored as "user report, unverified", and it only adds the text "modern units reported, not confirmed" to R2, R3 and R6.
   - What would change it: if you can say which routes (signboards), roughly when you saw them, and whether they were air-conditioned, U01 can carry that detail. With a photo of a signboard or the posted fare matrix, R6 could move to "reported" with a date, like R4 and R7.
   - Do you want to add those details?
2. **Asking the City for data.** The biggest gaps are:
   - the LTFRB Region V route and unit lists;
   - the April 2026 fuel-subsidy beneficiary list (fleet by cooperative and class, Ordinance 2026-038);
   - the SimEx speed and headway results;
   - the 2025 LPTRP tricycle-zone map.

   Only the City PSO or the cooperatives office can supply them. Should ParaNaga prepare a short data-request letter for you to send? Nothing would be sent on your behalf.

## User decisions (2026-10-16, supersede conflicting items above)

- **E-jeepney: dropped.** The 2017 e-jeepney loop is not confirmed and not running; do not import, show, search or plan it anywhere (remove it from the seed, candidates and UI tasks).
- **Modern jeepneys on R4 and R7: operating now.** The project owner confirms modernized jeepneys run today on R4 (Centro–Del Rosario via Panganiban) and R7 (Centro–Carolina–Panicuason). Record the owner confirmation as source `U01` ("project owner confirmation", dated 2026-10-16) alongside N14/N38/N39/N41; status `operating`; label "Traditional and modern jeepneys" with no "last reported 2024" caveat.
- **No modern-unit claim on other routes.** R2, R3, R5, R6 and R8 are traditional jeepney only (drop the R6/R2/R3 "reported, not confirmed" modern entries).
- **Traditional jeepneys: confirmed operating on all routes.** The owner confirms traditional jeepneys run today on every LPTRP route group (R1–R8). Route operating status becomes `operating (owner-confirmed 2026-10-16)`. This confirms service, not stop locations, stop order or paths: stop pins, pin order (Loops A/B) and drawn paths keep their unverified/approximate labels and the trip badge stays.
