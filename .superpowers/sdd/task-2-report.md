# Task 2 report: import parsing and normalization (pure)

Status: DONE_WITH_CONCERNS (all brief counts reproduced; two brief phrases were ambiguous and are pinned below).

## Built (src/domain/import/, all pure; only `node:crypto` for sha256, allowed by check-boundaries)
- `csv.ts`: RFC 4180 parser (`parseCsv`, `parseCsvObjects`): quotes, escaped quotes, CRLF, embedded newlines, BOM, ragged-row and duplicate-header errors.
- `kml.ts`: `parseKml`: small tolerant XML tree (CDATA, entities, comments, self-closing, whitespace in coordinates); Folder name = layer; verbatim `coordinatesRaw`; non-Point placemarks returned in `skipped`; placemark outside a Folder throws.
- `hash.ts`: `sha256Hex`, `compareCodeUnits`.
- `mapped-stops.ts`: `parseKmlStops`, `parseGeojsonStops` (+ `MapMetadata`), `parseCsvStops`, `crossCheck`, `buildSnapshot` (KML authority + GeoJSON package id/route/direction/export position/properties), `normalizeLabel`, `sourceIdentity`, `withIdentities` (asserts uniqueness), `toRawFeatureRow` (ingest.raw_feature shape with verbatim lon/lat text and content hash), `EXPECTED_LAYER_COUNTS`.
- `conflicts.ts`: `detectConflicts` (kinds `code_prefix_mismatch`, `exact_coordinate_shared`, `near_duplicate`; refs sorted/distinct by code-unit order = "C" collation for hex ids; deterministic output order).
- `provisional-loops.ts`: `provisionalLoopSequence` (R8-A, R8-B; null for R8-C/D; throws for other routes, foreign prefix, gaps).
- `seed.ts`: `normalizeSeed` -> typed rows for every collection, fares in centavos, F05 -> observation + open conflict vs F03; `crossCheckDesignatedCsv`.
- `survey-template.ts`: `parseSurveyTemplate` (45 columns).
- Tests: `tests/unit/import-parsers.test.ts`, `import-stops.test.ts`, `import-seed.test.ts` (they read the real `Data_Sets/*`).

## Observed counts (real data)
- 128 records in each of KML, GeoJSON, CSV; layers A 30 / B 31 / C 34 / D 33. `crossCheck` returns [] (record-for-record on layer, code, verbatim label, coordinates within 1e-7). GeoJSON metadata record_count 128 and exact_unique_coordinate_count 114 agree with KML.
- Identities: 128 unique, stable across runs.
- `code_prefix_mismatch`: 53 conflicts (one per record; 26 in C, 27 in D), as briefed.
- `exact_coordinate_shared`: 114 distinct coordinate pairs; 14 pairs are shared (each by exactly 2 records, 28 records). So "114 coordinate groups" in the brief means 114 distinct pairs; only 14 are conflicts. 14 conflict rows will be written.
- `near_duplicate` (my definition: different layers, 0 < d <= 15 m, not same coordinates, labels similar by equal / word containment / Jaccard >= 0.5, both non-empty): 46 conflicts. (62 cross-layer pairs within 15 m, 14 of them exact, 2 with an empty label.)
- Loop A: 30 pins, round trip 7,165 m, max gap 452 m. Loop B: 31 pins, 7,146 m, max gap 457 m.
- Seed: sources 42, routes 11, trial changes 2, fare rules 4 (+1 observation, +1 conflict), terminals 6, external destination categories 5, feeders 5, providers 3, barangays 27 (all `not_surveyed`), rail keys 4, designated candidates 32, dataset notes 5. `integrityIssues` is empty. Designated CSV agrees with seed on all 32.
- Survey template: 45 columns (`record_id` ... `source_program`).
- Fares (centavos): F01 1400 / 4 km / +200; F02 1700 / 4 km / +240; F03 1500, 20 %, discounted base 1200 (calculated in seed), base_km and increment null; F04 1000 / 800; F05 student 1300, kind `reported_practice`, observed 2026-06-22, details hold reported base 1500 and calculated 1200.

## Commands
- `pnpm test`: 14 files, 206 tests pass. `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries`: clean.
- TDD note: tests were written first and failed to import (modules absent); implementation then made them green; no assertion was loosened to fit.

## Data findings Task 3 must handle
1. Two records have an EMPTY label (MYM-B-016 code B19, MYM-B-017 code B18, Loop B). `raw_feature.label_raw` is NOT NULL: store `''` (verbatim), do not substitute. `stop_point.name` is NOT NULL, so use a non-empty fallback such as the code with a flag; do not invent a place name.
2. Source identities use the verbatim layer name ("Loop Service A") as the `layer` part of the key: `map_id|source_layer|code|normalized label` (spec 4.7), not the letter.
3. Labels are not unique within the map across layers (same label, same code appear in A and C); identity uniqueness holds because layer is in the key.
4. Spelling variants are kept verbatim (e.g. "Villla Caceres", "BIcol River Esplanade", "Fransisco"); three Peñafrancia variants. No `label_variant` conflicts are generated (not requested).
5. `coordinatesRaw` is only available from the KML (`123.1846726,13.6233869,0`); `toRawFeatureRow` returns `lonText`/`latText`. GeoJSON numbers lose trailing zeros.
6. Brief says F05 conflicts "against F03": the seed does not name F03 itself; its evidence_status says "conflicts with 20 percent calculation", which is F03's rule. Linkage is by that inference (also stated in spec 4.7). The observation row has `ruleCode: null` (fare_observation.fare_rule_id nullable); the conflict row carries the F03 link.
7. `seed.designated_stop_program.new_signage_observation.source` = "user_in_conversation" is not an S-code; it stays inside the dataset note JSON only.

## Unknown/nullable fields (relax NOT NULL or accept NULL in Task 3)
- Route: `mode_code` is the seed's `PUJ_Class_2_plan` (a plan class, not an operating vehicle mode); all routes have `operating_status` "unverified", `geometry`/`service_hours`/`operator`/`fare_rule_id` null, no stops. R8-A..D `allocated_units` null (group total 71 kept in `extra.group_allocated_units`; do not split). `direction` only on R8-*. R3 has `extra.normalization_note` and `extra.additional_source_structure`; R8-A/B have `extra.pending_change_source`. Streets: `legalStreets.{inbound,outbound,circuit}` each null when absent.
- Source: `published_or_enacted` null for some sources (S09, S13, S14 ...). `url` may be null.
- Terminals: `lat`/`lng` null for all six (geog nullable already); `hours`, `entrances`, `bays` empty/null.
- Fare rule: `effective_from` null (F03), `base_km` null (F03, F04), `increment` null (F03, F04), `rounding` null for all, `discount_percent` null for F01/F02/F04. `publishExact` false for all.
- Feeders: `fare_centavos` null; providers: `quote_centavos` null, `products` (service_types_currently_bookable) null; external destination categories: fare/service hours/geometry null (kept in `details`).
- Rail: `current_fares`, `current_timetable` values null (`transit.rail_status.value` is nullable).
- Designated candidates: all have lat/lng/curb/loading/sign null; 2 of 32 (`WS-*` waiting areas, route SF03) have no `label_type`, `direction`, `source_context`, `notes`. Route code SF03 is not an R-code, so do not FK it to `route`.
- Mapped stops: `routeId`/`direction` come from the GeoJSON only; `stop_sequence` is null everywhere, `export_position` is not a verified sequence.
- Trial changes: `variant.kind='trial'`, direction should map from route (R8-A clockwise, R8-B counterclockwise per seed route rows).

## Self-review
- Pure: no fs, DB or server imports; sha256 via `node:crypto` (permitted by check-boundaries; Vitest runs under Node).
- No new dependencies. CSV/KML edge cases are unit-tested.
- Strictness over leniency: the KML parser throws on unusable coordinates, on a placemark outside a Folder and on malformed XML; `crossCheck` is exact on label text (so a whitespace difference between formats would be reported rather than hidden).
- Limitations: the XML parser is not general (no DTD/namespace handling beyond stripping prefixes). `labelsSimilar` is a heuristic (equal, word containment, or Jaccard >= 0.5); near-duplicates are review proposals only, never auto-merged.
- Not done by design: no `label_variant` detection, no DB writes, no migration changes.
