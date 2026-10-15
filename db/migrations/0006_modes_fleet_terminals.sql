-- 0006_modes_fleet_terminals.sql
-- All modes, Increment D, Task 2: the reviewed modes seed (data/source/research/naga-modes-seed-*.json)
-- lands in the same revision/provenance model as 0001/0003:
--   ingest.source            research codes N01…, the owner report U01, road snapshots OSMR-YYYY-MM-DD;
--                            publisher, licence and extra URLs of the research register;
--   ingest.conflict          the seed's conflicts register (kind research_conflict);
--   transit.route            + mode, service_status, planning (additive, backfilled here);
--   transit.variant          + name (several branch variants of one feeder route);
--   transit.variant_version  + anchors (tracing anchors of a feeder variant, Task 5);
--   transit.fare_rule_version + rule_text, notes;
--   transit.terminal_version versioned terminals (D17): the legacy terminal row stays the identity;
--                            a member with version_id = entity_id is the legacy row (old revisions);
--   transit.route_vehicle_class, route_cooperative, route_operating_status, route_fare_observation
--                            per-route records, immutable once written (a change is a new row);
--   transit.regional_service + regional_service_version.
-- No column anywhere holds a cooperative chair name or an address (C8). No e-jeepney class (user
-- decision 2026-10-16). Every new table: RLS enabled and forced, paranaga_app SELECT only,
-- paranaga_import SELECT + INSERT (no UPDATE/DELETE), paranaga_definer SELECT for publish.

-- ================================================================ ingest
alter table ingest.source drop constraint source_code_check;
alter table ingest.source add constraint source_code_check check (
  code ~ '^S[0-9]{2,3}$' or code ~ '^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or code ~ '^N[0-9]{2}$' or code ~ '^U[0-9]{2}$' or code ~ '^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$');

alter table ingest.source
  add column publisher  text,
  add column licence    text,
  add column extra_urls text[] not null default '{}' check (array_position(extra_urls, null) is null);

alter table ingest.conflict drop constraint conflict_kind_check;
alter table ingest.conflict add constraint conflict_kind_check check (kind in (
  'code_prefix_mismatch', 'exact_coordinate_shared', 'near_duplicate', 'label_variant', 'research_conflict'));

-- ================================================================ transit: routes and variants
-- Additive columns. Defaults backfill the existing rows (every existing route is an LPTRP jeepney
-- route); released revisions keep pointing at the same rows.
alter table transit.route
  add column mode text not null default 'jeepney'
    check (mode in ('jeepney', 'tricycle', 'uv_express', 'bus', 'rail')),
  add column service_status text default 'legal_plan'
    check (service_status in ('legal_plan', 'authorized_feeder', 'historical_unknown')),
  add column planning text not null default 'none' check (planning in ('provisional', 'none'));
-- NULL = not stated for rows written later; the importer always states it.
alter table transit.route alter column service_status drop default;
-- Informational only: the planner still decides from variants that have stops.
update transit.route set planning = 'provisional' where public_code in ('R8-A', 'R8-B');

-- A feeder route has several branch variants; the name tells them apart (NULL for LPTRP variants,
-- which keep their old uniqueness on route, direction and kind).
alter table transit.variant add column name text check (name is null or btrim(name) <> '');
alter table transit.variant drop constraint variant_route_id_direction_kind_key;
alter table transit.variant add constraint variant_route_direction_kind_name_uq
  unique nulls not distinct (route_id, direction, kind, name);

-- Tracing anchors of a feeder variant (junction / OSM place / named locality), verbatim from the seed.
alter table transit.variant_version add column anchors jsonb
  check (anchors is null or jsonb_typeof(anchors) = 'array');

alter table transit.fare_rule_version
  add column rule_text text,
  add column notes     text;

-- ================================================================ transit: versioned terminals (D17)
create table transit.terminal_version (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  terminal_id     uuid not null references transit.terminal (id),
  name            text not null check (btrim(name) <> ''),
  kind            text not null check (kind in ('terminal', 'loading_point', 'waiting_area', 'station')),
  location_text   text,
  modes           text[] not null check (cardinality(modes) > 0
                    and modes <@ array['jeepney', 'tricycle', 'uv_express', 'bus', 'rail']::text[]),
  modes_raw       text[] not null default '{}' check (array_position(modes_raw, null) is null),
  mode_sources    jsonb not null default '{}'::jsonb check (jsonb_typeof(mode_sources) = 'object'),
  geog            extensions.geography(Point, 4326),   -- NULL = no coordinate on file
  coord_source    text check (coord_source in ('osm_node', 'osm_way_centroid')),
  osm_type        text check (osm_type in ('node', 'way')),
  osm_id          bigint check (osm_id > 0),
  osm_version     integer check (osm_version >= 1),
  osm_timestamp   timestamptz,
  coord_note      text,
  coord_read_from text,
  verification    text not null,
  status_note     text,
  notes           text,
  source_codes    text[] not null check (cardinality(source_codes) > 0),
  content_hash    text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint terminal_version_terminal_uq unique (id, terminal_id),
  constraint terminal_version_content_uq unique (terminal_id, content_hash),
  -- A coordinate is only ever an OpenStreetMap one, with its provenance.
  constraint terminal_version_coord_provenance check (
    geog is null or (coord_source is not null and osm_type is not null and osm_id is not null)),
  constraint terminal_version_coord_source_matches check (
    coord_source is null or osm_type is null or (coord_source = 'osm_node') = (osm_type = 'node')),
  -- Same service area as stop_point_version (0001).
  constraint terminal_version_in_city check (geog is null or extensions.ST_CoveredBy(
    geog, extensions.ST_MakeEnvelope(123.05, 13.45, 123.40, 13.80, 4326)::extensions.geography))
);
create index terminal_version_terminal_idx on transit.terminal_version (terminal_id);
create index terminal_version_geog_idx on transit.terminal_version using gist (geog);

-- ================================================================ transit: per-route records
-- Unversioned (the member's version_id equals its entity_id) and immutable: a changed record is a
-- new row with a new content hash; the revision membership chooses the row.
create table transit.route_vehicle_class (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  route_id            uuid not null references transit.route (id),
  code                text not null,            -- reviewed seed code, e.g. FL-R4-MOD
  vehicle_class       text not null check (vehicle_class in (
                        'traditional_puj', 'modern_puj', 'tricycle', 'e_tricycle', 'uv_express', 'bus')),
  evidence_levels     text[] not null check (cardinality(evidence_levels) > 0
                        and evidence_levels <@ array['legal_plan', 'official_report', 'news_report', 'registry',
                          'secondary_claim', 'user_report', 'owner_confirmation']::text[]),
  status              text not null check (status in ('planned', 'reported', 'reported_not_confirmed', 'operating')),
  first_reported_on   date,
  last_reported_on    date,
  units_note          text,
  aircon              boolean,                  -- NULL = not stated by any source
  aircon_source_codes text[] not null default '{}',
  cooperatives        text[] not null default '{}',   -- names only
  conflict_notes      text[] not null default '{}',
  notes               text,
  source_codes        text[] not null check (cardinality(source_codes) > 0),
  content_hash        text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic        boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint route_vehicle_class_content_uq unique (route_id, content_hash),
  constraint route_vehicle_class_not_confirmed check (
    (status = 'reported_not_confirmed')
      = (evidence_levels <@ array['secondary_claim', 'user_report']::text[])),
  constraint route_vehicle_class_operating check (
    (status = 'operating') = ('owner_confirmation' = any (evidence_levels))),
  constraint route_vehicle_class_planned check (
    (status = 'planned') = (evidence_levels = array['legal_plan']::text[])),
  constraint route_vehicle_class_aircon_sources check (
    (aircon is null) = (cardinality(aircon_source_codes) = 0)),
  constraint route_vehicle_class_dates check (
    first_reported_on is null or last_reported_on is null or first_reported_on <= last_reported_on)
);
create index route_vehicle_class_route_idx on transit.route_vehicle_class (route_id);

-- Cooperative NAMES only (C8): there is deliberately no column for a chair name or an address.
create table transit.route_cooperative (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  route_id     uuid not null references transit.route (id),
  name         text not null check (btrim(name) <> ''),
  basis        text not null check (basis in ('corridor_reported', 'name_matches_corridor')),
  reported_on  text check (reported_on ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),   -- month or day precision
  notes        text,
  source_codes text[] not null check (cardinality(source_codes) > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint route_cooperative_content_uq unique (route_id, content_hash)
);
create index route_cooperative_route_idx on transit.route_cooperative (route_id);

-- Service status of a route (user decision 2026-10-16): confirms service only, never stop
-- locations, stop order or paths.
create table transit.route_operating_status (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  route_id         uuid not null references transit.route (id),
  operating_status text not null check (operating_status in ('operating')),
  status_note      text not null,
  confirmed_on     date not null,
  source_codes     text[] not null check (cardinality(source_codes) > 0),
  content_hash     text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic     boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint route_operating_status_content_uq unique (route_id, content_hash)
);
create index route_operating_status_route_idx on transit.route_operating_status (route_id);

-- What riders report paying in practice for one vehicle class, as a delta over the traditional
-- fare for the same trip. Never an enacted rule and never applied as one.
create table transit.route_fare_observation (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  route_id           uuid not null references transit.route (id),
  code               text not null,            -- e.g. FO-R4-MOD
  vehicle_class      text not null check (vehicle_class in (
                       'traditional_puj', 'modern_puj', 'tricycle', 'e_tricycle', 'uv_express', 'bus')),
  kind               text not null check (kind in ('reported_practice')),
  relative_to        text not null check (relative_to in ('traditional_fare')),
  delta_qualifier    text not null check (delta_qualifier in ('range', 'at_least')),
  delta_centavos_low  integer not null check (delta_centavos_low >= 0),
  delta_centavos_high integer check (delta_centavos_high >= 0),
  observed_on        date not null,
  report_text        text not null,
  notes              text,
  source_codes       text[] not null check (cardinality(source_codes) > 0),
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic       boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint route_fare_observation_content_uq unique (route_id, content_hash),
  constraint route_fare_observation_high check (
    (delta_qualifier = 'at_least') = (delta_centavos_high is null)),
  constraint route_fare_observation_order check (
    delta_centavos_high is null or delta_centavos_low <= delta_centavos_high)
);
create index route_fare_observation_route_idx on transit.route_fare_observation (route_id);

-- ================================================================ transit: regional services
create table transit.regional_service (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  code         text not null unique check (code ~ '^RS[0-9]{2}$'),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

create table transit.regional_service_version (
  id                    uuid primary key default pg_catalog.gen_random_uuid(),
  regional_service_id   uuid not null references transit.regional_service (id),
  mode                  text not null check (mode in ('uv_express', 'bus', 'jeepney')),
  name                  text not null check (btrim(name) <> ''),
  operators             text[] not null default '{}',
  terminal_code         text not null,
  terminal_note         text,
  destination           text not null,
  osm_relation_ids      bigint[] not null check (cardinality(osm_relation_ids) > 0),
  osm_relation_versions integer[],             -- D5, filled by the owner-run road fetch (Task 7)
  distance_km           numeric check (distance_km > 0),   -- NULL = distance not on file
  distance_basis        text,
  status                text not null check (status in ('community_mapped')),
  fare_rule_codes       text[] not null default '{}',
  notes                 text,
  source_codes          text[] not null check (cardinality(source_codes) > 0),
  content_hash          text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic          boolean not null default false,
  created_at            timestamptz not null default now(),
  constraint regional_service_version_service_uq unique (id, regional_service_id),
  constraint regional_service_version_content_uq unique (regional_service_id, content_hash),
  constraint regional_service_version_distance check ((distance_km is null) = (distance_basis is null))
);
create index regional_service_version_service_idx on transit.regional_service_version (regional_service_id);

-- ================================================================ membership kinds
alter table transit.revision_member drop constraint revision_member_entity_kind_check;
alter table transit.revision_member add constraint revision_member_entity_kind_check check (entity_kind in (
  'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
  'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
  'provider_presence', 'rail_status', 'designated_stop_candidate',
  'external_destination_category', 'dataset_note', 'place',
  'route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation',
  'regional_service'));

-- ================================================================ grants and RLS
-- Import: INSERT only (no UPDATE, no DELETE grant): these rows are immutable once written.
grant select, insert on
  transit.terminal_version, transit.route_vehicle_class, transit.route_cooperative,
  transit.route_operating_status, transit.route_fare_observation, transit.regional_service,
  transit.regional_service_version
  to paranaga_import;
grant select on
  transit.terminal_version, transit.route_vehicle_class, transit.route_cooperative,
  transit.route_operating_status, transit.route_fare_observation, transit.regional_service,
  transit.regional_service_version
  to paranaga_app, paranaga_definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'transit.terminal_version', 'transit.route_vehicle_class', 'transit.route_cooperative',
    'transit.route_operating_status', 'transit.route_fare_observation', 'transit.regional_service',
    'transit.regional_service_version']
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format('create policy public_read on %s for select to paranaga_app using (true)', t);
    execute format('create policy import_read on %s for select to paranaga_import using (true)', t);
    -- Always true for a new row; documents the rule as for the other version tables (0003).
    execute format(
      'create policy import_insert on %s for insert to paranaga_import with check (not transit.in_released_revision(id))', t);
    execute format('create policy definer_read on %s for select to paranaga_definer using (true)', t);
  end loop;
end
$$;

-- ================================================================ publish
-- Same function as 0003 (every check kept, in the same order) with:
--   - the new member kinds in the synthetic/missing check; 'terminal' accepts the legacy row
--     (version_id = entity_id) or a terminal_version row of that terminal;
--   - route_vehicle_class / route_cooperative / route_operating_status / route_fare_observation
--     whose route is not a member are refused, and so are two vehicle-class members for the same
--     route and class, or two operating statuses for one route;
--   - a regional_service whose terminal_code is not a member terminal, or whose fare rule codes
--     are not member fare rules, is refused.
-- CREATE OR REPLACE keeps the owner (paranaga_definer) and the EXECUTE grants.
create or replace function transit.publish_revision(p_revision uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_rev transit.revision%rowtype;
  v_old uuid;
  v_bad text;
begin
  if p_revision is null then
    raise exception 'revision id is required' using errcode = '22023';
  end if;

  -- Serializes publishes even before the pointer row exists.
  perform pg_advisory_xact_lock(hashtext('transit.publish_revision'));
  select revision_id into v_old from transit.published_pointer where singleton for update;

  select * into v_rev from transit.revision where id = p_revision for update;
  if not found then
    raise exception 'unknown revision %', p_revision using errcode = '22023';
  end if;
  if v_rev.status = 'published' then
    raise exception 'revision % is already published', p_revision using errcode = '22023';
  end if;
  if v_rev.is_synthetic then
    raise exception 'revision % is synthetic and cannot be published', p_revision using errcode = '23514';
  end if;
  if not exists (select 1 from transit.revision_member where revision_id = p_revision) then
    raise exception 'revision % has no members', p_revision using errcode = '23514';
  end if;

  -- Every member must resolve to an existing, non-synthetic row of its kind.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_kind || ':' || m.entity_id as ref
      from transit.revision_member m
     where m.revision_id = p_revision
       and (case m.entity_kind
         when 'variant' then (
           select v.is_synthetic or vv.is_synthetic
             from transit.variant_version vv join transit.variant v on v.id = vv.variant_id
            where vv.id = m.version_id and vv.variant_id = m.entity_id)
         when 'stop_point' then (
           select sp.is_synthetic or spv.is_synthetic
             from transit.stop_point_version spv join transit.stop_point sp on sp.id = spv.stop_point_id
            where spv.id = m.version_id and spv.stop_point_id = m.entity_id)
         when 'place' then (
           select p.is_synthetic or pv.is_synthetic
             from transit.place_version pv join transit.place p on p.id = pv.place_id
            where pv.id = m.version_id and pv.place_id = m.entity_id)
         when 'fare_rule' then (
           select fr.is_synthetic or frv.is_synthetic
             from transit.fare_rule_version frv join transit.fare_rule fr on fr.id = frv.fare_rule_id
            where frv.id = m.version_id and frv.fare_rule_id = m.entity_id)
         when 'terminal' then (
           case when m.version_id = m.entity_id then (
             select t.is_synthetic from transit.terminal t where t.id = m.entity_id)
           else (
             select t.is_synthetic or tv.is_synthetic
               from transit.terminal_version tv join transit.terminal t on t.id = tv.terminal_id
              where tv.id = m.version_id and tv.terminal_id = m.entity_id) end)
         when 'regional_service' then (
           select rs.is_synthetic or rsv.is_synthetic
             from transit.regional_service_version rsv join transit.regional_service rs on rs.id = rsv.regional_service_id
            where rsv.id = m.version_id and rsv.regional_service_id = m.entity_id)
         else case when m.version_id <> m.entity_id then null else (case m.entity_kind
           when 'route' then (select t.is_synthetic from transit.route t where t.id = m.entity_id)
           when 'route_alias' then (select t.is_synthetic from transit.route_alias t where t.id = m.entity_id)
           when 'fare_observation' then (select t.is_synthetic from transit.fare_observation t where t.id = m.entity_id)
           when 'fare_conflict' then (select t.is_synthetic from transit.fare_conflict t where t.id = m.entity_id)
           when 'barangay' then (select t.is_synthetic from transit.barangay t where t.id = m.entity_id)
           when 'coverage_audit' then (select t.is_synthetic from transit.coverage_audit t where t.id = m.entity_id)
           when 'feeder_lead' then (select t.is_synthetic from transit.feeder_lead t where t.id = m.entity_id)
           when 'provider_presence' then (select t.is_synthetic from transit.provider_presence t where t.id = m.entity_id)
           when 'rail_status' then (select t.is_synthetic from transit.rail_status t where t.id = m.entity_id)
           when 'designated_stop_candidate' then (select t.is_synthetic from transit.designated_stop_candidate t where t.id = m.entity_id)
           when 'external_destination_category' then (select t.is_synthetic from transit.external_destination_category t where t.id = m.entity_id)
           when 'dataset_note' then (select t.is_synthetic from transit.dataset_note t where t.id = m.entity_id)
           when 'route_vehicle_class' then (select t.is_synthetic from transit.route_vehicle_class t where t.id = m.entity_id)
           when 'route_cooperative' then (select t.is_synthetic from transit.route_cooperative t where t.id = m.entity_id)
           when 'route_operating_status' then (select t.is_synthetic from transit.route_operating_status t where t.id = m.entity_id)
           when 'route_fare_observation' then (select t.is_synthetic from transit.route_fare_observation t where t.id = m.entity_id)
         end) end
       end) is distinct from false
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has synthetic or missing members: %', p_revision, v_bad using errcode = '23514';
  end if;

  -- Stop sequences of the revision's variant versions.
  select string_agg(x.ref, ', ') into v_bad from (
    select rs.variant_version_id || '#' || rs.seq as ref
      from transit.revision_member m
      join transit.route_stop rs on rs.variant_version_id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'variant' and rs.is_synthetic
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has synthetic route stops: %', p_revision, v_bad using errcode = '23514';
  end if;

  select string_agg(x.ref, ', ') into v_bad from (
    select distinct vv.id::text as ref
      from transit.revision_member m
      join transit.variant_version vv on vv.id = m.version_id
      join transit.route_stop rs on rs.variant_version_id = vv.id
     where m.revision_id = p_revision and m.entity_kind = 'variant'
       and rs.evidence_level = 'provisional' and vv.evidence_level <> 'provisional'
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has provisional stops on non-provisional variant versions: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  if v_rev.kind = 'verified' and exists (
    select 1
      from transit.revision_member m
      join transit.variant_version vv on vv.id = m.version_id
      left join transit.route_stop rs on rs.variant_version_id = vv.id
     where m.revision_id = p_revision and m.entity_kind = 'variant'
       and (vv.evidence_level = 'provisional' or rs.evidence_level = 'provisional')) then
    raise exception 'verified revision % contains provisional variants or stops', p_revision using errcode = '23514';
  end if;

  select string_agg(x.ref, ', ') into v_bad from (
    select rs.variant_version_id::text as ref
      from transit.revision_member m
      join transit.route_stop rs on rs.variant_version_id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'variant'
     group by rs.variant_version_id
    having min(rs.seq) <> 1 or max(rs.seq) <> count(*)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has stop seq not contiguous from 1 in variant versions: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- Each member variant's route must be a member of this revision too.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id::text as ref
      from transit.revision_member m
      join transit.variant v on v.id = m.entity_id
     where m.revision_id = p_revision and m.entity_kind = 'variant'
       and not exists (
         select 1 from transit.revision_member rm
          where rm.revision_id = p_revision and rm.entity_kind = 'route' and rm.entity_id = v.route_id)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has variants whose route is not a member: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- Each route stop must use the stop point version that is a member of this revision.
  select string_agg(x.ref, ', ') into v_bad from (
    select rs.variant_version_id || '#' || rs.seq as ref
      from transit.revision_member m
      join transit.route_stop rs on rs.variant_version_id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'variant'
       and not exists (
         select 1 from transit.revision_member sm
          where sm.revision_id = p_revision and sm.entity_kind = 'stop_point'
            and sm.version_id = rs.stop_point_version_id)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has route stops whose stop point version is not a member: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0006: per-route records (vehicle classes, cooperatives, operating status, fare observations)
  -- must belong to a member route.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_kind || ':' || m.entity_id as ref
      from transit.revision_member m
      join lateral (
        select t.route_id from transit.route_vehicle_class t where m.entity_kind = 'route_vehicle_class' and t.id = m.entity_id
        union all
        select t.route_id from transit.route_cooperative t where m.entity_kind = 'route_cooperative' and t.id = m.entity_id
        union all
        select t.route_id from transit.route_operating_status t where m.entity_kind = 'route_operating_status' and t.id = m.entity_id
        union all
        select t.route_id from transit.route_fare_observation t where m.entity_kind = 'route_fare_observation' and t.id = m.entity_id
      ) r on true
     where m.revision_id = p_revision
       and m.entity_kind in ('route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation')
       and not exists (
         select 1 from transit.revision_member rm
          where rm.revision_id = p_revision and rm.entity_kind = 'route' and rm.entity_id = r.route_id)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has route records whose route is not a member: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0006: one vehicle-class record per route and class, one operating status per route.
  select string_agg(x.ref, ', ') into v_bad from (
    select t.route_id || '/' || t.vehicle_class as ref
      from transit.revision_member m
      join transit.route_vehicle_class t on t.id = m.entity_id
     where m.revision_id = p_revision and m.entity_kind = 'route_vehicle_class'
     group by t.route_id, t.vehicle_class
    having count(*) > 1
    union all
    select t.route_id || '/operating_status' as ref
      from transit.revision_member m
      join transit.route_operating_status t on t.id = m.entity_id
     where m.revision_id = p_revision and m.entity_kind = 'route_operating_status'
     group by t.route_id
    having count(*) > 1
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has duplicate route records: %', p_revision, v_bad using errcode = '23514';
  end if;

  -- 0006: a regional service's terminal and fare rules must be members of this revision.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id || ' terminal ' || rsv.terminal_code as ref
      from transit.revision_member m
      join transit.regional_service_version rsv on rsv.id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'regional_service'
       and not exists (
         select 1 from transit.revision_member tm join transit.terminal t on t.id = tm.entity_id
          where tm.revision_id = p_revision and tm.entity_kind = 'terminal' and t.code = rsv.terminal_code)
    union all
    select m.entity_id || ' fare rule ' || c.code as ref
      from transit.revision_member m
      join transit.regional_service_version rsv on rsv.id = m.version_id
      cross join lateral unnest(rsv.fare_rule_codes) as c(code)
     where m.revision_id = p_revision and m.entity_kind = 'regional_service'
       and not exists (
         select 1 from transit.revision_member fm join transit.fare_rule f on f.id = fm.entity_id
          where fm.revision_id = p_revision and fm.entity_kind = 'fare_rule' and f.code = c.code)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has regional services whose terminal or fare rule is not a member: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  update transit.revision set status = 'superseded' where status = 'published';
  update transit.revision
     set status = 'published', published_at = now(), published_by = core.current_user_id()
   where id = p_revision;
  insert into transit.published_pointer (singleton, revision_id) values (true, p_revision)
  on conflict (singleton) do update set revision_id = excluded.revision_id, updated_at = now();

  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, before, after, request_id)
  values (core.current_user_id(),
          case when core.current_user_id() is null then 'system' else 'user' end,
          case when v_rev.status = 'superseded' then 'revision.rollback' else 'revision.publish' end,
          'transit.revision', p_revision::text,
          case when v_old is null then null else jsonb_build_object('revision_id', v_old) end,
          jsonb_build_object('revision_id', p_revision, 'label', v_rev.label, 'kind', v_rev.kind,
                             'db_role', session_user),
          core.current_request_id());
end
$$;

revoke execute on function transit.publish_revision(uuid) from public;
