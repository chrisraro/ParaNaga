# Plan: all research data in Neon + provisional loop planner (increment 1B + 3P)

Status (2026-10-22): finished (data import and the Loop A/B provisional planner are on master; later planner work is in the E, F and planner-revision plans).

Date: 2026-10-15 · Branch: `feat/data-and-planner` (from master `9c61839`)
Spec: `docs/spec/04-data-model.md` (§4.3 ingest, §4.4 transit, §4.6 states, §4.7 import), `03-architecture.md` (§3.5 RLS, §3.6 planner, §3.7 fares), `02-features.md` (F-A5 stops, F-A6 routes, F-B1/F-B2 trip options/detail).
Design artboards (exact layout/copy/tokens): `.superpowers/sdd/design/` — `TripOptions`, `TripDetail`, `StopDetail`, `RouteDetail`, `Home`, `Components`, `Foundations` (`.dc.html`; read the markup + the `t` token objects). Map design brief: `.superpowers/sdd/map-design-brief.md`.

Goal: **every file in `Data_Sets/` imported into Neon** (idempotent, with provenance and conflicts), surfaced in the app (stop pins on the map, stop and route detail), and a **provisional trip planner** on Loops A and B that returns honest, badged trip options.

## User decisions that bind this increment

- **Provisional routing (user, 2026-10-15):** the planner may use unverified stop pins. Every trip result is badged **"Unverified route — confirm with the driver"**, shows **no exact fares**, and **draws no street path** on the map.
- **Loops A and B only (Jev, p=1.0):** order R8-A pins by code A1…A30 and R8-B pins by code B1…B31 (both form plausible ~7 km closed loops, longest gap ≈450 m). **Loops C and D are not sequenced** (their layers reuse A/B codes; any order would be invented): their pins are imported and shown as candidates, but no `route_stop` rows and no planning until a reviewer enters an order.
- **Walking (controller decision; Jev returned "review"):** access/egress walks ≤ **600 m** straight-line, transfers ≤ **400 m**; walk distance shown as an **estimate = straight-line × 1.3**, labelled **"path not verified"**, never drawn.

## Global Constraints

- **Stack and rules from the maps-core plan still apply:** Next.js 16.4 (read `node_modules/next/dist/docs/` before Next-specific code), React 19, strict TS, Tailwind v4 tokens, React-Leaflet, `src/domain/**` pure, `src/client`/`src/ui` never import `src/server`, every server module imports `server-only`, all DB access through `withRequestContext` (`src/server/db/context.ts`), Zod-validated inputs, no secrets printed or committed. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Database:** hand-written SQL migrations in `db/migrations/` (next is `0001_…`), applied with `pnpm db:migrate` (owner, `DATABASE_URL_UNPOOLED` from `.env.local`). Every new table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, explicit grants, explicit policies per role; `pnpm db:check-rls` must pass. PostGIS objects are schema-qualified (`extensions.…`). `gen_random_uuid()` is `pg_catalog.gen_random_uuid()`. Public transit data is readable by `paranaga_app`; writes only by `paranaga_import` (import) and `paranaga_definer` (publish). Never test against Neon `main`: integration tests run on a **throwaway branch** (see the existing pattern in the maps-core scratchpad script: create branch → set role password → run → delete).
- **Neon project:** `green-field-06467324` (Singapore), database `neondb`, owner `neondb_owner`, branch `main` (`br-polished-meadow-a14s3ypl`). The Neon CLI (`npx --yes neonctl@8.4.4`) is signed in to the right account; the Neon MCP is not (different account) — don't use it.
- **Provenance:** keep raw values verbatim (labels, codes, descriptions, coordinates at source precision), source ids S01–S42, retrieved dates, and the My Maps metadata (owner display name "Tan Gumba", `owner_identity_verified=false`; never attribute authorship to anyone else or imply city endorsement).
- **Honesty:** `NULL` = unknown, never zero. Candidates are badged **"Mapped candidate"** and are never presented as verified. Fares: the planner shows **"Estimate ₱14–₱17 · reported minimum, matrix not verified"** (superseded wording: the UI now says "from reported fare rules · matrix not verified", with distance-scaled ranges) per ride leg (F01 traditional ₱14 / F02 modern ₱17 minimum — vehicle class unknown), totals marked partial/estimate, never "Exact". The EASTTODA ₱13 observation stays a traceable conflict against F03, never applied.
- **Design:** follow the artboards' structure, copy style, tokens and dark mode; where an artboard shows data we don't have (signboard text, minutes, arrival time, curb side, photos), show the honest unknown state instead ("Signboard not yet verified", "Time not available", "Not yet surveyed", "Photo pending") — never placeholders like `[min]`.
- **Performance:** the 128 pins render as one Leaflet layer (canvas/circle markers or a single GeoJSON layer), not 128 DOM markers; public read endpoints send cache headers.
- **Tests:** Vitest (unit; integration against a throwaway Neon branch, skipped when `TEST_*_DATABASE_URL` absent), Playwright e2e for UI flows (tiles aborted). `pnpm verify` and `pnpm test:e2e` stay green.

---

### Task 1: Database schema for research data and the transit network

Files: `db/migrations/0001_transit_and_ingest.sql`, `src/server/db/schema.ts` (Drizzle mirrors of tables the app reads), `tests/integration/transit-schema.test.ts`.

Create (columns per `docs/spec/04-data-model.md`, trimmed to what this data needs; add `is_synthetic boolean not null default false` to every transit table):
- `ingest`: `source` (code S01–S42 PK, title, url, evidence_type, published_or_enacted text, checked_on date), `source_document` (file name, sha256, bytes, retrieved_on), `batch` (snapshot_version, mode, status, counts jsonb, started_by, timestamps; unique committed snapshot), `raw_feature` (batch_id, source_identity, identity_method, source_layer, source_code_raw, label_raw, description_raw, lon, lat numeric(11,8), properties jsonb, content_hash; unique (batch_id, source_identity)), `raw_feature_lineage` (source_identity PK → stop_point_id), `change`, `conflict` (unique (batch_id, kind, refs)), `error`.
- `transit`: `revision` (+ `seq`, `status`, `kind` text check in ('provisional','verified')), `revision_member`, `published_pointer` (singleton), `route` (public_code R1…R8-D, official_group_number, name, mode_code, legal_status, allocated_units, allocation_is_active_fleet_count false, notes), `route_alias`, `variant` (route_id, direction, kind permanent/trial), `variant_version` (headsign null, vehicle_class text, legal_streets jsonb (inbound/outbound/circuit arrays), trial_status, operating_status, `evidence_level` check in ('documentary','provisional','verified'), is_circular, source_codes text[]), `stop_point` (stable id, name), `stop_point_version` (geog geography(Point,4326), status 'candidate', source_layer, source_code_raw, label_raw, curb_side null, boarding/alighting null, navigation_approved false), `stop_point_source`, `route_stop` (variant_version_id, stop_point_version_id, seq, `evidence_level`, unique (variant_version_id, seq)), `terminal` (name, location_text, modes text[], evidence_status, notes, geog null), `fare_rule` + `fare_rule_version` (centavos ints, base_km, increment centavos/km, discount_percent, discount_groups, effective_from date null, status 'draft', publish_exact false, sources), `fare_observation`, `fare_conflict`, `barangay` (name, survey_status), `coverage_audit` (barangay, dimensions jsonb), `feeder_lead`, `provider_presence` (ride-hailing: name, city_presence, products, quote null, sources), `rail_status` (key, value text, sources), `designated_stop_candidate` (raw fields incl. label_raw, label_type, route, direction, source_ids, source_context, operating_status), `external_destination_category`, `dataset_note` (key/value jsonb for public_stop_map, stop_inventory_gaps, designated_stop_program, dataset_version, coverage_claim).
- Indexes: GiST on geog; trigram index on stop/route names later (not now).
- Function `transit.publish_revision(p_revision uuid)` — `SECURITY DEFINER`, owner `paranaga_definer`, pinned `search_path … pg_temp`, `EXECUTE` revoked from PUBLIC, granted to `paranaga_import`: locks `published_pointer`, validates (no synthetic members; every provisional `route_stop` variant is `evidence_level` 'provisional'; seq contiguous from 1), marks old published `superseded`, target `published`, updates pointer, writes `core.audit_event`.
- Roles/grants: `paranaga_import` gets insert/update/select on `ingest.*` and draft-revision writes on `transit.*` (policies `TO paranaga_import`); migration grants `paranaga_import` to the migrating role (like `paranaga_definer`) so scripts can `SET ROLE`. `paranaga_app`: select-only on public transit/ingest-provenance tables with `using (true)` policies (this data is public); no app writes.
- `pnpm db:check-rls` must pass with all new tables.

Tests: integration on a throwaway branch — migration applies cleanly on top of 0000; `check-rls` passes; `paranaga_app` can read `transit.route` but cannot insert; `paranaga_import` can insert into `ingest.raw_feature`; `publish_revision` refuses a revision containing a synthetic member and publishes a valid one (pointer updated, audit row written).

### Task 2: Import parsing and normalization (pure)

Files: `src/domain/import/kml.ts`, `src/domain/import/mapped-stops.ts`, `src/domain/import/seed.ts`, `src/domain/import/conflicts.ts`, `src/domain/import/provisional-loops.ts`, `tests/unit/import-*.test.ts`.

Pure functions (no fs, no DB; inputs are strings/objects):
- Parse `naga_mapped_stops_source.kml` (Placemarks with folder = layer, name = code, description, Point coords lng,lat). Parse `naga_mapped_stops.geojson` and `naga_mapped_stops.csv`.
- `crossCheck(kml, geojson, csv)`: same 128 records per (layer, code, label) with coordinates equal to 1e-7; layer counts exactly A 30 / B 31 / C 34 / D 33; returns errors list (empty on this snapshot).
- `sourceIdentity(record)`: identity method 2 from the spec — sha256 hex of `map_id|layer|code|normalized label` (normalize = NFC, trim, collapse spaces, lower-case); `identityMethod: "layer_code_label"`; assert uniqueness within the snapshot.
- `detectConflicts(records)`: `code_prefix_mismatch` (26 C-layer records with A codes, 27 D-layer records with B codes), `exact_coordinate_shared` (records grouped by identical coordinates — 128 records on 114 coordinate pairs), `near_duplicate` (cross-layer pairs within 15 m with similar labels). Refs sorted for stable uniqueness.
- `normalizeSeed(seedJson)`: maps every seed collection to typed rows — sources (42), routes (11, legal street lists kept verbatim), trial changes (2), fare rules (F01–F04 → rules in **centavos**; F05 → fare observation + conflict against F03), terminals (6, no coordinates), external destination categories (5), feeder candidates (5), ride-hailing (3), barangays (27, `not_surveyed`), rail status, designated-stop candidates (32), designated_stop_program, public_stop_map, stop_inventory_gaps, dataset_version, coverage_claim. Also parse `designated_stop_candidates.csv` and cross-check with the seed's 32 candidates.
- `provisionalLoopSequence(records, routeId)`: for `R8-A` and `R8-B` only — records of that layer sorted by numeric code (A1…A30 / B1…B31), asserts the codes are complete and contiguous from 1 and all share the layer's own prefix; returns `{ seq, recordIdentity }[]`. For `R8-C`/`R8-D` returns `null` (not sequenced, by decision).
- `field_survey_template.csv`: `parseSurveyTemplate(csv)` returns the 45 header columns (used later as the survey import format); store the header list in `dataset_note`.

Tests (TDD): all counts above; identities unique and stable across runs (same input → same hashes); conflict counts (26 + 27 prefix mismatches, 114 coordinate groups); fare centavos (F01 base 1400, +200/km after 4 km; F02 1700, +240/km; F03 1500, 20 % discount; F04 1000/800); F05 → observation 1300 student + conflict; A/B sequences length 30/31 and closed-loop path ≤ 8 km with max gap ≤ 600 m (sanity check computed with `haversineMeters`); C/D → null.

### Task 3: Import script and first provisional revision

Files: `scripts/import-naga.ts`, `src/server/import/writer.ts` (server-only DB writer; may live under `scripts/lib/` instead if it never runs in the app), `tests/integration/import-naga.test.ts`, `package.json` script `db:import` (`tsx --env-file-if-exists=.env.local scripts/import-naga.ts`).

- `pnpm db:import --dry-run | --commit`: reads every `Data_Sets/` file, hashes them (`ingest.source_document`), runs Task 2 parsing/cross-checks (abort on any error), and in **one transaction** under `pg_advisory_xact_lock(hashtext(snapshot_version))` as `SET ROLE paranaga_import`:
  - upserts sources, raw features (+ lineage), conflicts, changes vs the previous committed batch;
  - creates one `stop_point` + `stop_point_version` (status `candidate`) per raw feature, linked via `stop_point_source` (no de-duplication);
  - upserts routes, aliases (legacy names/colours marked historical), variants + versions (all `documentary`; R8-A/R8-B also get a `provisional` version with `is_circular=true` and `route_stop` rows from `provisionalLoopSequence`), trial variants (permanence unconfirmed), fare rules/observations/conflict, terminals, feeders, ride-hailing, rail, barangays + coverage audit, destination categories, designated candidates, dataset notes;
  - builds revision `provisional-loops-2026-10-15` (`kind='provisional'`) with all members and publishes it via `transit.publish_revision`.
  - `--dry-run` prints counts and conflicts only; nothing written.
- **Idempotent:** a second `--commit` with the same files inserts nothing new (reports all `unchanged`) and keeps the same published revision.
- Output never prints connection strings.

Tests: integration on a throwaway branch: commit → assert counts (128 raw features; A30/B31/C34/D33; 128 stop points; 11 routes; 61 provisional route_stops (30 + 31); 5 fare rules/observations as specified; 6 terminals; 27 barangays; 32 designated candidates; 42 sources); second commit → no new rows; published pointer → `provisional-loops-2026-10-15`; `paranaga_app` can read the published views. **After review, the controller runs it against Neon `main`.**

### Task 4: Public read API

Files: `src/domain/api/schemas.ts` (Zod response/request schemas shared with the client), `src/server/repos/network-repo.ts`, `src/app/api/v1/network/head/route.ts`, `src/app/api/v1/network/snapshot/[revisionId]/route.ts`, `src/app/api/v1/stops/route.ts` (`?bbox=`), `src/app/api/v1/stops/[id]/route.ts`, `src/app/api/v1/routes/route.ts`, `src/app/api/v1/routes/[code]/route.ts`, tests.

- `network/head` → `{ revisionId, label, kind, publishedAt }` (`s-maxage=30`).
- `network/snapshot/:revisionId` → stops (id, name, lat, lng, status, source layer/code), provisional variants with ordered stop ids + `isCircular` + route code/name, fare rules (estimate data), revision meta. `public, s-maxage=31536000, immutable`. 404 for unknown revision.
- `stops?bbox=w,s,e,n` (validated, within max bounds) → candidate pins with status and source info (`s-maxage=300`); `stops/:id` → full stop detail: raw source record (layer, code, label, coordinates), other layers sharing the exact coordinate, provisional routes serving it (only via `route_stop`), and "passing nearby" routes (documentary routes are not stops — return none for now; leave the field empty).
- `routes` → list grouped by group number with alias/allocation/evidence badges; `routes/:code` → legal street lists (inbound/outbound/circuit), trial revisions with status, legacy aliases (historical), fare evidence, provisional ordered stops when present, sources.
- All handlers: Zod-validated params, `withRequestContext` as guest, typed error envelope `{ error: { code, message, requestId } }`, no coordinates from users logged.

Tests: unit for schemas/param parsing; integration against a throwaway branch with the import applied (Task 3 helper) for each endpoint's shape and key values (e.g. stop with code A1 = Plaza Rizal at 13.6233869, 123.1846726; R3 has two separate structures; R8-A has 30 ordered stops).

### Task 5: Provisional planner (pure)

Files: `src/domain/planner/graph.ts`, `src/domain/planner/plan.ts`, `src/domain/planner/fares.ts`, `tests/unit/planner-*.test.ts`.

- Input: the snapshot (Task 4 schema), origin and destination `LatLng` (inside Naga), options `{ maxAccessWalkM: 600, maxTransferWalkM: 400, maxRides: 2 }`.
- Graph: per provisional variant, ride edges between consecutive stops (circular: last → first), each with straight-line meters; boarding allowed at any stop of the variant (unknown permissions → allowed, flagged); transfers between stops of different variants ≤ 400 m straight-line.
- Access/egress: stops within 600 m straight-line; walk estimate = straight-line × 1.3, `pathVerified: false`.
- Search: round-based (≤2 rides). A ride on a circular loop goes forward only (loop direction), never more than one full circuit; ~~reject options whose ride is longer than walking the whole way directly~~ (superseded by the user decision of 2026-10-15: a ride must save walking, up to one circuit); de-duplicate by variant sequence; Pareto on (rides, walkMeters, rideMeters); labels **Recommended**, **Fewest transfers**, **Least walking** (no "Cheapest" and no "Fastest" — fares are estimates and times are unknown).
- Fares (`fares.ts`): per ride leg an **estimate range** from F01 (traditional) and F02 (modern) using ride distance = sum of straight-line segments along the loop (`approximate: true`), rounded to whole pesos; trip total = sum of ranges, `completeness: "estimate"`; discount categories not applied (eligibility unverified).
- Output: `{ revisionId, coverage: 'provisional'|'none', options: [{ label, legs: (walk|ride)[], walkMeters, rides, fare: { minCentavos, maxCentavos, status: 'estimate' }, evidence: 'provisional' }] }`. `coverage: 'none'` when nothing within limits.
- Never invents shapes, times, curbs or signboards.

Tests (TDD): fixture snapshot (small synthetic loop under `tests/fixtures/synthetic/`, flagged synthetic) + the real A/B sequences; forward-only loop riding; >1 circuit rejected; walk caps; transfer A↔B; coverage none outside limits; fare ranges exact centavo math (e.g. 3.2 km → ₱14–₱17; 6.0 km → ₱18–₱21.80 → rounded per the rule you document); property test: every option's legs are contiguous (walk → ride → (walk → ride) → walk) and total walk ≤ caps.

### Task 6: Plan API and trip options/detail screens

Files: `src/app/api/v1/plan/route.ts` (POST, Zod: two points inside Naga; loads the published snapshot server-side; runs the planner; `no-store`; never logs coordinates), `src/ui/trip/trip-options.tsx`, `src/ui/trip/trip-detail.tsx`, wiring in `src/ui/home/home-screen.tsx` / `endpoint-sheet.tsx`.

- When both endpoints are set, the home sheet requests a plan. Results replace the old honest card: **Trip options** per the `TripOptions` artboard — each card shows label, the **"Unverified route — confirm with the driver"** badge (warning style, not the teal "Verified route"), leg strip (walk ≈ m → route chip "Loop A"/"Loop B" with direction "clockwise"/"counterclockwise" → walk ≈ m), fare chip **"Estimate ₱X–₱Y"** (gold outline style like "+ 1 unknown"), transfers count; no minutes, no arrival time ("Time not available"); a note "Walking distances are estimates; paths not verified." and "Transport data revision <label>".
- Tapping an option opens **Trip detail** per the `TripDetail` artboard: ordered legs (Walk ≈ m to <stop label> (code) · path not verified → Board Loop A at <stop> · "Signboard not yet verified" · ride N stops → Get off at <stop> (+ "Para!" tip without the buzz promise) → Walk ≈ m to destination); fare breakdown per leg as estimates; "Report a correction" link (disabled placeholder is not allowed — render it only as text "Corrections open soon" until that feature exists). Map shows the boarding/alighting stops highlighted (no line between them).
- `coverage: 'none'` → keep a clear message: "No provisional route nearby yet" + "Loops A and B are the only routes we can suggest for now."
- Loading/error states (offline, 5xx) with retry.

Tests: unit for request validation; e2e (mobile) with a seeded throwaway branch OR a request-interception fixture for `/api/v1/plan` (allowed only in tests): options render with the unverified badge and estimate chip, detail renders legs, no polyline added between stops.

### Task 7: Stop pins on the map and Stop / Route detail screens

Files: `src/ui/map/stops-layer.tsx` (one layer for all pins: hollow amber ring for candidates per `StopDetail`; A/B provisional stops get a small filled centre to distinguish; tap → select), `src/ui/stops/stop-detail.tsx`, `src/ui/routes/route-detail.tsx`, `src/app/app/stops/[id]/page.tsx` and `src/app/app/routes/[code]/page.tsx` (or sheet views inside `/app` — choose what fits the App Router + phone gate; keep them inside `PhoneOnlyGate`).

- Pins fetched from `/api/v1/stops?bbox=` (or the snapshot) for the current view; shown in Explore mode and when picking; never block the map.
- **Stop detail** per artboard: name, **"Mapped candidate"** badge, warning "Not verified for navigation. Source: public My Maps snapshot (15 Oct 2026).", source record (layer · code · coordinates · raw description · "same point also listed in Loop Service X"), routes serving (provisional A/B with direction), "Passing nearby · not confirmed to stop" collapsed (empty for now), curb side / photo "Not yet surveyed" / "Photo pending", and "Help verify this stop" rendered as text "Verification opens soon" (no dead button).
- **Route detail** per artboard for all 11 routes: chip, group, name, evidence chip ("Documented only" or "Provisional stops" for A/B), "Partial data" note, fare tile (estimate range or "Unknown"), service "Not observed", vehicle "Class 2 · plan only", direction toggle where inbound/outbound exist, the legal street order list (circuit for loops), trial revision notice for A/B (Resolution 2025-735, permanence unconfirmed), R3's two structures shown separately, allocation sentence, sources line.
- AC-2: tapping a pin shows exactly the source pin's description, layer and coordinates.

Tests: e2e (mobile, seeded branch or interception fixture): tap pin → stop detail values match the source record for A1 (Plaza Rizal); route detail R8-A shows 30 provisional stops and the trial notice; R3 shows two structures; axe on both screens.

### Task 8: Real import, end-to-end verification and docs

- Controller-run (not a subagent): `pnpm db:import --dry-run` then `--commit` against Neon `main`; verify counts via the API on a preview deployment.
- Docs: update `docs/spec/07-delivery.md` readiness (data imported, provisional planner scope, what blocks verified routing), `docs/setup.md` (`db:import`), README commands.
