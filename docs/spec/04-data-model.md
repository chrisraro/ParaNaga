# 4. Data model

Conventions: `uuid` primary keys (`gen_random_uuid()`), `timestamptz` everywhere, `geography(Point,4326)` for points and `geography(LineString,4326)` for shapes (with generated `geometry` columns where planar operations are needed). GeoJSON is always **[longitude, latitude]**. Money is `integer` centavos. `NULL` means unknown, never zero.

## 4.1 Schemas

| Schema | Purpose | Personal data? |
|---|---|---|
| `neon_auth` | Managed Better Auth (users, sessions, accounts) | Yes — managed by Neon |
| `core` | Profiles, roles, preferences, audit, acknowledgements | Yes (minimal) |
| `ingest` | Source documents, import batches, raw features, diffs | No |
| `transit` | Revisioned public transport data | No |
| `community` | Posts, comments, corrections, moderation | Pseudonymous |
| `priv` | Driver complaints, evidence, handoffs | **Yes — restricted** |
| `ops` | Jobs, rate limits, moderation policy, provider health | No (hashed keys only) |
| `extensions` | PostGIS, pg_trgm, unaccent, pgcrypto, btree_gist | — |

## 4.2 Core

| Table | Key fields |
|---|---|
| `core.profile` | `user_id` (→ neon_auth user), `display_name`, `locale`, `created_at`, `deleted_at` |
| `core.role` | `code`: `commuter`, `contributor`, `transport_reviewer`, `community_moderator`, `complaint_reviewer`, `admin` |
| `core.user_role` | `user_id`, `role_code`, `granted_by`, `granted_at`, `revoked_at`, `reason` — unique active (user, role) |
| `core.preference` | `user_id`, `fare_category`, `max_walk_m`, `avoid_stairs`, `high_contrast`, `reduced_motion`, `low_data`, `history_enabled` (default **false**) |
| `core.saved_place` | `user_id`, `label`, `geog`, `landmark_id?` |
| `core.saved_trip` | `user_id`, `revision_id`, `legs jsonb`, `title`, `invalidated_at?`, `invalidation_reason?` |
| `core.trip_history` | `user_id`, `revision_id`, `from_label`, `to_label`, `started_at` — **no coordinates**; opt-in only; 90-day retention |
| `core.ack` | `user_id`, `kind` (`community_guidelines`, `driver_report_notice`, `ai_processing_disclosure`), `version`, `accepted_at` |
| `core.audit_event` | `id`, `actor_user_id?`, `actor_role`, `action`, `entity_type`, `entity_id`, `before jsonb?`, `after jsonb?`, `request_id`, `at` — append-only (no UPDATE/DELETE grant to anyone but the owner) |

A guest has no row. `commuter` is granted at sign-up; every other role only by an admin through `core.grant_role()`. `contributor` is granted automatically after email verification + 24 h account age (configurable).

## 4.3 Ingest (source provenance)

| Table | Key fields |
|---|---|
| `ingest.source` | `code` (families: `S01`–`S42` research package, `OSM-YYYY-MM-DD` places snapshots, `N01`–`N41` modes research register, `U01` project-owner confirmation, `OSMR-YYYY-MM-DD` road snapshots; migration 0006; research families `RT01`-`RT24` tricycle restrictions, `RL01`-`RL19` loops and routes, `RP01`-`RP22` padyak, `RH01`-`RH21` jeepney hours, pattern `^R[TLPH][0-9]{2}$`, and `U02` the owner report; migration 0010), `publisher`, `licence`, `extra_urls`, `title`, `url`, `evidence_type` (`official`, `official_historical`, `news`, `community`, `public_map`, …), `published_or_enacted`, `checked_on` |
| `ingest.source_document` | `source_code`, `file_name`, `sha256`, `bytes`, `retrieved_on`, `storage_key?` |
| `ingest.batch` | `id`, `source_document_id`, `snapshot_version` (e.g. `mymaps:1f0HedvouLfPzGTte38TdqNM4pYBICG4:2026-10-15`), `mode` (`dry_run`/`commit`), `status`, `counts jsonb`, `started_by`, `started_at`, `finished_at` |
| `ingest.raw_feature` | `id`, `batch_id`, `source_identity`, `source_layer`, `source_code_raw`, `label_raw`, `description_raw`, `lon`, `lat`, `properties jsonb`, `content_hash` — unique (`source_identity`, `snapshot_version`) |
| `ingest.change` | `batch_id`, `source_identity`, `kind` (`added`, `unchanged`, `changed`, `missing`), `diff jsonb` |
| `ingest.conflict` | `batch_id`, `kind` (`code_prefix_mismatch`, `exact_coordinate_shared`, `near_duplicate`, `label_variant`), `refs uuid[]`, `resolution?`, `resolved_by?` |
| `ingest.error` | `batch_id`, `row_ref`, `code`, `message` |

## 4.4 Transit (revisioned, public)

### Revisions
`transit.revision`: `id`, `seq` (monotonic), `label`, `status` (`draft`, `validating`, `published`, `superseded`), `created_by`, `published_by?`, `published_at?`, `parent_revision_id`, `validation_report jsonb`, `content_hash`.

Each mutable transit entity has a stable identity row plus immutable `*_version` rows. A **revision is a complete snapshot**, recorded by membership, so unchanged entities are carried forward without copying their data:

```sql
create table transit.revision_member (
  revision_id uuid not null references transit.revision,
  entity_kind text not null,          -- 'variant', 'stop_point', 'fare_rule', ...
  entity_id   uuid not null,          -- stable identity
  version_id  uuid not null,          -- the *_version row used in this revision
  primary key (revision_id, entity_kind, entity_id));

create table transit.published_pointer (
  singleton boolean primary key default true check (singleton),
  revision_id uuid not null references transit.revision,
  updated_at timestamptz not null default now());
```

- A new draft starts by copying the parent's membership rows (cheap: ids only); edits insert new `*_version` rows and repoint that draft's membership.
- **Publish** and **rollback** are the same `SECURITY DEFINER` operation: lock `published_pointer` (`FOR UPDATE`), validate the target, set the old revision `superseded`, set the target `published`, update the pointer, audit — one transaction. Rollback re-publishes an earlier (`superseded`) revision; nothing is edited or deleted.
- The partial unique index `ON transit.revision ((true)) WHERE status = 'published'` stays as a backstop; the pointer is the source of truth.
- Public views join `published_pointer → revision_member → *_version`.

### Entities
| Table | Key fields |
|---|---|
| `transit.agency`, `transit.operator` | name, kind (LGU, cooperative, TODA, company), public contacts only |
| `transit.mode` | `code` (`walk`, `puj_traditional`, `puj_modern`, `multicab`, `trimobile`, `etrike`, `padyak`, `uv_van`, `bus`, `rail`, `taxi`, `ride_hail`), `shared_default` |
| `transit.route` | stable `id`, `public_code` (R1…R8-D), `official_group_number`, `name`, `mode_code`, `legal_status`, `allocated_units`, `allocation_is_active_fleet_count=false` |
| `transit.route_alias` | `route_id`, `alias`, `kind` (`legacy_name`, `signboard`, `local`, `legacy_color`), `is_historical`, `source_code` |
| `transit.variant` | stable `id`, `route_id`, `direction` (`inbound`, `outbound`, `clockwise`, `counterclockwise`, `branch`), `kind` (`permanent`, `trial`, `event`, `construction`) |
| `transit.variant_version` | `variant_id`, `revision_id`, `headsign`, `vehicle_class`, `legal_streets text[]`, `effective tstzrange`, `trial_status?`, `operating_status` (`unverified`, `observed`, `confirmed`), `navigation_approved`, `source_codes text[]` |
| `transit.shape_version` | `variant_version_id`, `geog LineString`, `length_m`, `evidence_kind` (`legal_plan_trace`, `gps_ride_log`, `surveyed`), `reviewed_by`, `reviewed_at` |
| `transit.stop_area` | stable `id`, `name`, `kind` (`landmark_cluster`, `terminal`, `junction`), `geog?` — groups curbs sharing a landmark |
| `transit.stop_point` | stable `id`, `stop_area_id?`, `name`, `official_stop_id?` |
| `transit.stop_point_version` | `stop_point_id`, `revision_id`, `geog`, `geog_accuracy_m?`, `status` (§4.6), `curb_side` (`left_of_travel`, `right_of_travel`, `terminal_bay`, `unknown`), `road_segment_ref?`, `toward_label`, `landmark_text`, `boarding_allowed?`, `alighting_allowed?`, `mode_restrictions text[]`, `legal_designation` (`none`, `documented`, `ordinance`), `sign_installed?`, `sign_text_verbatim?`, `sign_condition?`, `observed_operating?`, `navigation_approved`, `temporary_until?`, `replaces_stop_point_id?` |
| `transit.stop_point_source` | `stop_point_id`, `raw_feature_id` — links curbs to source pins (many-to-many; provenance never collapses) |
| `transit.route_stop` | `variant_version_id`, `stop_point_version_id`, `seq`, `dist_along_m`, `boarding_allowed`, `alighting_allowed` — unique (`variant_version_id`, `seq`); a stop may appear more than once with different `seq` values. `variant_version.is_circular` marks loops: `dist_along_m` increases within one circuit, and ride distance across the start point wraps modulo `shape_version.length_m` |
| `transit.terminal`, `terminal_bay`, `terminal_entrance` | name, location text, `geog` (null until evidenced), bay route assignments, hours |
| `transit.walk_edge` | `from_node`, `to_node`, `geog LineString`, `kind` (`sidewalk`, `crossing_signal`, `crossing_zebra`, `overpass`, `terminal_path`), `stairs`, `wheelchair_ok?`, `directed`, evidence |
| `transit.barrier` | `geog LineString`, `kind` (`median`, `rail`, `river`, `wall`, `fence`), evidence |
| `transit.fare_rule`, `fare_rule_version` | see [Architecture §3.7](03-architecture.md#37-fare-engine-srcdomainfares) |
| `transit.discount_rule` | `category`, `mode_scope text[]`, `percent?`, `fixed_centavos?`, `rounding`, `effective`, evidence |
| `transit.fare_matrix_row` | `fare_rule_version_id`, `km_from`/`km_to` or `from_stop_area`/`to_stop_area`, `regular_centavos`, `discounted_centavos?` |
| `transit.fare_observation` | `mode`, `amount_centavos`, `category`, `kind` (`official_matrix`, `charged_fare`, `estimate`, `exclusive_quote`), `observed_at`, `source_code` or `correction_id` |
| `transit.fare_conflict` | `fare_rule_id`, `observation_ids uuid[]`, `status` (`open`, `resolved`), `note` |
| `transit.service_window` | `variant_version_id`, `day_type`, `first_observed`, `last_observed`, `dispatch_model` (`scheduled`, `when_full`, `headway`), `headway_min_range int4range?`, `confidence`, evidence |
| `transit.disruption` | `kind`, `title_i18n jsonb`, affected variants / stop points / area, `active tstzrange` (finite upper bound required), `replacement_note`, evidence |
| `transit.landmark`, `landmark_alias` | name, kind (school, hospital, church, mall, terminal, barangay hall…), `geog`, `entrance_geog?`, locale-tagged aliases |
| `transit.barangay` | PSGC code, name, polygon (27 rows) |
| `transit.evidence` | `id`, `kind` (`document`, `photo`, `gps_log`, `field_survey`, `operator_statement`), `source_code?`, `media_object_id?`, `observed_at`, `observer_user_id?`, `reviewer_user_id?`, `note` |
| `transit.evidence_link` | `evidence_id`, `claim` (`legal_designation`, `sign_installed`, `operating_observed`, `curb_position`, `fare`, `hours`, `shape`), and one nullable FK per target — `stop_point_version_id`, `variant_version_id`, `shape_version_id`, `fare_rule_version_id`, `service_window_id`, `terminal_id`, `walk_edge_id` — with `CHECK (num_nonnulls(...) = 1)`, a claim/target compatibility check, `UNIQUE (target, evidence_id, claim)`, and an index on every FK. Evidence links to *versions*, so "published needs curb evidence" is checked per revision |
| `transit.coverage_audit` | `barangay_code`, nine dimensions (trunk, feeder, curbs, both directions, fares, hours, school/hospital access, rainy season, night), each `not_surveyed` / `partial` / `complete` |

### Modes, approximate paths and estimate records (migrations 0006–0009, Increment D)

All of these follow the revision model above: immutable rows, chosen by `revision_member`, published only through `transit.publish_revision`, read only through `transit.v_published_*` views (0008 modes, 0009 geometry). Every table has RLS enabled and forced; `paranaga_app` has SELECT only and `paranaga_import` SELECT + INSERT (no UPDATE or DELETE).

| Table | What it holds |
|---|---|
| `transit.route` (+ columns) | `mode` (`jeepney`, `tricycle`, `uv_express`, `bus`, `rail`), `service_status` (`legal_plan`, `authorized_feeder`, `historical_unknown`), `planning` (`provisional`, `none`; informational, the planner decides from variants that have stops). `transit.variant` gains `name` (several branch variants of one feeder route); `variant_version` gains `anchors` (tracing anchors of a feeder variant). |
| `transit.route_vehicle_class` | Per route, one row per vehicle class: `vehicle_class` (`traditional_puj`, `modern_puj`, `tricycle`, `e_tricycle`, `uv_express`, `bus`; there is no e-jeepney class), `evidence_levels`, `status` (`planned`, `reported`, `reported_not_confirmed`, `operating`), first/last report dates, `aircon` (NULL = no source states it) with its sources, cooperative names, conflict notes. Checks tie `status` to evidence: `operating` exactly when owner confirmation is among the evidence, `planned` exactly when the only evidence is the legal plan, `reported_not_confirmed` exactly when every level is a secondary claim or user report. |
| `transit.route_cooperative` | Cooperative **names** only, with `basis` (`corridor_reported`, `name_matches_corridor`) and a report month or day. No column holds a chairperson name or an address. |
| `transit.route_operating_status` | `operating` plus the confirmation date and note (owner confirmation of 2026-10-16: service only, never stop locations, order or paths). |
| `transit.route_fare_observation` | What riders report paying for one vehicle class as a delta over the traditional fare (`range` or `at_least`, in centavos). Observations, never rules; the planner uses them only to widen a mixed-fleet maximum and says so. |
| `transit.terminal_version` | Versioned terminals (the legacy `terminal` row stays the identity; a member whose `version_id` equals `entity_id` is the legacy row of older revisions). `kind` (`terminal`, `loading_point`, `waiting_area`, `station`), `modes`, verbatim `modes_raw`, a coordinate only from OpenStreetMap with its provenance (type, id, version, timestamp, `coord_source` node or way centroid) or none, `verification`, source codes. |
| `transit.regional_service` + `regional_service_version` | The RS01 to RS07 regional UV Express, bus and jeepney services leaving from a terminal: operators, destination, OSM relation ids and versions, `distance_km` with its basis (NULL = not on file), `status = community_mapped`, the fare rule codes used for estimates. Regional routes are never drawn as lines. |
| `transit.shape` + `shape_version` | One **approximate path** per variant, traced on the pinned OSM road snapshot (ODbL derived database). A version records the trace of one variant version: `trace_status` `ok`, `flagged` (drawn, with `flag_reason` `oneway_conflict` or `off_list_detour`) or `untraced` (no line, with `untraced_reason`). Always `approximate = true` and `label = "Approximate path, not a verified route shape"`. It carries `length_m`, per-stop `stop_measures` (metres along the line), `off_list_segments`, a `trace_quality` report, `inputs_hash`, and `road_source_code` (`OSMR-…`). Publish requires the version to follow the variant's member version, so a changed street list can never keep an old path. This is distinct from the "reviewed shape" of the entity list above (GPS ride log or surveyed, with a reviewer), which no variant has yet. |
| `transit.route_note` | Reviewed rider-facing note on a route (migration 0010): `note_code` (RNxx), `text` (at most 120 characters), `evidence` (`official`, `news`, `community`, `owner_report_unverified`), optional `near_geog` with `near_radius_m` (50 to 2000), `source_codes` (at least one), `content_hash`, `is_synthetic`. A published revision member kind; a note whose route is not a member, or a synthetic note, blocks publishing. Public through `v_published_route_notes` and `snapshot.routes[].notes`. |
| `transit.walk_graph` + `walk_graph_version` | The on-device street graph payload (format v1, or v2 since migration 0010: per-edge mode flags for walk, tricycle and padyak, restricted-road rules with time windows, padyak areas and place nodes) stored verbatim with `bytes` (at most 800 KB; v1 stayed under 600 KB), `gzip_bytes` (at most 260 KB; v1 under 220 KB), its `sha256` (also the HTTP ETag), node and edge counts, and the road snapshot it was built from. |
| `transit.eta_param` + `eta_param_version` | The five time-estimate parameters: `walk_speed_kmh`, `walk_slowdown_factor`, `jeepney_speed_offpeak_kmh`, `jeepney_speed_peak_kmh`, `peak_windows`. Each has a low and high value (or windows), `applies_to`, its `basis`, source codes, and either sources or `is_assumption` with an `assumption_note`. |

Publication validation also refuses synthetic rows in any of these tables.

### Constraints and indexes
All PostGIS / trigram / btree_gist objects are referenced schema-qualified (`extensions.ST_…`, `extensions.gin_trgm_ops`), so migrations and restores don't depend on `search_path`.

- Spatial indexes match the real queries: `GIST (geog)` for `ST_DWithin` on stop-point versions; generated `geom_utm geometry` columns (EPSG:32651, metres) with their own GiST indexes for `ST_LineLocatePoint` and barrier intersection; `GIST` on a generated geog in `ingest.raw_feature` for the duplicate scans. The planner reads a revision snapshot, so published-only partial indexes are unnecessary for planning; the `/stops?bbox=` endpoint joins through `revision_member`.
- Service-area sanity (in-city tables), an immutable expression that works for points and lines:
  `CHECK (extensions.ST_CoveredBy(geog, extensions.ST_MakeEnvelope(123.05, 13.45, 123.40, 13.80, 4326)::extensions.geography))`; regional terminals use a second named constraint with a wider Bicol envelope.
- Fare overlap backstop: `EXCLUDE USING gist (fare_rule_id WITH =, vehicle_class WITH =, effective WITH &&) WHERE (status = 'verified')`, ranges `'[)'` and `NOT isempty(effective)`. Revision-aware overlap is checked in publication validation.
- `transit.disruption`: `CHECK (NOT upper_inf(active))`.
- `route_stop.dist_along_m` increasing by `seq` within a circuit — checked in publication validation.
- `UNIQUE (stable_id, revision_id)` is not used (versions are revision-independent); instead `revision_member`'s primary key guarantees one version per entity per revision.
- `is_synthetic boolean NOT NULL DEFAULT false` on every transit table; publication fails if any member of the revision is synthetic.
- Trigram GIN on `transit.f_norm(name)` — an `IMMUTABLE` wrapper around `unaccent(lower(...))` — and queries use the identical expression.
- Every RLS policy column (`author_id`, `reporter_id`, `user_id`) is indexed; `core.user_role (user_id, role_code) WHERE revoked_at IS NULL`.
- High-write tables (`core.audit_event`, `ops.job`, `ops.rate_limit_bucket`) use UUIDv7 ids generated in the app; `ops.rate_limit_bucket` has primary key `(key_hash, window_start)` and old windows are purged hourly.
- Arrays of ids that need integrity (`post_version.media_ids`, `fare_conflict.observation_ids`, `moderation_decision.evidence_ids`) become join tables at implementation; `ingest.conflict.refs` stays an array (sorted) with `UNIQUE (batch_id, kind, refs)`.

### Public read model
Views `transit.v_published_*` expose only the current published revision; `transit.v_candidate_pins` exposes candidates with their status for Explore. The app reads public data only through these views.

## 4.5 Community

| Table | Key fields |
|---|---|
| `community.post` | `id`, `author_id`, `category`, `route_id?`, `stop_point_id?`, `barangay_code?`, `label` (`community`, `official_notice`, `incorporated_change`), `published_version_id?`, `deleted_at?` |
| `community.post_version` | `post_id`, `n`, `title`, `body`, `media_ids uuid[]`, `submitted_at`, `moderation_status` (`pending`, `published`, `rejected`, `human_review`, `superseded`) |
| `community.comment`, `comment_version` | same pattern; `parent_comment_id?` (depth ≤ 2) |
| `community.reaction` | `user_id`, `target`, `kind='helpful'` — unique per user/target |
| `community.bookmark` | `user_id`, `post_id` |
| `community.user_block` | `blocker_id`, `blocked_id` |
| `community.content_report` | `reporter_id`, `target`, `reason`, `note`, `status` |
| `community.correction` | `id`, `author_id`, `entity_type`, `entity_id`, `entity_revision_id`, `kind`, `proposed jsonb`, `observed_at`, `fare_kind?`, `fare_category?`, `service_kind?` (`shared`/`exclusive`), `location geog?`, `location_accuracy_m?`, `status` (§4.6), `duplicate_of?`, `reviewer_note?`, `incorporated_revision_id?` |
| `community.correction_event` | `correction_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `reason_code`, `note`, `at` |
| `community.jev_evidence` | `id`, `target_version_type`, `target_version_id`, `question_set_version`, `model_requested`, `model_returned`, `request_id`, `answers jsonb`, `usage jsonb`, `latency_ms`, `error_code?`, `created_at` |
| `community.moderation_decision` | `target_version_id`, `policy_version`, `action`, `reason_codes text[]`, `evidence_ids uuid[]`, `decided_by` (`policy` or user id), `is_override`, `at` |
| `community.appeal` | `decision_id` **unique** (one appeal per decision), `author_id`, `note`, `status`, `resolved_by?`, `outcome?` |
| `community.user_restriction` | `user_id`, `kind` (`cooldown`, `post_limit`, `suspended`), `until` (required), `reason`, `set_by` |
| `community.changelog_entry` | sanitized public summary of an incorporated correction |

## 4.6 State machines

**Stop point status** (evidence fields — legal designation, sign installed, operating observed, navigation approved — are recorded independently):
```
candidate → documentary → installed → field_verified → published
any → temporary(until) | relocated(→ new stop point) | retired
```
`published` requires `navigation_approved = true`, a reviewed curb, and at least one `curb_position` evidence link.

**Correction:** `draft → submitted → awaiting_moderation → (needs_evidence ⇄ submitted) → under_transport_review → accepted | rejected | duplicate`; `accepted → incorporated` (on publication) or `superseded`.

**Community content:** `pending → published | rejected | human_review`; `human_review → published | rejected`. One appeal per decision → `upheld | overturned`. An edit creates a new `pending` version; the previous published version stays live until the edit passes.

**Driver complaint:** `draft → submitted → under_review ⇄ needs_information → closed`; `draft | submitted | needs_information → withdrawn`. Neutral outcome codes: `info_provided_to_reporter`, `insufficient_detail`, `duplicate`, `outside_scope`, `reporter_withdrew`.

**External handoff** (separate from complaint status): `not_started → handoff_started → submitted_externally` (user-confirmed; + optional self-reported reference and status).

**Revision:** `draft → validating → draft` (on failure) `| published → superseded`; `superseded → published` only through rollback (same definer function as publish).

## 4.7 Import pipeline for the research package

Inputs, copied to `data/source/naga/`: `naga_mapped_stops_source.kml`, `naga_mapped_stops.geojson`, `naga_mapped_stops.csv`, `naga_transport_seed.json`, `designated_stop_candidates.csv`, `field_survey_template.csv`, `Naga_Commuter_Research.md`.

**Source identity.** My Maps KML exports usually carry no stable placemark id, and position within a layer shifts when pins are added or removed. Identity is therefore resolved in order, and the method is stored in `raw_feature.identity_method`:
1. a stable placemark id, if the export has one;
2. otherwise `(map_id, source_layer, source_code_raw, normalized label)` — unique within a layer in this snapshot (verified at import);
3. otherwise position within the layer, flagged for reviewer confirmation.

`source_identity = sha256(identity key)`. Coordinates and raw label are excluded from method 1, so a moved pin appears as `changed`. `ingest.raw_feature_lineage (source_identity → stop_point_id)` remembers which candidate stop each identity created, so later snapshots update the same candidate. Package ids (`MYM-A-001`) are kept in `properties.package_id` for cross-reference only. Unique keys: `ingest.raw_feature (batch_id, source_identity)`, `ingest.change (batch_id, source_identity)`.

`scripts/import-naga.ts --dry-run | --commit` (a commit runs in one transaction under `pg_advisory_xact_lock(hashtext(snapshot_version))`; a unique index on `ingest.batch (snapshot_version) WHERE mode = 'commit' AND status IN ('running','committed')` blocks concurrent or repeated commits):
1. Hash every file into `ingest.source_document`. If the same hash is already committed for the same snapshot, exit as a no-op. "Previous snapshot" for diffs means the latest **committed** batch for the same map.
2. Parse the KML (raw authority) and the GeoJSON; assert record-for-record agreement (layer, code, label, coordinates to 1e-7). Any disagreement → `ingest.error`, commit refused.
3. Assert counts: 128 total; A 30, B 31, C 34, D 33. Mismatch → abort.
4. Upsert `ingest.raw_feature` on (`source_identity`, `snapshot_version`); compute `ingest.change` against the previous snapshot.
5. Record conflicts; never auto-resolve:
   - `code_prefix_mismatch`: 26 Loop C records carry `A*` codes; 27 Loop D records carry `B*` codes.
   - `exact_coordinate_shared`: 128 records sit on 114 distinct coordinate pairs.
   - `near_duplicate`: cross-layer pins within 15 m with similar labels — proposed matches for review.
6. Create one `transit.stop_point` + `stop_point_version` (`status='candidate'`, `navigation_approved=false`) **per raw feature**, linked through `stop_point_source`. No de-duplication by name, code or distance.
7. Seed documentary data from `naga_transport_seed.json` into a **draft revision**: 42 sources; 11 routes with legal street lists; 2 trial changes as `kind='trial'` variants with `trial_status='permanence_unconfirmed'`; fare rules F01–F04 as `draft`; F05 as a `fare_observation` + open `fare_conflict` against F03; terminals T01–T06 without coordinates; feeders SF01–SF05; 27 barangays as `not_surveyed`; 32 designated-stop candidates as label-only records (no coordinates).
8. Store `public_stop_map` metadata with owner display name "Tan Gumba" and `owner_identity_verified=false`; no other attribution.
9. Rerun → zero new rows, every record `unchanged` [AC-1].

`export_position` is stored, but because `export_position_is_verified_sequence=false`, no `route_stop` rows are created from export order.

## 4.8 Private (driver complaints)

| Table | Key fields |
|---|---|
| `priv.complaint` | `id`, `public_ref` (e.g. `PN-7KQ4-2M`, random, non-sequential), `reporter_id`, `category`, `description`, `incident_at`, `incident_location geog?`, `location_accuracy_m?`, `location_source` (`gps`, `manual`, `none`), `route_id?`, `direction?`, `operator_text?`, `plate_text?`, `body_number_text?`, `status`, `outcome_code?`, `retention_until`, `created_at` |
| `priv.complaint_media` | `complaint_id`, `media_object_id`, `capture_kind` (`in_app_camera`, `file_upload`), `captured_at_client?`, `received_at_server`, `sha256`, `gps_accuracy_m?`, `original_key`, `redacted_key?` |
| `priv.complaint_event` | status transitions; `visibility` (`reporter`, `reviewer_only`); notes |
| `priv.evidence_access` | `media_object_id`, `accessor_id`, `purpose`, `issued_at`, `expires_at`, `request_id` — one row per signed URL |
| `priv.external_handoff` | `complaint_id`, `target='mynaga'`, `event` (`handoff_started`, `submitted_externally`), `self_reported_reference?` (≤ 64 chars), `self_reported_status?`, `at` — RLS keyed to the complaint's reporter |
| `priv.jev_complaint_evidence` | routing classifications (same shape as community evidence) |

`priv` has no public views. `community_moderator` has no grant on `priv`. Reviewers read complaints through `priv.v_complaint_review`, which omits `reporter_id` (shown only through an audited definer function when contact is needed).

Retention: closed/withdrawn complaints purged 365 days after closure (configurable); abandoned drafts after 30 days; `legal_hold boolean` suspends purging. The `retention_purge` job deletes, in one idempotent flow, the S3 originals and redacted copies, `media_object`, `complaint_media`, `evidence_access`, events and the complaint row, then verifies no orphaned objects remain. Neon point-in-time-restore history is kept ≤ 7 days so purged rows do not linger in history. On account deletion, `reporter_id` on retained complaints is replaced with a pseudonymous tombstone id.

## 4.9 Ops

`ops.job`, `ops.rate_limit_bucket (key_hash, window_start, count)`, `ops.moderation_policy (version, thresholds jsonb, question_set jsonb, active)`, `ops.provider_health (provider, last_ok_at, last_error_code, consecutive_failures, circuit_open_until)`, `ops.feature_flag`, `core.media_object (id, bucket, key, mime, bytes, sha256, owner_id, purpose, status)`.

## 4.10 Data dictionary — package fields → tables

| Package field | Lands in | Notes |
|---|---|---|
| `mapped_stop_records[].id` | `raw_feature.properties.package_id` | Not identity |
| `source_layer` | `raw_feature.source_layer` | "Loop Service A…D", verbatim |
| `source_stop_code` | `raw_feature.source_code_raw` | Not unique across layers |
| `label_raw` | `raw_feature.label_raw`; seeds `stop_point.name` | Raw spelling kept |
| `longitude`, `latitude` | `raw_feature.lon/lat`; `stop_point_version.geog` | EPSG:4326, original precision |
| `route_id`, `direction` | provisional variant link on the candidate (not `route_stop`) | |
| `code_prefix_matches_layer = false` | `ingest.conflict` | |
| `curb_side`, `loading_allowed`, `unloading_allowed`, `sign_installed` | `stop_point_version` — all `NULL` | Unknown |
| `routes[].inbound/outbound/circuit_streets` | `variant_version.legal_streets` | Text, not geometry |
| `fare_rules[]` | `fare_rule` + `fare_rule_version` (draft) or `fare_observation` | `base_php × 100` → centavos |
| `terminals[]` | `transit.terminal` | Coordinates null |
| `barangay_audit[]` | `transit.coverage_audit` | 27 rows |
| `sources[]` | `ingest.source` | S01–S42 |
| `field_survey_template.csv` (45 columns) | survey mapper → `evidence` + proposed `stop_point_version` | Reviewer approval required |
