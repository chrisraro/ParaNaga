# Plan: anywhere-alight planner, tricycle and padyak options, route coverage (Increment E)

Date: 2026-10-17 · Branch: `feat/anywhere-alight` (worktree `.worktrees/anyalight`, from master `1828324`, which is production and holds Increments 1–D: data import, provisional Loop A/B planner, commuter screens, places, guidance, offline PWA, modes, approximate route paths, walk graph, time estimates).
Research (all in `.superpowers/research/`): `tricycle-restrictions-2026-10.md` (T01–T24), `loops-and-routes-2026-10.md` (L01–L19), `padyak-2026-10.md` (P01–P22), `jeepney-hours-2026-10.md` (H01–H21), `naga-transport-research-2026-10.md` (N01–N41), each with its candidates JSON. Code map: `.superpowers/sdd/planner-map.md` (10 change points). Binding rules: `.superpowers/sdd/global-constraints.md` (its last section, "User decisions 2026-10-16", overrides the rest).
Spec: `docs/spec/03-architecture.md` (§3.4 request paths, §3.6 planner, §3.7 fares, §3.11 PWA), `04-data-model.md`, `06-screens.md` (S4–S9, §6.5 copy rules, §6.6 accessibility).
Earlier plans: `2026-10-15-data-and-provisional-planner.md`, `2026-10-15-maps-core.md`, `2026-10-16-commuter-screens.md`, `2026-10-16-modes-lines-eta.md`. Their decisions still apply unless this plan names the one it replaces.

Goal: plan jeepney trips that board and get off anywhere along a route's approximate path (not only at mapped pins), on every LPTRP route that has a traced path (R1–R7 and Loops A–D, which today are unplannable because only Loops A/B have a stop order); add a tricycle option to every trip and a padyak option where a documented padyak area covers both ends; measure every walk, tricycle and padyak distance as the shortest passable path on the bundled OpenStreetMap street graph; and surface "ask the driver" route notes and a soft service-hours hint, all labelled with their evidence.

User requests (2026-10-17): (1) riders board and get off anywhere along a jeepney's route path; (2) recommend walking only under 500 m; always suggest a tricycle after the jeepney options, recommended above 500 m and shown even when no jeepney ride exists; (3) tricycles may not use highways and prohibited roads (use the research); (4) padyak option in documented areas (about ₱10); (5) re-verify loop data, add notes such as "City Hall/BFP/BIR are on J. Miranda Ave — ask the driver"; (6) the routes the app misses today (Panicuason–Carolina–Pacol, Del Rosario–Concepcion via Panganiban/Diversion/Magsaysay, "Francia", Balatas, Cararayan) must work; (7) every distance is the shortest passable path on the on-device OSM graphs, no external routing API; (8) service-hours hints (some jeepneys start about 5 am).

## Data reality (binding for every task)

### What the research supports

| Topic | What exists | Sources | How it is used |
|---|---|---|---|
| "Missing" routes | Not missing from the law. R1 Centro–San Isidro via Cararayan (Balatas Rd is part of it), R2 Del Rosario via Magsaysay, R3 via Roxas/Diversion, R4 via Panganiban, R5 San Felipe, R6 Pacol, R7 Carolina–Panicuason are LPTRP routes (Ord 2025-070). They have traced approximate paths (Lines, status `ok`) but no stop order, so `network-repo.getSnapshot` (inner join on route stops) emits no variant and the planner never sees them. | L01, planner-map §4 | Planning on paths fixes all of them. No new route records. |
| Loops A–D | Street lists re-verified against the signed Ord 2025-070 PDF: all four match the seed. Loops A/B already run Taal Ave → J. Miranda Ave → Leon SA Aureus/Mayflower. Loops C/D omit J. Miranda in the ordinance; Res 2025-172 (Apr 2025 dry run) had added it. Eastbound Terminal variant (Res 2025-735) was a 30-day trial that ended Dec 2025; permanence unconfirmed. | L01, L03, L04 | Loops C/D become plannable on their traced paths. Trial variants stay drawn but are not planned. C/D get an "ask the driver" note for J. Miranda. |
| Landmarks on J. Miranda | City Hall (13.6261, 123.1987), BFP Naga station (13.6251, 123.1994), BIR RDO 65 (directory address J. Miranda Ave; no OSM object). A second OSM "BFP Naga City" at 13.6298, 123.2083 is unexplained. | L12, L14 | Note anchor for the J. Miranda notes (J. Miranda/Mayflower station). |
| Request reroutes | Only the owner reports drivers rerouting on request (Magsaysay, City Hall, BFP, BIR). No document. | L17 (owner) | Recorded as owner report U02, never as route geometry. |
| "Francia" | In no instrument. A private guide lists "Diversion Road to Magsaysay, Francia and Centro"; Ord 99-031 named R2's predecessor "via Peñafrancia Avenue". | L07, L15 | Owner-report alias note on R2 only, "unconfirmed". |
| Tricycle restrictions | Ord 2006-005/2006-015 (same text): franchised trimobiles may not use four national-road portions (San Felipe portion from Peñafrancia Cemetery; Concepcion Pequeña→Del Rosario from the Magsaysay–Roxas–Panganiban junction; Roxas Ave (Diversion) whole; Magsaysay Ave from the Basilica Rd/Dayangdang corner toward Roxas), except 21:00–05:00 and six crossing points. Currency medium-low (no amendment found). VISTODA special units may not enter Tecla San Andres–Ziga Rd (Ord 2025-056/067). E-trike national-road ban is news only. Ord 2026-023 is a lane rule, not a ban. DILG MC 2020-036 national ban: policy, not applied by Naga (no route plan found). Ord 2020-113: tricycles operate only within franchise areas. | T01, T02, T07, T08, T10, T13–T16, T22 | Hard-exclude only the four named portions (by OSM way id, reviewed), lift them 21:00–05:00, exempt the crossing segments; national-road and franchise-zone facts as notes only. |
| Tricycle fare | ₱15 minimum (Ord 2024-002, F03); 20 % discount exists but eligibility unverified, not applied. No distance matrix. | N33, S04 | "Minimum fare ₱15 · confirm with the driver". No total beyond the minimum. |
| Padyak | Franchised per association area (Ord 2001-086 and later: Abella, Sabang, Igualdad, Sta. Cruz, Balatas, Calauag, Liboton, Tinago, Concepcion Pequeña/Grande, Del Rosario, Triangulo, San Felipe, Mabolo, Bagumbayan Sur, Cararayan). Fare ₱10 per passenger, ₱8 with ID discount, 2 passengers (Ord 2022-071, effective 1 Oct 2022; F04). Banned streets (Ord 93-049 Sec 132): CBD except 20:00–06:00, Mabolo Dr, Roxas Ave, Panganiban Ave, Concepcion Rd (Roxas/Magsaysay junction → Del Rosario boundary), Magsaysay Ave (Panganiban/Concepcion junction → Peñafrancia junction), Peñafrancia Ave, Elias Angeles St and Bagumbayan Rd to the Bagumbayan Norte boundary. Franchising still active (Ord 2026-024). CBD boundary is not defined in the text. | P01–P03, P06–P14 | Padyak option only inside one documented area, routed on streets without the banned portions. |
| OSM place nodes | The pinned road snapshot `naga-roads-2026-10-16.osm.json` carries about 59 named `place` nodes (quarter, village, neighbourhood), e.g. Balatas, Tinago. No barangay polygons anywhere in project data. | OSMR-2026-10-16 | Anchors for padyak areas. |
| Service hours | No official or news source gives first/last trips or headways. Weak, possibly copied sources: jeepneys about 05:00–21:00 (blog H08), OSM jeepney station 05:00–23:30 (H09), van terminals 05:00–18:00 (H01, H10). Owner: some start about 5 am or before. | H01, H08–H10, owner | One city-wide soft window, warn never hide. |
| Speeds | No tricycle or padyak speed is sourced. | — | No minutes for tricycle or padyak legs (D11 unchanged). |

### What stays unknown, and is never shown as known

- Where a jeepney will actually stop on request, which side of the street, and whether a driver will take a passenger to a point off the printed street list.
- Whether the 2006 tricycle ordinances are still enforced; which roads a Naga Tricycle Route Plan (if any) allows; tricycle franchise zones (the 2025 LPTRP tricycle zone map was not retrieved).
- Which padyak associations run today, their exact area boundaries, terminals, and whether ₱10 still holds.
- The CBD boundary for the padyak night rule.
- First and last trips, headways, Sunday/holiday service for any jeepney route.
- Which BFP station riders mean; where BIR's entrance is; whether "Francia" is R2's signboard; whether Loops C/D enter J. Miranda Ave today.

## Decisions

### Jev decisions (model `typesafe/jev-1.14-20261014`, tool `jev_classify`, 2026-10-17)

Jev is acted on only at certainty ≥ 0.8. Below that the plan decides and flags the call for the user.

| # | Question | Options (probability) | Certainty | Decision |
|---|---|---|---|---|
| E-J1 | Where the planner gets route geometry and graph distances | planner inputs Lines + street graph on both sides (1.00) · embed paths in snapshot, device enrich (0.00) · device-only planning (0.00) | 1.00 act | **Planner inputs on both sides** (A below). |
| E-J2 | Which traced variants are planned | permanent jeepney variants with a drawn path, ok or flagged, flagged rides carry a note (0.95) · permanent ok only (0.05) · all drawn incl. trial (0.00) | 0.92 act | **Permanent, ok or flagged; no trial, no untraced.** |
| E-J3 | How the tricycle road graph ships | one street graph v2 with per-edge flags (0.98) · separate tricycle payload (0.01) · no graph (0.01) | 0.97 act | **Street graph v2 with edge flags** (C below). |
| E-J4 | How the 21:00–05:00 exception applies | planner clock "now", Manila time (0.84) · always daytime rules (0.14) · ignore (0.02) | 0.76 review | **Decided here (flagged): planner clock "now".** Reason: the server and device both plan "now"; using their own clock sends nothing new, and the 2006 text grants the night window, so a night trip that avoids Roxas Ave would be a needless detour. The option states which rule applied. |
| E-J5 | How a padyak area is represented | nearest OSM place node + radius cap (0.80) · OSM boundary polygons (0.01) · note only (0.19) | 0.70 review | **Decided here (flagged): nearest place node + 1,000 m cap**, labelled approximate. Reason: it uses data already pinned (no new fetch), and the cap plus "both ends in one area" errs toward missing a padyak option rather than offering a wrong one. |
| E-J6 | Plan API compatibility | same endpoint, additive schema, saved `RECORD_FORMAT` 2 (0.79) · new `/api/v2/plan` (0.20) · runtime flag (0.01) | 0.69 review | **Decided here (flagged): same endpoint, additive.** Reason: server and client deploy together; a stale tab errors once and recovers on reload, while a v2 endpoint would keep two planners alive (contrary to deletion over addition). Rollback is covered by the format bump (older code keeps newer records as `newer_format`). |
| E-J7 | Where route notes and the service window live | notes as seed records in a new table, window as a constant (0.70) · both constants (0.21) · both in DB (0.09) | 0.55 review | **Decided here (flagged): route notes in the reviewed seed and a new `route_note` table; service window a pure constant with sources.** Reason: notes cite sources that must appear in the Sources screen and change with owner confirmations (data, not code); one city-wide weak window does not justify a table. |

Model tiers per task are in "Task order and sizing".

### A. Path-based boarding and alighting

- **Geometry source (E-J1).** `planTrip(snapshot, network, origin, destination, { now })` where `network = { lines: Lines | null, streets: StreetGraph | null }`. The server plan route loads the published revision's Lines and street graph from the database (existing `getLines`, `getWalkGraphPayload`) and keeps the decoded pair in a module-level cache keyed by revision id (at most 2 revisions; both are immutable). The offline planner passes the copies the service worker holds. The snapshot is unchanged (no paths embedded). One domain function, two callers.
- **Which variants (E-J2).** Every Lines entry with `mode = jeepney`, `kind = permanent`, status `ok` or `flagged`. Trial variants (Eastbound, R8-A/B) and untraced variants are never planned. A flagged path adds the ride note "Part of this approximate path disagrees with the street map (one-way or off the street list); the jeepney's real street may differ."
- **Direction.** Each Lines entry is ridden in its path order only. Inbound and outbound are separate entries (R1, R2, R5, R6, R7). A variant is a **circuit** when its `direction` is `circuit`, `clockwise` or `counterclockwise` **and** its path ends lie within 60 m of each other; otherwise it is a **line**.
- **Approaches.** The path is sampled every 25 m (plus every vertex). An *approach* to a point P is a maximal run of consecutive samples within 500 m straight-line of P; each approach contributes one candidate measure, the projection of P onto the path (`geo/measure.ts` `projectOnLine`) restricted to that run. A path that passes P twice (out and back, circuits, R3/R4) gives two candidates.
- **Rides.** For a variant, every pair (board approach to the origin, alight approach to the destination) with ride distance `d`:
  - line: `d = alightM − boardM`, kept when `d ≥ 200`;
  - circuit: `d = (alightM − boardM) mod pathLengthM`, kept when `200 ≤ d < pathLengthM` (never one full lap or more).
  The best pair per variant (lowest score, below) is kept.
- **Walk caps.** Candidates come from the 500 m straight-line tolerance (replaces `MAX_ACCESS_WALK_M` 600). The kept access or egress walk must be ≤ 750 m along the street graph (graph length; ×1.3 estimate when the graph is absent). A ride must still **save walking** (D14 kept, below).
- **Transfers (max 2 rides, unchanged).** Precomputed once per revision and cached with the network: for each ordered pair of planned variants, the samples of variant 1 whose nearest point on variant 2 is within 300 m straight-line, grouped into runs; one transfer per run at the closest sample pair. Shared streets give a 0 m transfer ("change jeepney here"). The transfer walk is graph-measured and must be ≤ 450 m.
- **Naming a free point.** A board or alight point takes the name of the nearest snapshot stop of the same variant within 100 m along the path (Loops A/B pins), else the nearest snapshot stop within 100 m straight-line, else none. With no name the copy uses the user's own place: "Get on near your start", "Get off near {destination name}". Pins stop being the only places to board; their order no longer drives planning (provisional pin order is used for names only).
- **R8-A/B pins coexist.** The Lines variant id equals the snapshot variant id for A/B, so their pins join by id for naming. R1–R7 and C/D have no pins and work the same way without names.
- **Deleted.** `graph.ts` stop-based `forwardRides`, the stop transfer graph, `pathSegments`, and `RideLeg.stopMeasuresM` generation. The stop-order snapshot variants remain in the snapshot (stop detail and route pages use them).

### B. Recommendation rules

- **Direct walk.** `directWalkM` = street-graph walk length origin → destination (×1.3 straight estimate when the graph is absent, labelled).
- **Walk option** only when `directWalkM < 500`: labelled **Recommended**, listed first. At 500 m and above there is no walk card; the note "Walking the whole way is about {m} m along streets" stays in `notes`.
- **Jeepney options:** the Pareto set on (rides, walk metres, ride metres) as today, at most 3, labelled "Fewest transfers" and "Least walking" (one option may hold both). Must-save-walking (D14) applies, now in the planner on graph lengths: an option is kept only when its walk metres (graph) are strictly less than `directWalkM`. Score unchanged: `walkM + 0.25 × rideM + 600 × (rides − 1)`.
- **Tricycle option:** always present (inside the city, not same place), listed **after** the jeepney options. Labelled **Recommended** when `directWalkM ≥ 500`, otherwise unlabelled. Shown also when no jeepney option exists.
- **Padyak option:** when both ends are in one documented padyak area and a padyak path ≤ 2,000 m exists; listed after the tricycle; labelled "Short local ride".
- **Order:** walk (if any) → jeepney options by score → tricycle → padyak. At most 6 options.
- **Labels.** `PLAN_LABELS` becomes `Recommended`, `Fewest transfers`, `Least walking`, `Short local ride`; `labels` may be empty (an unlabelled tricycle under 500 m). Each option gains `mode: "walk" | "jeepney" | "tricycle" | "padyak"`.
- **Coverage.** `coverage: "none"` only for `outside_city` and `same_place`. New `jeepneyReason` (nullable): `no_path_near_origin`, `no_path_near_destination`, `walk_shorter`, `no_route`, shown as one line above the tricycle option ("No jeepney route passes near your start").
- **Deleted.** `enrich.ts` D14 re-check, `relabelOptions` and `savesWalkingD14` (the planner already decided on graph lengths). The tricycle hint card (`tricycle-hint.tsx` and the hint wiring in `home-screen.tsx`); its nearest-terminal/feeder text moves into the tricycle option detail ("Nearest tricycle terminal: {name}, about {m} m").

### C. Tricycle and padyak routing

- **Street graph format v2 (E-J3).** The walk graph payload gains format v2: the union of walk-profile and tricycle-profile edges, plus:
  - `flags: int[]`, one per edge: bit 0 walk allowed; bit 1 tricycle allowed a→b; bit 2 tricycle allowed b→a (one-way honoured, `oneway`, `junction=roundabout`; `oneway:psv` does **not** apply to tricycles); bit 3 national road (`highway=trunk|primary` and their links, for the note only); bit 4 padyak banned (Sec 132 ways); bits 8–15 tricycle restriction rule index + 1 (0 = none).
  - `rules: [{ code, label, sourceCodes, liftedFrom: "21:00", liftedTo: "05:00" }]` — today one rule, `TRI-2006` ("Ordinance 2006-005/015 · check for updates", T01/T02).
  - The decoder accepts v1 (all edges walk-only) and v2. Same endpoint `/api/v1/network/walk-graph/:revisionId`, same service-worker cache (key changes with the revision). Budget raised to **800 KB raw / 260 KB gzip** (budget test; migration 0010 raises the column check).
- **Tricycle profile** (`road-graph.ts`): drivable classes as `vehicle` minus `motorway|motorway_link|busway`; `motor_vehicle|vehicle|access = no|private` block; `psv`/`bus` allowances do not unlock. The road class alone never excludes (research §4).
- **Hard exclusions, documented only.** A reviewed seed list `roadRules` maps each 2006 portion to OSM way ids in the pinned snapshot, clipped at the stated start node, each with `evidence` (ordinance, page), `review` and `clipNote` (e.g. "from the Magsaysay–Roxas–Panganiban junction node 123 toward Del Rosario, to the city boundary"). The six crossing points are `exempt` entries (way ids or single edges) that stay usable at all hours. The importer aborts when a listed way id is absent from the snapshot. VISTODA's Tecla San Andres–Ziga Rd rule applies to special units only and is **not** applied to the generic tricycle; e-trike news rules are not applied (both appear in Help as unverified).
- **Time of day (E-J4).** `planTrip` receives `now` (server clock online, device clock offline), converted to Asia/Manila (`eta/manila-time.ts`). Between 21:00 and 05:00 restricted edges are usable; otherwise they are not. The option shows "Avoids Roxas Ave, Magsaysay Ave (Basilica–Roxas), Concepcion Rd (to Del Rosario) and the San Felipe road (Ordinance 2006-005/015; allowed 9 pm–5 am)" or, at night, "Uses roads tricycles may use only 9 pm–5 am (Ordinance 2006-005/015)".
- **Padyak areas (E-J5).** Seed records `padyakAreas: [{ code, association, barangays, placeNodeIds, sourceCodes, documentedYear, review }]`. A point is in an area when its nearest place node of the **whole** snapshot is one of the area's nodes **and** it is within 1,000 m of that node (assumption A4, stored in the seed header). Both ends must fall in the same area. The payload `places` array (v2) carries the place nodes `[osmId, latE5, lngE5, areaIndex | -1]`. Padyak edges: walk-profile edges that are also tricycle-profile classes or `residential|service|living_street|unclassified|track` (padyak rides on small streets; Ord 89-065), minus bit 4. The CBD rule is not drawn as geometry (no boundary): the padyak option says "Not allowed in the city centre 6 am–8 pm (Ord 93-049 Sec 132)".
- **Router.** `routeStreet(graph, from, to, { mode: "walk" | "tricycle" | "padyak", now })`: snap ≤ 100 m (as today), A* with a haversine heuristic, directed for tricycle (bits 1–2), mode masks and rule windows applied. For walk distances the planner runs one bounded Dijkstra (radius 1,500 m network) from the origin and one from the destination and reads distances to every candidate point from them; transfers run one bounded Dijkstra per alight candidate (radius 450 m). Distances are graph lengths including snap legs, rounded to whole metres: "fully factual shortest passable path" within the map data.
- **Fallback (graph not loaded, offline only).** Walk distances fall back to round(straight × 1.3) labelled "straight-line estimate" (today's rule). The tricycle option is still shown without a distance: "Street route not available offline". No padyak option (area membership needs the place nodes).

### D. Plan API, schema and compatibility

- **New leg kinds.** `tricycle` and `padyak`: `{ kind, from: Place, to: Place, distanceMeters | null, path: encoded p5 | null, basis: "street_graph" | "unavailable", fare, notes: string[], ruleCodes: string[] }`. Tricycle fare: `{ minCentavos: 1500, maxCentavos: null, status: "minimum", ruleCodes: ["F03"], discountsApplied: false }`. Padyak fare: `{ minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", discountedCentavos: 800, ruleCodes: ["F04"] }`, copy "₱10 per passenger (₱8 with ID discount) · city fare set Sep 2022 · confirm with the driver · up to 2 passengers".
- **Ride legs with free points.** `board` and `alight`: `{ lat, lng, measureM, stopId | null, name | null }`; `stops` becomes `.default([])` (no `min(2)`), filled only with the named pins passed. `distanceBasis: "approximate_path"` always for new legs; `boardMeasureM`/`alightMeasureM` mirror `board/alight.measureM`; `notes: string[]` (route notes, flagged path note). `stopMeasuresM` stays optional (old bodies).
- **Walk legs** gain `path: encoded p5 | null` and `basis: "street_graph" | "straight_x1_3"`; `estimateMeters` stays (= graph length when graph-based).
- **Option.** `mode`; `labels` `min(0)`; `options.max(6)`; `plan.jeepneyReason` (default null). Option id scheme: walk `walk`; tricycle `tricycle`; padyak `padyak:{areaCode}`; a ride `{variantId}@{round10(boardM)}-{round10(alightM)}` joined by `>`. Old stop-based ids remain valid strings in saved records; `sameRides` compares variant sequence and measures within 50 m (a format-1 record compares by variant sequence only).
- **Compatibility (E-J6).** Every new field has a default so format-1 saved trips, old guidance sessions and old offline-cached responses still parse in new code. New code writes saved records with `RECORD_FORMAT = 2` (pure migration 1 → 2 adds the defaults); format-1 code (rollback) keeps format-2 records as `newer_format` and does not open them. The guidance session format bumps; an unreadable session is discarded (today's behaviour). Old open tabs that receive the new response fail once and recover on reload (the shell updates).
- **Guidance without a ride leg.** `steps.ts` builds `walk_to_destination` or a single `tricycle`/`padyak` step when there is no ride; the `end!` crash path is removed.
- **Time estimates.** Walk legs use the graph length (D8). Jeepney rides use path distance (D9). Tricycle and padyak legs: `estimated: false`, total `partial: true`, "· tricycle time not estimated" / "· padyak time not estimated" (D11 unchanged).
- **Regression digest.** `tests/unit/planner-real-loops.test.ts` is rebaselined deliberately (Task 6): fixture becomes the real Lines + street graph built from the committed road snapshot; new `REGRESSION_BASELINE` recorded with a written diff summary in the commit (option counts per mode, how many former stop-based options keep the same variant sequence).

### E. Route notes, owner reports and the service window

- **Route notes (E-J7)** are reviewed seed records `routeNotes: [{ routeCode, text (≤ 120 chars), evidence: "ordinance" | "resolution" | "owner_report" | "community_map", sourceCodes, near: { lat, lng, radiusM } | null, review }]`, imported into `transit.route_note` and published in `snapshot.routes[].notes`. A note with `near` shows when the board or alight point (or the destination) is within its radius; one without shows in route detail and ride detail. At most one note line per ride on the option card, all in detail. Initial records:
  - R8-C, R8-D: "City Hall, BFP and BIR are on J. Miranda Ave. This loop's listed streets skip it (Ord 2025-070); ask the driver." near J. Miranda/Mayflower (13.6256, 123.1990), 450 m; sources L01, L03, U02.
  - R8-A, R8-B: "Passes J. Miranda Ave (City Hall, BFP, BIR) on its listed streets." near same, 450 m; source L01.
  - R8-A..D: "A local reports drivers may turn into side streets on request (e.g. Magsaysay Ave). Ask the driver." no `near`; owner report U02.
  - R2: "A local reports a 'Francia' signboard may be this route; unconfirmed." no `near`; U02, L15.
- **Owner reports** become source `U02` ("Project owner report to ParaNaga, 2026-10-17: request reroutes on loops; 'Francia' signboard; padyak in Abella, Sabang, Sta. Cruz, Igualdad; some jeepneys start about 5 am or before"), evidence type `user_report_unverified`.
- **Service window** is a pure constant `JEEPNEY_SOFT_WINDOW = { start: "05:00", end: "21:00", sourceCodes: ["H08", "H09", "H01", "H10", "U02"], basis: "Weak sources; no official timetable" }` in `src/domain/eta/service-window.ts`. Computed on the device clock when the plan is shown: before 05:00 or after 21:00 → "This ride starts outside the usual hours (about 5 am–9 pm, unconfirmed). A jeepney may not be running. Check with the driver or terminal."; 20:00–21:00 → "Last trips may already have left (unconfirmed)."; before 05:00 adds "Some jeepneys reportedly start before 5 am." Never hides an option. Help adds "Sunday and holiday service not confirmed."

### F. Rollout

1. Merge PR (CI e2e gates merge).
2. Owner: create a Neon backup branch of `main`; note the published revision id (rollback target).
3. Apply migration `0010` (additive).
4. `pnpm db:import --dry-run` (prints road-rule lengths, padyak areas, graph bytes, notes), then `--commit`: publishes `anywhere-alight-{date}` through `carryForwardRevision` (stop and route ids unchanged).
5. Deploy happens with the merge (Vercel); the new code reads v1 graphs of the old revision until the import publishes v2, so deploy-before-import is safe.
6. Smoke test on production: the seven trips in Task 13.
- **Rollback:** re-publish the noted revision (`publish_revision` rollback path, docs/setup.md), then redeploy the previous build. Migration 0010 stays (additive, unused by old code). Saved trips written by new code show as "made by a newer version" in old code.

## Global Constraints

- Everything in `.superpowers/sdd/global-constraints.md` "Global Constraints" still binds: stack (Next.js 16.4, read `node_modules/next/dist/docs/` before Next-specific code), pure `src/domain/**`, no `src/server` imports from client/UI, `server-only`, `withRequestContext`, Zod at every boundary, RLS on every new table, integration tests on a throwaway Neon branch, no network at import/build/runtime except owner fetch scripts, ODbL attribution, honesty copy, WCAG 2.2 AA, privacy, TDD with `fast-check`, minors to backlog, affected Playwright specs only in fix rounds and full suite in CI, commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Planner purity.** `planTrip` stays pure: `now` is an argument; the network is an argument; no I/O.
- **Privacy.** The plan POST body stays two points. The street graph and Lines URLs carry only the revision id. Server logs never contain points.
- **Performance.** `planTrip` on the real network: < 150 ms p95 on a mid phone, < 50 ms on the server (benchmark test logs, not asserted). Server network cache per revision; decoded street graph memory < 20 MB.
- **Honesty additions.**
  - Free points: "Get off near {place} · tell the driver 'para' · stop not marked". Every ride keeps "Approximate path, not a verified route shape" and the badge "Unverified route — confirm with the driver".
  - Tricycle: "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver", "Tricycle time not estimated", "Tricycles serve their franchise zone; a long trip may need a change (Ord 2020-113)", and when the path uses a national road: "National rules may limit tricycles on national roads; Naga has not published a tricycle route plan."
  - Padyak: "Area per city ordinance ({year}) · approximate boundary · service not confirmed today".
  - Never: "exact", "guaranteed", "official route" (except a cited ordinance), "arriving", "ETA".

## New migration

### `0010_route_notes_graph_v2.sql`

- **`ingest.source.code` check:** also allow the research codes, stored with an `R` prefix (`RT01`, `RL01`, `RP01`, `RH01`) so they never clash with terminal codes `T01…` (regex `^R[TLPH][0-9]{2}$`); `U02` already matches `^U[0-9]{2}$`.
- **`transit.route_note`** (entity kind `route_note`; immutable rows; a change is a new row): `route_id`, `text` (check `char_length ≤ 120`), `evidence` (check in `ordinance`, `resolution`, `owner_report`, `community_map`), `near_geog geography(Point,4326)` nullable with `near_radius_m int` (both or neither, `50..2000`), `source_codes text[]` (cardinality ≥ 1), `content_hash`, `is_synthetic`, `created_at`. ENABLE + FORCE RLS; `paranaga_app` select `using (true)`; writes only by `paranaga_import` on draft rows.
- **`revision_member.entity_kind` check:** add `route_note`.
- **`publish_revision`** (`create or replace`, keeping every 0003/0006/0007 check): a `route_note` whose route is not a member is refused; synthetic refused.
- **`walk_graph_version.bytes` check** raised to `<= 819200`; `format_version` check `in (1, 2)`.
- **View `v_published_route_notes`** (`security_invoker = true`, synthetic hidden, `grant select … to paranaga_app`); `v_published_sources` unions its source codes.
- `pnpm db:check-rls` passes.

## Importer changes (summary; details in Tasks 1, 2, 4)

1. Reviewed seed: `data/source/research/naga-modes-seed-2026-10-16.json` gains `sources` (RT/RL/RP/RH, U02), `roadRules`, `padyakAreas`, `routeNotes`, header assumption A4. The research JSON is never read by the importer (D1).
2. Street graph v2 built from the pinned road snapshot with the reviewed rules and areas; stored in `walk_graph_version` (`format_version = 2`).
3. Route notes imported into `route_note`.
4. Dry run prints: restricted and exempt metres per rule; padyak-banned metres; per padyak area, its place nodes and their nearest-node coverage; graph nodes, edges, bytes, gzip bytes; notes per route.

## API changes

| Endpoint | Change | Cache |
|---|---|---|
| `GET /api/v1/network/snapshot/:revisionId` | `routes[]` gains `notes: [{ text, evidence, sourceCodes, near: {lat, lng, radiusM} \| null }]` (default `[]`) | unchanged (immutable) |
| `GET /api/v1/network/walk-graph/:revisionId` | Serves format v2 for new revisions (v1 for older ones) | unchanged (immutable, `ETag`) |
| `GET /api/v1/network/lines/:revisionId` | Unchanged | unchanged |
| `POST /api/v1/plan` | Request unchanged. Response per section D: `mode`, tricycle/padyak legs, ride `board`/`alight`, leg `path`/`basis`, `labels` may be empty, `options.max(6)`, `jeepneyReason`. | unchanged (`no-store`) |
| `GET /api/v1/routes/:code` | `notes[]` as in the snapshot | unchanged |

## UI changes (summary; details in Task 10)

- **Trip options:** headline per mode ("Walk", "Jeep R4 + Loop A", "Tricycle", "Padyak"); the tricycle card shows distance along streets, "Minimum fare ₱15 · confirm with the driver", "Time not estimated"; the padyak card shows "₱10 per passenger"; the `jeepneyReason` line above the tricycle card; the service-window warning on jeepney cards; one route-note line per ride when it applies.
- **Trip detail:** ride steps "Get on near {place}" / "Get off near {place} · tell the driver 'para' · stop not marked" with named pins passed listed when any; tricycle step with the restriction line, the national-road note, nearest tricycle terminal; padyak step with area, rules and fare; notes with evidence chips.
- **Map:** tricycle and padyak legs solid in the tricycle colour (padyak dashed `8 6` so colour is not the only cue; legend entry "Padyak"); ride slices from `boardMeasureM` to `alightMeasureM` on the Lines path (wrap on circuits, existing slicing); board/alight markers at the free points.
- **Deleted:** the "Tricycle may serve this" card.
- **Help:** "How trips are planned" (anywhere-alight, the 500 m rule, tricycle and padyak options, rules applied) and "Vehicle types in Naga" (padyak section, tricycle restrictions with sources and the unverified e-trike/VISTODA notes, service window).

---

### Task 1: Research sources into the reviewed seed (transcription)

Files: `data/source/research/naga-modes-seed-2026-10-16.json` (sources only), `src/domain/import/modes-seed.ts` (source-code regex `^R[TLPH][0-9]{2}$`, `U02`), `tests/unit/import-modes-seed.test.ts`, `data/source/research/README.md` (one row per new family).

- Copy every source record of the four research candidate JSONs (T01–T24, L01–L19, P01–P22, H01–H21) as `RT01…`, `RL01…`, `RP01…`, `RH01…`: title, publisher, date, url (null when none), type, retrieved date, Jev triple in `properties`. Each with `review: { decision: "import", reason: "research 2026-10-17", reviewedOn }`, except sources the research marks "not used" (e.g. the Philstar Naga-Cebu item) → `exclude` with that reason.
- Add `U02` with the exact title in section E.

Tests: the parser accepts the file; every new code is unique and matches the regex; counts per family equal the candidate files; U02 is `user_report_unverified`.

### Task 2: Road rules, padyak areas and route notes in the seed (judgement, reviewed)

Files: `scripts/preview-road-rules.ts` (one-off; renders matched ways for each rule on a Leaflet preview HTML in the scratch folder, prints way ids, names, lengths), `data/source/research/naga-modes-seed-2026-10-16.json` (`roadRules`, `padyakAreas`, `routeNotes`, header `assumptions.A4`), `src/domain/import/modes-seed.ts` (Zod + cross-checks), `tests/unit/import-road-rules.test.ts`.

- `roadRules`: four `TRI-2006` portions and six `exempt` crossings exactly as section C, plus Sec 132 padyak bans (`PADYAK-SEC132`, eight items; the CBD item recorded as `geometry: "not_mapped"` with the reason "CBD boundary not defined in the ordinance text"). Each record: `ruleCode`, `kind: "exclude" | "exempt"`, `appliesTo: ["tricycle"] | ["padyak"]`, `wayIds`, optional `fromNodeId`/`toNodeId` clip, `clipNote`, `sourceCodes`, `review`.
- `padyakAreas`: one record per documented association area that has a matching place node (barangay name match on `place` nodes; no match → `exclude` with "no place node in the road snapshot"); `documentedYear` from the latest ordinance naming it; owner-reported barangays add `U02`.
- `routeNotes`: the five records in section E.
- Loop re-verification check: a test asserts the seed street lists of R8-A..D equal the Ord 2025-070 sequences quoted in `loops-and-routes-2026-10.md` A1 (already true; it guards regressions), and that the C/D J. Miranda conflict is in `conflicts`.

Tests: every way id and node id exists in `naga-roads-2026-10-16.osm.json`; every clip node lies on its way; rules have sources; no rule names an OSM class instead of ways; area node ids are `place` nodes; note text ≤ 120 chars and has a source; owner-only notes carry `owner_report`.

Owner/controller step: review the preview of every clipped portion before the task is accepted.

### Task 3: Street graph v2 and on-device routing (pure)

Files: `src/domain/geo/road-graph.ts` (profile `tricycle`), `src/domain/walk/walk-graph-build.ts` → keeps its name, builds v2 (`buildStreetGraph(roads, rules, areas)`), `src/domain/walk/format.ts` (v2 schema; v1 still accepted), `src/domain/walk/walk-graph.ts` (decode v1/v2; `routeStreet`; `boundedDistances`), `src/domain/walk/rules.ts` (rule windows with `eta/manila-time.ts`), `tests/unit/walk-graph-build.test.ts`, `tests/unit/walk-graph-route.test.ts`, `tests/unit/street-graph-modes.test.ts`, `tests/unit/walk-graph-budget.test.ts`.

- Flags, rules and `places` exactly as section C. Island rule per mode: keep the largest connected component of the union plus components over 50 nodes (as today).
- `routeStreet(graph, from, to, { mode, now })` → `{ kind: "path", coords, lengthM, snapFromM, snapToM, usedRules: string[], usesNationalRoad: boolean }` or `{ kind: "straight", reason }`.
- `boundedDistances(graph, from, radiusM, mode)` → a lookup giving the graph distance to any snapped point within the radius (node distances + partial edge).
- `padyakArea(graph, point)` → area index or null (section C rule).

Tests (TDD): a one-way street is used only forward by tricycle and both ways on foot; a restricted way is avoided at 14:00 and used at 22:00 and 04:59, avoided at 05:00; an exempt crossing is usable at noon; padyak never uses a banned edge; v1 payload decodes and routes walk only; A* equals Dijkstra on random pairs per mode (`fast-check`); `boundedDistances` equals `routeStreet` lengths within 1 m; budget on real data ≤ 800 KB raw and ≤ 260 KB gzip; same input → byte-identical payload.

### Task 4: Migration 0010 and importer (notes, sources, graph v2)

Files: `db/migrations/0010_route_notes_graph_v2.sql`, `scripts/lib/modes-plan.ts`, `scripts/lib/modes-writer.ts`, `scripts/lib/lines-plan.ts` (build v2 with rules and areas), `scripts/lib/lines-writer.ts`, `scripts/import-naga.ts` (dry-run rows of section "Importer changes"), `src/server/repos/network-repo.ts` (`routes[].notes` in `getSnapshot` and route detail), `src/domain/api/schemas.ts` (snapshot `notes`, default `[]`), `tests/integration/import-route-notes.test.ts`, `tests/integration/import-geometry.test.ts` (v2 graph), `tests/unit/api-schemas.test.ts`.

- Migration exactly as "New migration".
- Abort when a road-rule way id is missing, the graph is over budget, or a note's route is not a member. Report and continue for padyak areas without a place node (already excluded in Task 2).
- Published via `carryForwardRevision` as `anywhere-alight-{date}`; stop and route ids unchanged; a re-run → `unchanged`.

Tests (integration, throwaway branch): migration applies, `check-rls` passes; publish refuses a note whose route is not a member and a synthetic note; real import → notes in the snapshot, graph `format_version = 2` within budget, `ETag` = sha256; an old revision still serves its v1 graph. Unit: snapshot without `notes` parses to `[]`.

### Task 5: Path-ride builder (pure)

Files: `src/domain/planner/paths.ts` (new: decode Lines once, samples, `approaches`, `ridesOnVariant`, `transferPoints`, `nameFreePoint`), `src/domain/planner/graph.ts` (reduced to the network builder `buildPlanningNetwork(snapshot, lines)`; stop-based ride code deleted), `tests/unit/planner-paths.test.ts`, `tests/fixtures/real-lines.ts` (loads the committed real Lines fixture).

- Exactly section A (tolerances 500/200/300 m, 25 m sampling, circuit rule, approach runs, best pair per variant, transfer runs, naming).
- `buildPlanningNetwork` is memoized by revision id by its callers (server cache, offline module cache), not internally.

Tests (TDD, `fast-check`): a line never yields alight < board; a circuit ride is in [200, pathLength); an out-and-back path near both ends yields two approaches; a point 600 m off every path yields none; ride distance ≥ straight-line board→alight; transfer between two variants sharing a street is 0 m; the real Lines give at least one approach to San Isidro (R1), Panicuason (R7), Del Rosario via Panganiban/Roxas/Magsaysay (R4/R3/R2), Pacol (R6), San Felipe (R5), Balatas Rd (R1), Cararayan (R1), and J. Miranda Ave (R8-A/B); deterministic output order.

### Task 6: Planner rework (rules, graph distances, options) and regression rebaseline

Files: `src/domain/planner/plan.ts`, `src/domain/planner/labels.ts`, `src/domain/planner/fares.ts` (tricycle minimum F03, padyak flat F04 from `snapshot.fareRules`), `src/domain/planner/notes.ts` (route note selection by `near`, flagged-path note), `tests/unit/planner-plan.test.ts`, `tests/unit/planner-real-loops.test.ts` (rebaseline), `tests/unit/planner-fares.test.ts`, `tests/unit/planner-rules.test.ts`.

- Signature and behaviour exactly sections A, B, C (tricycle and padyak via `routeStreet`), D (ids, legs, fares, `jeepneyReason`).
- Delete: `savesWalking` estimate-only variant (replaced by graph-length comparison with ×1.3 fallback), `WALK_ESTIMATE_FACTOR` use outside fallback, stop-based option ids for new plans.

Tests (TDD): 450 m apart → walk first and Recommended, tricycle after, unlabelled; 520 m → no walk card, tricycle Recommended and after jeepney options; no jeepney near → only tricycle (and padyak if in area), `jeepneyReason` set; a jeepney option that walks more than the direct walk is dropped; padyak only when both ends in one area and path ≤ 2,000 m; tricycle at 22:00 may use Roxas Ave and says so, at 10:00 avoids it; graph null → ×1.3 walks labelled, tricycle without distance, no padyak; property: every option ≤ 6, order walk → jeepney → tricycle → padyak, ids unique, walk legs within caps. **Rebaseline:** `REGRESSION_BASELINE` recomputed on real Lines + real street graph with a fixed `now` (10:00 Manila); the commit message lists counts per mode and the share of former Loop A/B variant sequences that remain.

### Task 7: Plan API schema, server and offline wiring

Files: `src/domain/api/plan.ts`, `src/app/api/v1/plan/route.ts`, `src/server/repos/network-cache.ts` (new, `server-only`: per-revision decoded Lines + street graph + planning network, max 2), `src/client/trip/plan-offline.ts` (uses cached Lines and graph via `use-lines`/`use-walk-graph` loaders; low-data mode still fetches Lines once when planning), `src/client/network/use-walk-graph.ts` (v2), `tests/unit/api-plan-schema.test.ts`, `tests/unit/api-handlers.test.ts`, `tests/unit/offline-planning.test.tsx`, `tests/unit/client-bundle-imports.test.ts`.

- Schema per section D with defaults; `buildPlanResponse` gathers stop ids from `board/alight.stopId` and named pins, variants from Lines (routeCode, name, `isCircular` per section A).
- Server: snapshot + network from cache; `now = new Date()`.

Tests: a format-1 response body (fixture from master) parses; a new body with tricycle/padyak legs parses; refinements (measures consistency, fare shapes) reject bad bodies; handler never logs points; offline planner yields the same options as the server for the same inputs and `now`; the client bundle stays free of `src/server`.

### Task 8: Compatibility, deletions and caching

Files: `src/domain/saved/saved.ts` (`RECORD_FORMAT = 2`, migration 1→2, `sameRides` with measures), `src/domain/guidance/session.ts` (format bump), `src/domain/trip/enrich.ts` (only routes legacy walk legs that have no `path`; D14 re-check, `relabelOptions`, `savesWalkingD14` deleted), `src/domain/trip/tricycle-hint.ts` (reduced to `nearestTricycleTerminal` used by the option detail), `src/ui/trip/tricycle-hint.tsx` (deleted), `src/ui/home/home-screen.tsx` (hint wiring removed), `src/domain/pwa/sw-routes.ts` (no change in patterns; confirm cache key per revision), `tests/unit/saved-domain.test.ts`, `tests/unit/guidance-session.test.ts`, `tests/unit/trip-enrich.test.ts`, `tests/unit/tricycle-hint.test.ts`.

Tests: a format-1 saved record migrates and reopens; a format-2 record decoded by the format-1 decoder (copied as a fixture from master) returns `newer_format`; an old guidance session is discarded without a crash; enrich routes a legacy walk leg and leaves graph-based legs untouched; no import of the deleted hint remains (`check:boundaries`).

### Task 9: Guidance, time estimates, share text, service window (pure)

Files: `src/domain/guidance/steps.ts` (tricycle/padyak steps; no-ride options; free board/alight), `src/domain/guidance/progress.ts` (ride progress by projecting the GPS fix on the Lines path: remaining = alightM − currentM, wrap on circuits; "get ready" at 300 m), `src/domain/guidance/view.ts`, `src/domain/guidance/announce.ts`, `src/domain/saved/trip-text.ts`, `src/domain/eta/eta.ts` (tricycle/padyak partial), `src/domain/eta/service-window.ts` (new), `src/domain/eta/basis.ts`, `tests/unit/guidance-steps.test.ts`, `tests/unit/guidance-progress.test.ts`, `tests/unit/guidance-view.test.ts`, `tests/unit/eta.test.ts`, `tests/unit/service-window.test.ts`, `tests/unit/guidance-fixtures.ts`.

- Copy: "Get off near {place} · tell the driver 'para' · stop not marked"; "About {m} m of riding left (approximate)"; tricycle step "Take a tricycle to {destination} · about {km} km along streets · minimum fare ₱15 · confirm with the driver"; padyak step similar with ₱10.
- Service window exactly section E, using the device clock in Manila time.

Tests (TDD): a tricycle-only option builds one step and never throws; progress on a circuit across the path start counts correctly; GPS 120 m off the path → "off route" not progress; service window at 04:30, 05:00, 20:30, 21:30 Manila; FORBIDDEN honesty property passes for every new string; no minutes for tricycle/padyak legs.

### Task 10: UI for the new plan

Files: `src/ui/trip/trip-options.tsx`, `src/ui/trip/trip-detail.tsx`, `src/ui/trip/trip-parts.tsx` (mode headline, leg strip icons for tricycle/padyak), `src/ui/trip/route-note.tsx` (new, one line + evidence chip), `src/ui/trip/service-window-note.tsx` (new), `src/ui/map/trip-lines-layer.tsx` (tricycle/padyak paths, free-point markers, ride slice by measures for path-only variants), `src/ui/map/map-legend.tsx` (Padyak entry), `src/domain/modes/palette.ts` (padyak dash token; reuses tricycle colour), `src/ui/routes/route-detail.tsx` (notes), `tests/unit/trip-options.test.tsx`, `tests/unit/trip-detail.test.tsx`, `tests/unit/trip-lines.test.ts`, `tests/e2e/trip.spec.ts`, `tests/e2e/map-lines.spec.ts`.

- Exactly "UI changes"; colour never the only cue (icon + text + dash); targets ≥ 44 px; the tricycle restriction line and national-road note are text, not icons.

Tests: option order and labels per Task 6 fixtures; the tricycle card shows "Minimum fare ₱15" and "Time not estimated" and no minutes; a C/D ride to City Hall shows the J. Miranda note; outside-hours warning shows at a fixed 22:00 clock and the option stays; e2e: R7 Panicuason trip, R4 Del Rosario trip, padyak trip in Sabang, tricycle-only trip; axe light and dark on options, detail and the map with a padyak leg.

### Task 11: Help, docs, ledger

Files: `src/ui/help/articles.ts`, `docs/spec/03-architecture.md` (§3.6 path-based planner, graph distances on both sides, §3.4 network cache, §3.11 graph v2), `docs/spec/04-data-model.md` (`route_note`, graph v2 format, source families RT/RL/RP/RH), `docs/spec/06-screens.md` (§6.5 copy for free points, tricycle, padyak, service window), `docs/spec/02-features.md` (F-B1 options), `data/source/research/README.md`, `docs/setup.md` (rollout and rollback of section F), `.superpowers/sdd/progress.md`, `.superpowers/sdd/backlog.md`.

- Copy is exactly the strings in this plan; Help "Vehicle types in Naga" adds: padyak (fare, 2 passengers, area rule, banned streets); tricycle restrictions with T01/T02 and "check for updates"; "E-trike national-road rules reported in news (Dec 2025) are not applied; unverified"; "Special VISTODA units may not enter Tecla San Andres–Ziga Rd (Ord 2025-067)"; service window with "Sunday and holiday service not confirmed".

Tests: `help-screens.test.tsx` renders the new sections; the copy audit grep (Task 13) passes.

### Task 12: E2E fixtures and mechanical spec updates

Files: `tests/e2e/fixtures/network/snapshot.json` (notes), `walk-graph.json` (v2 Centro extract with flags, rules, places, flagged synthetic in a header), `tests/e2e/fixtures/plan-responses.ts` (regenerated with the Task 6 planner), fixture builder scripts under `scripts/` (existing), `tests/e2e/trip.spec.ts`, `tests/e2e/guidance.spec.ts`, `tests/e2e/saved.spec.ts`, `tests/e2e/offline.spec.ts`, `tests/e2e/terminals.spec.ts` (hint card expectations removed).

- Regenerate, then update texts that changed mechanically (600 → 500 walk threshold, hint card → tricycle option text, option counts). Run only the affected specs.

### Task 13: Verification, reviews and rollout

- `pnpm verify`, `pnpm test:integration` (throwaway branch), full `pnpm test:e2e` in CI.
- Reviewers: `ecc:database-reviewer` (0010, publish diff), `ecc:typescript-reviewer` (planner, schema, compat), `ecc:react-reviewer`, `ecc:security-reviewer` (network cache memory bounds, no points in logs, payload limits), `ecc:a11y-architect` (padyak dash cue, new copy, focus).
- Copy audit grep on the built UI: "arriv", "ETA", "exact", "guaranteed", "official", minutes without "Estimate"/"≈"/"About"; justify every hit.
- Owner and controller steps: section F 2–6. Smoke plans on production (record option list and notes): Centro → Panicuason (R7); Centro → Del Rosario boundary (R2/R3/R4 options); Magsaysay Ave → San Isidro via Balatas (R1); Plaza Rizal → Pacol (R6); Gen. Luna → City Hall (loops; J. Miranda note); a 400 m trip (walk recommended); Abella → Sabang interior (padyak).
- Update `.superpowers/sdd/progress.md`; reviewer Minors to the backlog.

## Task order and sizing

Each task is sized for one implementer and one reviewer. Tiers come from Jev (`jev_classify`, options haiku/sonnet/opus). Jev is followed at certainty ≥ 0.8; below that the tier is decided here and flagged.

| # | Task | Jev pick (prob / certainty) | Tier used |
|---|---|---|---|
| 1 | Research sources into the reviewed seed (transcription) | haiku (0.89 / 0.83, act) | **haiku** |
| 2 | Road rules, padyak areas and route notes in the seed | opus (0.84 / 0.76, review) | **opus** (decided: legal-segment clipping is judgement with safety impact) |
| 3 | Street graph v2 and on-device routing | opus (0.98 / 0.97, act) | **opus** |
| 4 | Migration 0010 and importer | sonnet (0.82 / 0.73 review for the migration; 0.83 / 0.74 review for the import) | **sonnet** (decided: follows the 0006/0007 patterns) |
| 5 | Path-ride builder | opus (0.99 / 0.98, act) | **opus** |
| 6 | Planner rework and rebaseline | opus (0.94 / 0.91, act) | **opus** |
| 7 | Plan API schema, server and offline wiring | opus (0.63 / 0.45, abstain) | **sonnet** (decided: specified field by field; TypeScript reviewer covers refinements) |
| 8 | Compatibility, deletions and caching | opus (0.77 / 0.66, review) | **sonnet** (decided: mechanical once the formats are fixed; rollback test is explicit) |
| 9 | Guidance, time estimates, share text, service window | opus (0.75 / 0.62, review) | **opus** (decided: GPS-on-path progress and the no-ride crash are subtle) |
| 10 | UI for the new plan | sonnet (0.73 / 0.59, review) | **sonnet** |
| 11 | Help, docs, ledger | haiku (0.94 / 0.91, act) | **haiku** |
| 12 | E2E fixtures and mechanical spec updates | haiku (0.82 / 0.73, review) | **sonnet** (decided: plan fixtures depend on planner output; below the Haiku bar) |
| 13 | Verification, reviews and rollout | sonnet (0.50 / 0.25, abstain) | **sonnet** |

**Dependencies:** 1 → 2 → 3 → 4; 3 → 5 → 6 → 7 → 8; (6, 7) → 9 → 10; 4 → 12 (fixtures need the v2 graph and notes) and 6 → 12; 11 after 10; 13 last.

**Parallel tracks:** Task 1 and Task 5 start together (Task 5 needs only the committed Lines fixture). Task 3 can start on fixture rules while Task 2's owner review runs. Tasks 9 and 10 overlap once Task 7's schema is merged. Task 11 drafting can start after Task 6.

**Owner steps:** review the road-rule clip previews (Task 2); Neon backup, migration, import and smoke plans (Task 13).

1. Research sources into the reviewed seed (transcription)
2. Road rules, padyak areas and route notes in the seed
3. Street graph v2 and on-device routing
4. Migration 0010 and importer
5. Path-ride builder
6. Planner rework and rebaseline
7. Plan API schema, server and offline wiring
8. Compatibility, deletions and caching
9. Guidance, time estimates, share text, service window
10. UI for the new plan
11. Help, docs, ledger
12. E2E fixtures and mechanical spec updates
13. Verification, reviews and rollout

## Out of scope here

- Request reroutes as geometry (owner report only; notes instead).
- Trial loop variants in planning; VISTODA special-unit routing; e-trike rules in routing.
- Tricycle or padyak times, fares beyond the minimum/flat rate, waiting times, headways, route-specific service hours.
- Barangay polygons, a CBD boundary, a tricycle zone map.
- Street names on free points (the graph carries none; a later increment may add a names table to the payload).

## Open questions for the user

None block Task 1. Defaults are stated above; these change behaviour only if you answer differently.

1. **Calls decided below Jev's bar** (E-J4 night rule from the planner's clock, E-J5 padyak areas as nearest place node + 1,000 m, E-J6 same plan endpoint with format bumps, E-J7 route notes in the database and the service window as a constant, and the tiers for Tasks 2, 4, 7, 8, 9, 12, 13). Keep them?
2. **Tricycle "Recommended" over a direct jeepney.** Per your rule, at 500 m and above the tricycle card carries "Recommended" even when a one-ride jeepney exists, and it is listed after the jeepney cards. Keep exactly that, or recommend the tricycle only when no jeepney option exists?
3. **Local confirmations (not blocking; each changes one note).** Which BFP station riders mean (default: J. Miranda/Mayflower); whether Loops C/D enter J. Miranda Ave today (default: ordinance path plus "ask the driver"); whether "Francia" is R2's signboard (default: R2 note "unconfirmed"); which padyak associations still run (default: documented areas labelled with their ordinance year).
