# Implementation Plan: IC1 "Leaving Naga" guide

> **AI draft (ecc:planner, opus), 2026-10-28.**
>
> - **Inputs:** design `docs/plans/2026-10-28-intercity-design.md`, with option (a) chosen for every §9 decision; evidence `docs/research/2026-10-28-naga-intercity.md`.
> - **Model tiers:** sonnet by default; opus for Task 1 (SQL re-creates) and the final review.
> - **Database safety:** run every integration test, migration and RLS check only through `bash scripts/with-neon-branch.sh <cmd>`, never against `.env.local` directly.

## Overview

S24 `/app/leaving` lets a user pick a town or hub outside Naga. For that destination it shows:
- the mode and the terminal it leaves from;
- status, departures and fare facts, each with its basis and date;
- a "Get to {terminal}" button that uses the existing in-city planner.

**Unchanged:** the planner, the snapshot, the walk graph and `/plan`.

**Data and publishing:**
- Data comes from a reviewed seed, imported into the open draft.
- Publishing needs step-up and a second reviewer.
- RS06 (Philtranco / Bicol Isarog) is corrected in the same revision.

## Constraints

- **Reuse existing patterns:**
  - version tables plus membership;
  - the seed with review blocks;
  - the import writer;
  - the immutable per-revision endpoint;
  - the service worker's CacheFirst rule;
  - `regionalFareEstimate`.
- **No new dependencies.**
- **Never invent data:** missing evidence stays `null` and shows as "not found".
- **Layer rules:**
  - `src/domain` stays pure.
  - `src/ui` and `src/client` never import `src/server`.
  - `src/server` files import `server-only`.
- **Next.js 16:** read `node_modules/next/dist/docs/` before Tasks 5 and 7. Relevant topics: route handlers, `PageProps`/`RouteContext`, and `useSearchParams` with Suspense.
- **E2E:** locally, run only the specs your change touches.

## Deviations from the design (accepted by the orchestrator, flagged to the owner)

1. **Detail URL is `/app/leaving?to=D-LEGAZPI`, not `/app/leaving/{code}`.** Offline navigation only works for static shells in `SHELL_PATHS`, with `ignoreSearch`. A dynamic path segment would fall back to `/offline`, which breaks AC-IC8.
2. **Fare observations hang off the service version (`regional_service_version_id`).** This keeps them immutable and covered by the version's content hash. Two columns are added: `destination_code` and `amount_high_centavos`.
3. **Departures gain** `trips_per_day`, `start_time` and `end_time`.
4. **New group `sorsogon`** for Bulan.
5. **Deferred:**
   - the F01 `fare_conflict` (4 km vs 1 km), to the jeepney fare update;
   - the A1 count of facts past their review date, to IC2.
6. **Legacy services RS01–RS05 and RS07 stay `community_mapped`.** RS01, RS02, RS03 and RS05 get new versions with `destination_codes`. RS04 and RS07 appear only on terminal detail.

## Task graph

```
T1 migration ─┬─> T4 import ──────────────┐
T2 domain ────┤                           ├─> T8 owner-gated rollout
T3 seed ──────┘   T5 API+SW ─> T7 UI ─────┤
              T1 ─> T6 admin validation ──┘
```

**Order:**
- T1 and T2 run first, in parallel.
- T3 starts after T2.
- T5 and T6 run in parallel, after T1 and T2.
- T4 runs after T1, T2 and T3.
- T7 runs after T5.

**File ownership:** parallel tasks share no files.
- T5 owns `schemas.ts` and `sw-routes.ts`.
- T6 owns `src/domain/admin/*`.
- T7 owns the i18n files.

---

### Task 1: Migration `db/migrations/0029_intercity_ic1.sql` (opus)

1. **Header.** Write a header comment in the style of 0027 and 0028.
2. **`ingest.source`.**
   - Re-create `source_code_check` as the 0010 pattern plus `or code ~ '^IC[0-9]{2}$'`.
   - `evidence_type` has no CHECK, so the new values `booking_site` and `travel_guide` need no DDL. Say so in the header.
3. **`transit.regional_service_version`.** Existing rows must stay valid.
   - **Re-created CHECKs:**
     - `mode in ('uv_express','bus','jeepney','rail','air')`
     - `status in ('community_mapped','operating','operating_limited','suspended','discontinued_reported','unconfirmed')`
   - **OSM rule:** replace `cardinality(osm_relation_ids) > 0` with `rsv_osm_or_no_distance check (cardinality(osm_relation_ids) > 0 or distance_km is null)`.
   - **New columns:**
     - `status_since date`
     - `status_note_code text`, checked against `STATUS_NOTE_CODES`
     - `as_of date`
     - `review_by date`
     - `destination_codes text[] not null default '{}'`
     - `access_note_code text`, checked against `ACCESS_NOTE_CODES`
   - **New CHECKs:**
     - `rsv_dates_required`: `status = 'community_mapped' or (as_of is not null and review_by is not null)`
     - `rsv_review_after_as_of`: `review_by >= as_of`
     - `rsv_status_since`: `status not in ('suspended','discontinued_reported') or status_since is not null`
     - `rsv_not_running_no_fare`: `status not in ('suspended','discontinued_reported') or cardinality(fare_rule_codes) = 0`
     - `rsv_rail_air_no_rules`: `mode not in ('rail','air') or cardinality(fare_rule_codes) = 0`
   - **Code lists:**
     - `STATUS_NOTE_CODES`: `bridge_damage_no_reopening_date`, `stopped_no_resumption_found`, `limited_trips`
     - `ACCESS_NOTE_CODES`: `airport_walk_to_maharlika`
   - `planned_not_funded` is deliberately **not** a service note code (AC-IC3).
4. **`transit.terminal_version`.** Add kind `'airport'` and mode `'air'`.
5. **New tables.**
   - **`transit.regional_destination`:**
     - `id`
     - `code`: unique, `'^D-[A-Z0-9-]{2,30}$'`
     - `is_synthetic`
     - `created_at`
   - **`transit.regional_destination_version`:**
     - `regional_destination_id`
     - `name`
     - `aliases text[]`: at most 10, no nulls
     - `group_code`: one of `partido`, `rinconada`, `albay`, `sorsogon`, `cam_norte`, `nw_camsur`, `manila`, `luzon_air`
     - `psgc_code`: `^[0-9]{10}$`
     - `kind`: one of `town`, `hub`, `airport`, `station`
     - `geog geography(Point) check (geog is null)`
     - `source_codes`
     - `content_hash`
     - `is_synthetic`
     - uniques on `(id, regional_destination_id)` and `(regional_destination_id, content_hash)`
   - **`transit.regional_departure`:**
     - `regional_service_version_id`: foreign key
     - `pattern`: one of `listed_times`, `headway_rule`, `when_full`, `operating_hours`, `daily_unspecified`
     - `times time[] not null default '{}'`
     - `headway_min smallint`
     - `start_time time`
     - `end_time time`
     - `trips_per_day smallint`
     - `day_type`: one of `daily`, `weekdays`, `weekends`, `unspecified`
     - `basis`: one of `official`, `terminal_rule`, `booking_site`, `news`, `at_launch`, `travel_guide`
     - `observed_on date not null`
     - `source_codes`: at least one
     - **CHECKs:**
       - `headway_rule` needs `headway_min`;
       - `listed_times` needs at least one time;
       - `operating_hours` needs both start and end.
6. **`transit.fare_observation`.**
   - `kind` gains `'operator_listing'`.
   - **New columns:**
     - `regional_service_version_id uuid`, a foreign key to the service version
     - `destination_code text`
     - `seat_class_text text`, at most 40 characters
     - `amount_high_centavos integer`
     - `basis text`: one of `official`, `booking_site`, `travel_guide`, `at_launch`
   - **New CHECKs:**
     - `fo_regional_basis`: `(regional_service_version_id is null) = (basis is null)`
     - `fo_regional_month`: `regional_service_version_id is null or observed_at is not null`
     - `fo_high`: `amount_high_centavos >= amount_centavos`, when set
7. **Trigger `transit.regional_child_running_guard()`.**
   - plpgsql with invoker rights and `set search_path = pg_catalog, transit, pg_temp`.
   - Fires `BEFORE INSERT` on `regional_departure`, and on `fare_observation` when it has a regional version.
   - If the parent service is suspended or discontinued, it raises `23514 'suspended or discontinued services carry no fares or departures'` (AC-IC2).
8. **Membership.** Re-create `revision_member_entity_kind_check` as the 0010 list plus `'regional_destination'`.
9. **Grants and RLS** for the 3 new tables, following 0006 lines 249–280:
   - `paranaga_import`: select and insert.
   - `paranaga_app` and `paranaga_definer`: select.
   - RLS enabled and forced, with policies `public_read`, `import_read`, `import_insert` (`not in_released_revision(id)`) and `definer_read`.
   - `revoke execute ... from public` on the guard function.
10. **`transit.publish_revision`.** Copy the 0010 body verbatim, then add:
    - (a) a `regional_destination` branch in the synthetic/missing CASE;
    - (b) a check that every `unnest(rsv.destination_codes)` is a member destination, raising `23514 'unknown destination code'`;
    - (c) a backstop: no departures or observations under a suspended or discontinued member version.
11. **`transit.admin_validation_facts`.**
    - Copy the 0024 body verbatim and add `regional_destination` to the members CASE.
    - Add `regionalServices`:
      ```
      [{code, status, mode, terminalCode, asOf, reviewBy, statusNoteCode,
        destinationCodes, sourceEvidenceTypes, departureCount,
        observationCount, observationsWithoutMonth}]
      ```
    - Add `regionalDestinations`: `[{code, serviceCount}]`.
    - Bracket the re-creates with `grant create on schema transit to paranaga_definer` and a matching revoke.
12. **Views** (`security_invoker`, synthetic rows hidden).
    - Re-create `v_published_regional_services`, appending `status_since`, `status_note_code`, `as_of`, `review_by`, `destination_codes` and `access_note_code`.
    - New views:
      - `v_published_regional_destinations`
      - `v_published_regional_departures`
      - `v_published_regional_observations`
    - `v_published_sources` = the 0010 body, plus source codes from these views and from the `sourceCodes` of `intercity_*` dataset notes.
    - Grant select on all of them to `paranaga_app`.

**Tests first:**
- `tests/unit/intercity-migration.test.ts`, which checks the SQL text in the style of `admin-migration.test.ts`:
  - the `IC` pattern;
  - every new CHECK name;
  - `force row level security` on all 3 tables;
  - the trigger;
  - the `publish_revision` check comments in their original order, plus the new checks;
  - the `regional_destination` CASE in `admin_validation_facts`.
- `tests/integration/intercity-schema.test.ts`. Each of these must fail:
  - a departure under a suspended version (23514);
  - a `review_by` earlier than `as_of`;
  - a booking-site observation without `observed_at`;
  - `planned_not_funded` as a service note;
  - an insert by `paranaga_app` into a new table.

**Verify:**
```
pnpm vitest run --project unit tests/unit/intercity-migration.test.ts tests/unit/migrations-invariants.test.ts
bash scripts/with-neon-branch.sh pnpm db:check-rls
bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/intercity-schema.test.ts tests/integration/admin-revisions-rls.test.ts tests/integration/transit-schema.test.ts
```

- **Depends on:** nothing.
- **Risk:** high. A mistake in the `publish_revision` copy breaks every publish.

---

### Task 2: Pure domain modules

**`src/domain/import/intercity-seed.ts`** (mirrors `modes-seed.ts`):
- **`IntercitySeedSchema`**, strict zod.
  - Header: `{ seedDate, preparedFrom: {file, sha256}[], reviewStatus: 'draft' | 'owner_approved', synthetic? }`.
  - Sections: `sources`, `sourceMap` (R1 → IC01 …), `destinations`, `services` (new RS08 onward, plus RS06 v2), `serviceLinks`, `terminals` (T17), `datasetNotes`, `excluded`.
  - Every record has `review: { decision: 'import' | 'exclude', reason, reviewedOn, reviewer }`.
- **`EXPIRY_DAYS`:**

  | Basis | Days until review |
  |---|---|
  | `official` | 365 |
  | `terminal_rule` | 365 |
  | `news` | 180 |
  | `booking_site` | 120 |
  | `at_launch` | 180 |
  | `travel_guide` | 0 |
  | `undated` | 0 |
  | `suspended` | 30 |

- **Helpers:** `reviewByFor(basis, asOf)`, `parseIntercitySeed`, `importableIntercity`, `excludedIntercity`.
- **`validateIntercitySeed(seed, { terminalCodes, fareRuleCodes })`** returns `string[]`. It reports:
  - a suspended or discontinued service with departures or observations;
  - an operating or limited service with no official or news source;
  - a booking-site observation without a month;
  - a `review_by` later than `reviewByFor(basis, as_of)`;
  - unknown destination, terminal or source codes;
  - a missing reviewer or decision;
  - `planned_not_funded` anywhere outside `datasetNotes`.

**`src/domain/intercity/present.ts`:**
- `sectionOf(status)` returns `running` or `not_running`.
- `sortServices` orders operating, then limited, then unconfirmed, then community_mapped. Ties go by code.
- `isStale(reviewBy, today = manilaDate(new Date()))` reuses `manilaDate` from `../planner/fares`.
- `visibleObservations(obs, svc, today)`:
  - hides booking-site amounts when the service is stale, or when the observation is more than 120 days old;
  - marks travel-guide observations as old;
  - never sums amounts.
- `getToTarget(terminal)` returns `{ point, label }`, or null unless the terminal has a coordinate inside `isInsideNaga`.
- `evidenceChips(types, count)` returns some of `low`, `old`, `single_source`. It never reads `ai_confidence`.
- `fareLineParts`, `departureLineParts` and `statusPillParts` return i18n keys and arguments. None ever says "cheapest".

**Tests first:**
- `tests/unit/intercity-seed.test.ts`:
  - a suspended service with a fare is an error;
  - an operating service with only booking-site sources is an error;
  - every expiry window (for example, 2026-10-28 + 120 days = 2027-02-25);
  - a missing reviewer is an error;
  - `planned_not_funded` on a service is an error;
  - synthetic rows are refused for commit.
- `tests/unit/intercity-present.test.ts`:
  - `isStale` at Manila midnight (UTC 15:59 vs 16:00);
  - booking-site amounts are hidden after `review_by`;
  - travel-guide observations are marked old;
  - `getToTarget` is null for a null coordinate, for Pili (13.58, 123.27) and for T02;
  - suspended and discontinued services land in `not_running`;
  - nothing says "cheapest" and nothing is summed.
- Fixture: `tests/fixtures/intercity/intercity-seed-synthetic.json`.

**Verify:** the unit tests above, then `pnpm check:boundaries`.

- **Depends on:** nothing.
- **Risk:** low.

---

### Task 3: Seed and research copy

**Files:**
- Copy the research file to `data/source/research/naga-intercity-research-2026-10-28.md`. Put its LF-normalised sha256 in `header.preparedFrom`.
- Write `data/source/research/naga-intercity-seed-2026-10-28.json` with:
  - `reviewStatus: "draft"`;
  - `reviewer: "owner"` as a placeholder;
  - `reviewedOn: "2026-10-28"`;
  - the AI-proposed decision and reason on each record.
- Add an "Intercity (IC1)" section to `data/source/research/README.md`.

**Defaults:** `as_of` is 2026-10-28 unless stated, and `review_by` comes from `reviewByFor`. Every value must trace to a line of the research doc.

**Records:**

| Ref | Record | Decision |
|---|---|---|
| sources | IC01–IC35 = R1–R35: title, URL and date copied verbatim.<br>`evidence_type`: official (R4, R13–R16); news; community (R3, R5, R9, R32, R35); booking_site (R25–R27); travel_guide (R29); low_quality (R28) | import |
| destinations | **partido:** D-GOA, D-TIGAON, D-LAGONOY, D-CARAMOAN, D-GARCHITORENA<br>**rinconada:** D-IRIGA, D-NABUA, D-BULA<br>**albay:** D-LEGAZPI, D-TABACO<br>**sorsogon:** D-BULAN<br>**cam_norte:** D-DAET<br>**nw_camsur** (stations): D-PAMPLONA, D-LIBMANAN, D-SIPOCOT, D-LUPI-VIEJO, plus the 11 flag stops<br>**manila** (hubs): D-CUBAO, D-PITX, D-ALABANG<br>**luzon_air:** D-CLARK<br>`psgc_code` stays null unless the owner supplies it | import |
| T17 | Naga Airport (WNP). Kind airport, modes [air].<br>`location_text`: "Maharlika Hwy, San Jose, Pili". **No coordinate.**<br>Sources IC30–IC32 | import |
| RS08 | PNR Naga–Lupi Viejo: rail, T06, `operating_limited`, note `limited_trips`.<br>Departure: `daily_unspecified`, `trips_per_day` 3, `times` [04:29], basis `at_launch`, observed 2025-11-05.<br>Observations (at_launch, official_matrix, 2025-11): ₱15–₱75 regular; ₱12–₱60 senior/PWD.<br>Basis news, `review_by` 2027-04-26. Sources IC01–IC05, IC10 | import |
| RS09 | PNR Naga–Legazpi: rail, T06 → D-LEGAZPI, D-IRIGA.<br>`suspended` since 2025-11-10, note `bridge_damage_no_reopening_date`, `review_by` 2026-11-27.<br>No fare, no departures. Sources IC06, IC08–IC10, IC35 | import |
| X-RAIL-FARES-2025 | Naga–Legazpi ₱15–₱155 (2025) | exclude: suspended service; old fares |
| RS10–RS12 | BCS buses by ordinance category: T01, `operating`.<br>RS10 → Legazpi, headway 15.<br>RS11 → Iriga, Nabua, Bula, headway 12.<br>RS12 → Goa, Tigaon, Lagonoy, headway 12.<br>All: basis `terminal_rule`, observed 2024-04-23, source IC13, `review_by` 2027-10-28, fare rules F06–F12 | import |
| RS13–RS15 | BCS buses to Caramoan, Garchitorena and Bulan. `operating`, no departure row. Source IC13 | import |
| RS16 | DLTB: T01 → Cubao, PITX, `unconfirmed`.<br>Observations (booking_site, Cubao, 2026-09): ₱1,112 Regular; ₱1,230 Seater 41.<br>Departures: `listed_times` [20:00, 20:45], booking_site.<br>Source IC25. `review_by` 2027-02-25 | import |
| RS17 | Peñafrancia Tours: T01 → Cubao, Alabang, PITX, `unconfirmed`.<br>Observations (Cubao, 2026-09): ₱1,000 Regular/Skybus; ₱1,380 Elite.<br>Departures: `operating_hours` 08:00–22:00, `trips_per_day` 12.<br>Source IC26 | import |
| RS18–RS20 | Isarog Line; Raymond (IC27, IC24); Legaspi St Jude. All `unconfirmed`, with no amounts and no times | import |
| X-BOOKING-2025 | IC27 fares that give a year but no month | exclude: a booking-site fare needs a month |
| X-ALPS | ALPS (IC28) | exclude: not confirmed; low-quality source |
| X-BUS-NOT-FOUND | Bicol Isarog, RSL, Elavil, Cagsawa, Amihan, Superlines | exclude: no Naga departures found |
| RS06 v2 | PITX–Naga, operators ["Philtranco"] (**Bicol Isarog removed**).<br>`discontinued_reported` since 2026-03-30, note `stopped_no_resumption_found`, `fare_rule_codes` [].<br>OSM ids and distance copied from the published version. Add source IC23. `review_by` 2027-04-26 | import |
| RS21 | Eastbound vans: T02 (address text only) → Legazpi, Tabaco. uv_express, `unconfirmed`.<br>Observations (travel_guide, 2023-10): Legazpi ₱140; Tabaco ₱180.<br>Hours 05:00–18:00, travel_guide. Source IC29. `review_by` = `as_of` | import |
| RS22 | Westbound vans: T03 → Daet. Observation ₱140 (travel_guide, 2023-10). Hours 05:00–18:00. Source IC29 | import |
| RS23 | Eastbound jeepneys: T02 → Iriga, Nabua, Bula, Goa, Tigaon, Lagonoy. `unconfirmed`. Sources IC15, IC16. F01 estimate | import |
| X-UV-R34 / X-ROGER | R34 snippet; Roger Lines | exclude: page 404; undated (decision 7a) |
| X-BLOG-2013-19 | Caramoan van ₱100; boat ₱120 | exclude: blog posts from 2013–2019 |
| X-EB-FEE | Eastbound terminal fee ₱40/₱60 | exclude: paid by operators, not a fare |
| RS24 | Cebgo WNP–Clark (DG6129/6130): air, T17 → D-CLARK, `operating` since 2026-03-29.<br>Departure: `daily_unspecified`, `trips_per_day` 1, basis news, observed 2026-03.<br>Access note `airport_walk_to_maharlika`. Fare not found. Sources IC30–IC32 | import |
| links | RS01 → D-GOA; RS02 → D-GOA; RS03 → D-LAGONOY; RS05 → D-TABACO. Each as a new `community_mapped` version | import |
| note | `intercity_south_long_haul`: `{status: "planned_not_funded", trainsRun: false, sourceCodes: [IC10, IC11], asOf: "2026-07-13"}` | import |
| X-LUCENA, X-SEA | Lucena–Sipocot; the sea notes | exclude: not a goal for IC1 |

**Test first:** add a case to `intercity-seed.test.ts` that loads the real seed. It must:
- validate with no problems;
- show a decision and reviewer on every record;
- have RS06 without "Bicol Isarog";
- have no `planned_not_funded` service;
- match the research copy's sha256.

- **Depends on:** T2.
- **Risk:** medium (data fidelity).

---

### Task 4: Import script and writer

**Files:**
- `scripts/import-intercity.ts`: CLI shaped like `import-naga.ts`, using `redact()`. It prints:
  - counts;
  - every exclusion, with its reason;
  - a review sheet listing every import decision.
- `scripts/lib/intercity-writer.ts`: `commitIntercity(url, plan)` returns `{ outcome: 'committed' | 'unchanged'; batchId; draftId; counts }`.
- `package.json`: add `"db:import-intercity": "tsx --env-file-if-exists=.env.local scripts/import-intercity.ts"`.

**Writer:** one transaction, with `set local role paranaga_import` and `pg_advisory_xact_lock(hashtext('intercity-seed'))`.
1. **Refuse** if:
   - `reviewStatus !== 'owner_approved'` (the human gate);
   - the seed is synthetic;
   - there is no open draft (`... where status = 'draft' order by seq desc limit 1 for update`).
2. **Unchanged:** if a committed batch with the same sha256 already exists, return `unchanged`.
3. **Insert:**
   - the source document and batch;
   - the IC sources (`on conflict do nothing`);
   - destination and service identities and versions, reusing rows by content hash (`ensureIdentities`, `reuseOrPlan`, `insertRows`);
   - departures and observations, for new versions only;
   - T17;
   - the dataset note.
4. **Repoint draft members** for `regional_destination`, `regional_service` (seed codes only), T17 and the note.
5. **Never publish.**

A service version's content hash covers its departures and observations, sorted.

**Carry-forward guard:** in `scripts/lib/modes-writer.ts` and `lines-writer.ts`, keep the base member of any `regional_service` whose base version has `as_of` set or a non-empty `destination_codes`. Without this, a later import would revert RS06.

**Tests first** (`tests/integration/import-intercity.test.ts`):
- a dry run writes nothing;
- a `reviewStatus: draft` seed is refused;
- a commit writes into the open draft, and the published pointer stays unchanged;
- a second commit returns `unchanged` and writes zero rows;
- in the draft, RS06 is `discontinued_reported` with no Bicol Isarog;
- a suspended service with a fare aborts at dry run;
- re-importing the modes seed keeps RS06 v2.

**Verify:**
```
bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/import-intercity.test.ts tests/integration/import-modes-seed.test.ts tests/integration/import-roads-geometry.test.ts
```

- **Depends on:** T1, T2, T3.
- **Risk:** medium.

---

### Task 5: API, service worker and terminal detail

**`src/domain/api/schemas.ts`.** Add `intercitySchema`:
- `revision`
- `destinations[]`: `{ code, name, aliases, groupCode, psgcCode, kind }`
- `services[]`:
  - `code`, `mode`, `name`, `operators`
  - `terminal`: `{ code, name, locationText, lat, lng }` or null
  - `destinationCodes`, `status`, `statusSince`, `statusNoteCode`, `asOf`, `reviewBy`, `accessNoteCode`, `fareRuleCodes`
  - `departures[]`
  - `observations[]`: `{ amountCentavos, amountHighCentavos, seatClassText, destinationCode, basis, observedAt, sourceCodes }`
  - `sourceCodes`, `sourceEvidenceTypes`
- `fareRules`: the estimate is computed on the device, so the body doesn't depend on the time.
- `notes[]`

Also export `type Intercity` and the enums.

**`src/server/repos/intercity-repo.ts`** (imports `server-only`): `getIntercity(db, revisionId)` returns `{status:'not_published'}` or `{status:'ok', body}`. It reads the 4 views and `v_published_terminals`, with the same published-revision check as `getLines`.

**`src/app/api/v1/network/intercity/[revisionId]/route.ts`:** clone the lines route as `publicGet(request, 'network/intercity', intercitySchema, ...)` with `CACHE.immutable`. Return 404 when the revision isn't the published one.

**`src/domain/pwa/sw-routes.ts`:**
- add `'intercity'` to `CACHE_KINDS` and `RevisionCache`;
- add an `INTERCITY` regex as cache-first, keeping 3 revisions;
- add `"/app/leaving"` to `SHELL_PATHS` and `RSC_WARM_PATHS`;
- allow it in `acceptHandoff`.

**`src/app/sw.ts`:** `intercity: revisionCache("intercity")`.

**`getTerminalDetail`** (`src/server/repos/reference-repo.ts`):
- the regional query adds `and status = 'community_mapped'`, so RS06 v2 and the new services never show as running there;
- `hasIntercity: boolean` is added to the response and to `terminalDetailSchema`.

**Tests first:**
- `tests/unit/sw-routes.test.ts`:
  - the intercity URL is cache-first;
  - a URL without a UUID goes to network-only;
  - `/app/leaving` is a shell;
  - `acceptHandoff` accepts it.
- `tests/integration/reference-api.test.ts`:
  - the intercity route returns 200, and 404 for a superseded revision id;
  - T01 no longer lists RS06.

**Verify:**
```
pnpm typecheck
pnpm vitest run --project unit tests/unit/sw-routes.test.ts
bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/reference-api.test.ts
```

- **Depends on:** T1, T2. Runs in parallel with T6.
- **Risk:** medium.

---

### Task 6: Admin publication validation

- `src/domain/admin/schemas.ts`: `validationFactsSchema` gains `regionalServices` and `regionalDestinations`, both defaulting to `[]`.
- `src/domain/admin/validation.ts` gets these rules:

  | Rule | Level |
  |---|---|
  | `regional_not_running_with_facts` | error |
  | `regional_operating_without_official_or_news` | error |
  | `regional_observation_without_month` | error |
  | `regional_review_before_as_of` | error |
  | `regional_unknown_destination` | error |
  | `regional_operating_stale` (`as_of` older than 180 days) | warning |
  | `regional_destination_without_service` | warning |
  | `regional_terminal_without_coordinate` | warning |

**Tests first:** extend `tests/unit/admin-validation.test.ts` with one fixture per rule.

**Verify:**
```
pnpm vitest run --project unit tests/unit/admin-validation.test.ts
bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/admin-revisions-rls.test.ts
```

- **Depends on:** T1.
- **Risk:** low.

---

### Task 7: UI (S24, entry points, sources, search, i18n)

**Data hook.** `src/client/network/use-intercity.ts`, cloned from `use-lines.ts`. It reads the head, fetches `intercity/:rev` once per revision, and validates the response.

**Page.** `src/app/app/leaving/page.tsx`: a static shell with metadata, wrapping `<LeavingScreen />` in `<Suspense>`.

**Screen.** `src/ui/intercity/leaving-screen.tsx` and `leaving.css`.
- **List view:**
  - a rail status card: RS08, RS09, and the South Long Haul line "Planned project · not funded · no trains run";
  - an airport card;
  - destinations grouped by group, with a search box;
  - no map.
- **Detail view (`?to=`):**
  - "Running" cards sorted with `sortServices`, then a muted "Not running" section.
  - Each card shows:
    - a status pill with its "as of" date;
    - departures;
    - fares, each with its basis and month;
    - the fare estimate, kept separate from the fares.
  - "Get to {terminal}" appears only when `getToTarget` returns a target. It uses `useAppFrame().requestEndpoint('destination', …)` and `useReturnToMap()`, as `place-detail.tsx` does. Otherwise the card says "Location being confirmed".
  - a stale banner;
  - "not found" lines, each with a next step;
  - a link to `/app/help/sources?service=RS16`.
- **Copy rules:** never "schedule", "next bus", "on time" or "book". Each card stays at 24 words or fewer.

**Entry points:**
- an Explore section card (`src/ui/explore/explore-screen.tsx`);
- "Destinations from here" in `src/ui/terminals/terminal-detail.tsx`, shown when `hasIntercity`;
- a row in the help index.

**Sources screen.** `src/ui/help/sources-screen.tsx` with `?service=CODE` shows only that service's sources, under "Showing sources for {name}", with a "Show all" link.

**Search.**
- `src/domain/search/search.ts` gets:
  - `SearchOptions.intercity?`;
  - a result kind `{kind: 'intercity', code, title}` in the `regional` group, matching on names and aliases.
- `src/ui/search/search-screen.tsx`, when the regional switch is on, passes the intercity destinations and links results to `/app/leaving?to=`.

**i18n.** Add a `leaving` block to `src/i18n/en.ts` and `fil.ts`.
- Filipino must be complete; Bikol falls back to Filipino.
- Times use the 24-hour clock.
- Don't translate proper nouns.

**Tests first:**
- `tests/unit/leaving-screen.test.tsx` (RTL with a fixture):
  - Legazpi: PNR appears under "Not running" with "Suspended since 10 Nov 2025", no fare and no departures;
  - there is no "Get to" for T02 or T17;
  - every fare shows a basis and month, and nothing says "cheapest";
  - with the clock mocked past `review_by`, booking-site amounts are hidden and "may be out of date" shows;
  - RS06 reads "Stopped service reported (Mar 2026)";
  - the South Long Haul appears only as "no trains run".
- `tests/unit/search.test.ts`: intercity results appear only with the regional option on, and aliases match.
- `tests/e2e/leaving.spec.ts` (route-mocked):
  - Explore → list → Legazpi → "Get to BCS" opens the planner with To set;
  - axe passes in light and dark modes;
  - the screen works offline after one visit.

**Verify:**
```
pnpm typecheck
pnpm vitest run --project unit tests/unit/leaving-screen.test.tsx tests/unit/search.test.ts tests/unit/i18n-guards.test.ts
npx playwright test tests/e2e/leaving.spec.ts tests/e2e/terminals.spec.ts tests/e2e/search.spec.ts tests/e2e/offline.spec.ts tests/e2e/fil-overflow.spec.ts
pnpm verify
```

- **Depends on:** T5.
- **Risk:** medium (length of the Filipino copy).

---

### Task 8: Owner-gated rollout to production

1. **Migrate.** Create a Neon backup branch, then on production run `pnpm db:migrate` and `pnpm db:check-rls`. Standing approval covers this.
2. **Draft.** The owner creates a draft in Admin → Revisions.
3. **Dry run.** Run `pnpm db:import-intercity --dry-run` and hand the review sheet to the owner.
4. **Owner gate: seed review.**
   - The owner confirms or edits the decisions, replaces `reviewer: "owner"` with their own name, and sets `reviewStatus: "owner_approved"`.
   - The owner re-checks that Cebgo and PNR Lupi Viejo are still running, and confirms the PSGC codes.
5. **Commit.** Run `--commit`, then run it again and expect `unchanged`.
6. **Validate** in Admin: zero errors, and review any warnings.
7. **Owner gate (decision 6): second reviewer.** Make sure a second staff user exists, then set `publish_requires_second_reviewer = true`.
8. **Publish.** The second reviewer publishes, with step-up.
9. **Smoke test** on production:
   - `/api/v1/network/intercity/<id>` returns 200;
   - `/app/leaving?to=D-LEGAZPI` renders;
   - T01 no longer lists Philtranco.
10. **Record.** Log to KOS, refresh the handoff, and add the deviations to DECISIONS.md once the owner approves them.

## Verification checklist

| AC | Tests |
|---|---|
| AC-IC1 | `intercity-present` (`getToTarget`), `leaving-screen`, `leaving.spec`; plus `git diff --stat src/domain/planner src/domain/api/plan.ts` is empty |
| AC-IC2 | `intercity-schema` (trigger), `intercity-seed`, `import-intercity` (dry-run abort), `admin-validation`, `leaving-screen` |
| AC-IC3 | `intercity-schema`, `intercity-seed`, `leaving-screen` |
| AC-IC4 | `intercity-present`, `leaving-screen` |
| AC-IC5 | `intercity-present` (Manila midnight), `leaving-screen` (mocked clock), `leaving.spec` (offline) |
| AC-IC6 | `import-intercity` (RS06 v2), `reference-api` (T01), `leaving-screen` |
| AC-IC7 | `intercity-seed`, `import-intercity` (re-run, draft refused), `admin-revisions-rls` (second reviewer), plus T8 steps 7–8 |
| AC-IC8 | `sw-routes`, `leaving.spec` (offline, axe), `leaving-screen` ("not found" lines) |

**Final gate:**
- `pnpm verify`;
- `db:check-rls` and the affected integration specs, run through `with-neon-branch.sh`;
- the affected e2e specs;
- an opus final review of the diff against this plan.
