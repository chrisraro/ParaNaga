-- 0029_intercity_ic1.sql
-- IC1 "Leaving Naga" guide (docs/plans/2026-10-28-intercity-ic1-plan.md Task 1; design
-- docs/plans/2026-10-28-intercity-design.md §3). Additive: every existing row stays valid.
--   - ingest.source accepts the intercity research codes IC01… (the research doc's R1–R35; R-codes
--     clash with the R[TLPH] families). evidence_type has no CHECK (0001), so the new values
--     booking_site and travel_guide need no DDL;
--   - transit.regional_service_version: modes rail and air; statuses operating, operating_limited,
--     suspended, discontinued_reported, unconfirmed; status_since, status_note_code, as_of,
--     review_by, destination_codes, access_note_code. OSM relations may be empty, but only when no
--     distance is on file. Dates are required off community_mapped; a suspended or discontinued
--     service has a status date and no fare rules; rail and air never use per-km fare rules;
--   - transit.terminal_version: kind airport and mode air;
--   - transit.regional_destination (+ _version, membership kind regional_destination): named
--     towns and hubs outside Naga with no coordinate in IC1 (design §3.1);
--   - transit.regional_departure: departure facts, child rows of one regional_service_version;
--   - transit.fare_observation: regional fare observations hang off the service version
--     (regional_service_version_id, not a membership), with a basis and the month observed;
--   - transit.regional_child_running_guard(): no departures or fares under a suspended or
--     discontinued service (AC-IC2); publish_revision repeats the rule as a backstop;
--   - publish_revision (0010 function, every check kept in order) also checks regional_destination
--     members and that every destination code of a member service is a member destination;
--   - admin_validation_facts (0024 function, unchanged otherwise) adds regional_destination to the
--     members and the regionalServices / regionalDestinations facts;
--   - published views for destinations, departures and observations; v_published_regional_services
--     gains the new columns; v_published_sources cites them and the intercity_* dataset notes.
-- Same RLS pattern as 0006/0010: enabled and forced, paranaga_app SELECT only, paranaga_import
-- SELECT + INSERT, paranaga_definer SELECT.

grant create on schema transit to paranaga_definer;

-- ================================================================ ingest
alter table ingest.source drop constraint source_code_check;
alter table ingest.source add constraint source_code_check check (
  code ~ '^S[0-9]{2,3}$' or code ~ '^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or code ~ '^N[0-9]{2}$' or code ~ '^U[0-9]{2}$' or code ~ '^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or code ~ '^R[TLPH][0-9]{2}$' or code ~ '^IC[0-9]{2}$');

-- ================================================================ regional services
alter table transit.regional_service_version drop constraint regional_service_version_mode_check;
alter table transit.regional_service_version add constraint regional_service_version_mode_check
  check (mode in ('uv_express', 'bus', 'jeepney', 'rail', 'air'));
alter table transit.regional_service_version drop constraint regional_service_version_status_check;
alter table transit.regional_service_version add constraint regional_service_version_status_check
  check (status in ('community_mapped', 'operating', 'operating_limited', 'suspended', 'discontinued_reported', 'unconfirmed'));
alter table transit.regional_service_version drop constraint regional_service_version_osm_relation_ids_check;
alter table transit.regional_service_version add constraint rsv_osm_or_no_distance
  check (cardinality(osm_relation_ids) > 0 or distance_km is null);

alter table transit.regional_service_version
  add column status_since      date,
  add column status_note_code  text,
  add column as_of             date,
  add column review_by         date,
  add column destination_codes text[] not null default '{}' check (array_position(destination_codes, null) is null),
  add column access_note_code  text;

-- planned_not_funded is a rail-status note, never a service note (AC-IC3).
alter table transit.regional_service_version add constraint rsv_status_note_code check (status_note_code is null
  or status_note_code in ('bridge_damage_no_reopening_date', 'stopped_no_resumption_found', 'limited_trips'));
alter table transit.regional_service_version add constraint rsv_access_note_code check (access_note_code is null
  or access_note_code in ('airport_walk_to_maharlika'));
alter table transit.regional_service_version add constraint rsv_dates_required
  check (status = 'community_mapped' or (as_of is not null and review_by is not null));
alter table transit.regional_service_version add constraint rsv_review_after_as_of
  check (review_by >= as_of);
alter table transit.regional_service_version add constraint rsv_status_since
  check (status not in ('suspended', 'discontinued_reported') or status_since is not null);
alter table transit.regional_service_version add constraint rsv_not_running_no_fare
  check (status not in ('suspended', 'discontinued_reported') or cardinality(fare_rule_codes) = 0);
alter table transit.regional_service_version add constraint rsv_rail_air_no_rules
  check (mode not in ('rail', 'air') or cardinality(fare_rule_codes) = 0);

-- ================================================================ terminals
alter table transit.terminal_version drop constraint terminal_version_kind_check;
alter table transit.terminal_version add constraint terminal_version_kind_check
  check (kind in ('terminal', 'loading_point', 'waiting_area', 'station', 'airport'));
alter table transit.terminal_version drop constraint terminal_version_modes_check;
alter table transit.terminal_version add constraint terminal_version_modes_check check (cardinality(modes) > 0
  and modes <@ array['jeepney', 'tricycle', 'uv_express', 'bus', 'rail', 'air']::text[]);

-- ================================================================ destinations (versioned)
create table transit.regional_destination (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  code         text not null unique check (code ~ '^D-[A-Z0-9-]{2,30}$'),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

create table transit.regional_destination_version (
  id                      uuid primary key default pg_catalog.gen_random_uuid(),
  regional_destination_id uuid not null references transit.regional_destination (id),
  name                    text not null check (btrim(name) <> ''),
  aliases                 text[] not null default '{}'
                            check (cardinality(aliases) <= 10 and array_position(aliases, null) is null),
  group_code              text not null check (group_code in
                            ('partido', 'rinconada', 'albay', 'sorsogon', 'cam_norte', 'nw_camsur', 'manila', 'luzon_air')),
  psgc_code               text check (psgc_code ~ '^[0-9]{10}$'),
  kind                    text not null check (kind in ('town', 'hub', 'airport', 'station')),
  geog                    extensions.geography(Point, 4326) check (geog is null),   -- IC1: no coordinate (design §3.1)
  source_codes            text[] not null check (cardinality(source_codes) > 0 and array_position(source_codes, null) is null),
  content_hash            text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic            boolean not null default false,
  created_at              timestamptz not null default now(),
  constraint regional_destination_version_destination_uq unique (id, regional_destination_id),
  -- Also the foreign-key index (leading column).
  constraint regional_destination_version_content_uq unique (regional_destination_id, content_hash)
);

-- ================================================================ departures (children of a service version)
create table transit.regional_departure (
  id                          uuid primary key default pg_catalog.gen_random_uuid(),
  regional_service_version_id uuid not null references transit.regional_service_version (id),
  pattern       text not null check (pattern in ('listed_times', 'headway_rule', 'when_full', 'operating_hours', 'daily_unspecified')),
  times         time[] not null default '{}' check (array_position(times, null) is null),
  headway_min   smallint check (headway_min > 0),
  start_time    time,
  end_time      time,
  trips_per_day smallint check (trips_per_day > 0),
  day_type      text not null check (day_type in ('daily', 'weekdays', 'weekends', 'unspecified')),
  basis         text not null check (basis in ('official', 'terminal_rule', 'booking_site', 'news', 'at_launch', 'travel_guide')),
  observed_on   date not null,
  source_codes  text[] not null check (cardinality(source_codes) > 0 and array_position(source_codes, null) is null),
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint regional_departure_headway check (pattern <> 'headway_rule' or headway_min is not null),
  constraint regional_departure_listed check (pattern <> 'listed_times' or cardinality(times) > 0),
  constraint regional_departure_hours check (pattern <> 'operating_hours' or (start_time is not null and end_time is not null))
);
create index regional_departure_version_idx on transit.regional_departure (regional_service_version_id);

-- ================================================================ fare observations of a service version
alter table transit.fare_observation drop constraint fare_observation_kind_check;
alter table transit.fare_observation add constraint fare_observation_kind_check check (kind in
  ('official_matrix', 'charged_fare', 'estimate', 'exclusive_quote', 'reported_practice', 'operator_listing'));
alter table transit.fare_observation
  add column regional_service_version_id uuid references transit.regional_service_version (id),
  add column destination_code            text,
  add column seat_class_text             text check (char_length(seat_class_text) <= 40),
  add column amount_high_centavos        integer,
  add column basis                       text check (basis in ('official', 'booking_site', 'travel_guide', 'at_launch'));
alter table transit.fare_observation
  add constraint fo_regional_basis check ((regional_service_version_id is null) = (basis is null)),
  add constraint fo_regional_month check (regional_service_version_id is null or observed_at is not null),
  add constraint fo_high check (amount_high_centavos is null or amount_high_centavos >= amount_centavos);
create index fare_observation_regional_idx on transit.fare_observation (regional_service_version_id)
  where regional_service_version_id is not null;

-- ================================================================ running guard (AC-IC2)
-- Invoker rights: the inserting role (paranaga_import) reads the parent version through its own
-- SELECT grant and import_read policy.
create or replace function transit.regional_child_running_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, transit, pg_temp
as $$
begin
  if exists (select 1 from transit.regional_service_version v
              where v.id = new.regional_service_version_id
                and v.status in ('suspended', 'discontinued_reported')) then
    raise exception 'suspended or discontinued services carry no fares or departures' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function transit.regional_child_running_guard() from public;

create trigger regional_departure_running_guard before insert on transit.regional_departure
  for each row execute function transit.regional_child_running_guard();
create trigger fare_observation_running_guard before insert on transit.fare_observation
  for each row when (new.regional_service_version_id is not null)
  execute function transit.regional_child_running_guard();

-- A released service version keeps its children as published (deviation 2: they are covered by
-- the version's content hash). paranaga_import has no UPDATE or DELETE grant on
-- regional_departure and no DELETE grant on fare_observation; its UPDATE on fare_observation
-- (0001 import_update_unreleased, keyed on the row's own id, which a regional observation never
-- is a member under) is narrowed here, like the 0026 restrictive policies: no edit of an
-- observation of a published or superseded version, and none that moves a row onto one.
create policy import_update_regional_unreleased on transit.fare_observation as restrictive
  for update to paranaga_import
  using (regional_service_version_id is null or not transit.in_released_revision(regional_service_version_id))
  with check (regional_service_version_id is null or not transit.in_released_revision(regional_service_version_id));

-- ================================================================ membership kinds
alter table transit.revision_member drop constraint revision_member_entity_kind_check;
alter table transit.revision_member add constraint revision_member_entity_kind_check check (entity_kind in (
  'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
  'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
  'provider_presence', 'rail_status', 'designated_stop_candidate',
  'external_destination_category', 'dataset_note', 'place',
  'route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation',
  'regional_service', 'shape', 'walk_graph', 'eta_param', 'route_note', 'regional_destination'));

-- ================================================================ grants and RLS
-- Import: INSERT only (no UPDATE, no DELETE grant): these rows are immutable once written.
grant select, insert on transit.regional_destination, transit.regional_destination_version, transit.regional_departure
  to paranaga_import;
grant select on transit.regional_destination, transit.regional_destination_version, transit.regional_departure
  to paranaga_app, paranaga_definer;

alter table transit.regional_destination enable row level security;
alter table transit.regional_destination force row level security;
create policy public_read on transit.regional_destination for select to paranaga_app using (true);
create policy import_read on transit.regional_destination for select to paranaga_import using (true);
-- Always true for a new row; documents the rule as for the other version tables (0003, 0006, 0010).
create policy import_insert on transit.regional_destination for insert to paranaga_import
  with check (not transit.in_released_revision(id));
create policy definer_read on transit.regional_destination for select to paranaga_definer using (true);

alter table transit.regional_destination_version enable row level security;
alter table transit.regional_destination_version force row level security;
create policy public_read on transit.regional_destination_version for select to paranaga_app using (true);
create policy import_read on transit.regional_destination_version for select to paranaga_import using (true);
create policy import_insert on transit.regional_destination_version for insert to paranaga_import
  with check (not transit.in_released_revision(id));
create policy definer_read on transit.regional_destination_version for select to paranaga_definer using (true);

alter table transit.regional_departure enable row level security;
alter table transit.regional_departure force row level security;
create policy public_read on transit.regional_departure for select to paranaga_app using (true);
create policy import_read on transit.regional_departure for select to paranaga_import using (true);
-- Like route_stop (0001): no departures may be added to a service version that is already
-- published or superseded.
create policy import_insert on transit.regional_departure for insert to paranaga_import
  with check (not transit.in_released_revision(regional_service_version_id));
create policy definer_read on transit.regional_departure for select to paranaga_definer using (true);

-- ================================================================ publish
-- Same function as 0010 (every check kept, in the same order) with regional_destination added to
-- the synthetic/missing check, then two new checks: destination codes name member destinations,
-- and no departures or fare observations under a suspended or discontinued member service.
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
         when 'shape' then (
           select s.is_synthetic or sv.is_synthetic
             from transit.shape_version sv join transit.shape s on s.id = sv.shape_id
            where sv.id = m.version_id and sv.shape_id = m.entity_id)
         when 'walk_graph' then (
           select g.is_synthetic or gv.is_synthetic
             from transit.walk_graph_version gv join transit.walk_graph g on g.id = gv.walk_graph_id
            where gv.id = m.version_id and gv.walk_graph_id = m.entity_id)
         when 'eta_param' then (
           select p.is_synthetic or pv.is_synthetic
             from transit.eta_param_version pv join transit.eta_param p on p.id = pv.eta_param_id
            where pv.id = m.version_id and pv.eta_param_id = m.entity_id)
         when 'regional_destination' then (
           select d.is_synthetic or dv.is_synthetic
             from transit.regional_destination_version dv join transit.regional_destination d on d.id = dv.regional_destination_id
            where dv.id = m.version_id and dv.regional_destination_id = m.entity_id)
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
           when 'route_note' then (select t.is_synthetic from transit.route_note t where t.id = m.entity_id)
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

  -- 0006/0010: per-route records (vehicle classes, cooperatives, operating status, fare observations,
  -- route notes) must belong to a member route.
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
        union all
        select t.route_id from transit.route_note t where m.entity_kind = 'route_note' and t.id = m.entity_id
      ) r on true
     where m.revision_id = p_revision
       and m.entity_kind in ('route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation', 'route_note')
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

  -- 0007: a shape follows the member version of a member variant.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id::text as ref
      from transit.revision_member m
      join transit.shape s on s.id = m.entity_id
      join transit.shape_version sv on sv.id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'shape'
       and not exists (
         select 1 from transit.revision_member vm
          where vm.revision_id = p_revision and vm.entity_kind = 'variant'
            and vm.entity_id = s.variant_id and vm.version_id = sv.variant_version_id)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has shapes whose variant (version) is not a member: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0007: stop measures name route stops (seq + stop point version) of the shape's variant version,
  -- and a traced shape of a variant version with stops measures every stop.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id || '#' || coalesce(e.value->>'seq', '?') as ref
      from transit.revision_member m
      join transit.shape_version sv on sv.id = m.version_id
      cross join lateral jsonb_array_elements(coalesce(sv.stop_measures, '[]'::jsonb)) e
     where m.revision_id = p_revision and m.entity_kind = 'shape'
       and not exists (
         select 1 from transit.route_stop rs
          where rs.variant_version_id = sv.variant_version_id
            and jsonb_typeof(e.value->'seq') = 'number' and rs.seq = (e.value->>'seq')::numeric
            and rs.stop_point_version_id::text = e.value->>'stopPointVersionId')
    union all
    select m.entity_id || ' measures ' || coalesce(jsonb_array_length(sv.stop_measures), 0) || ' of '
             || (select count(*) from transit.route_stop rs where rs.variant_version_id = sv.variant_version_id) as ref
      from transit.revision_member m
      join transit.shape_version sv on sv.id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'shape' and sv.trace_status <> 'untraced'
       and coalesce(jsonb_array_length(sv.stop_measures), 0)
           <> (select count(*) from transit.route_stop rs where rs.variant_version_id = sv.variant_version_id)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has shape stop measures that do not match the member stops: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0007: one walk graph at most.
  if (select count(*) from transit.revision_member
       where revision_id = p_revision and entity_kind = 'walk_graph') > 1 then
    raise exception 'revision % has more than one walk graph', p_revision using errcode = '23514';
  end if;

  -- 0007: time-estimate parameters are all-or-nothing: each of the five keys exactly once.
  select string_agg(x.ref, ', ') into v_bad from (
    select k.key || ' x' || count(p.id) as ref
      from unnest(array['walk_speed_kmh', 'walk_slowdown_factor', 'jeepney_speed_offpeak_kmh',
                        'jeepney_speed_peak_kmh', 'peak_windows']) as k(key)
      left join transit.eta_param p on p.key = k.key
       and exists (select 1 from transit.revision_member m
                    where m.revision_id = p_revision and m.entity_kind = 'eta_param' and m.entity_id = p.id)
     group by k.key
    having count(p.id) <> 1
     order by 1) x
   where exists (select 1 from transit.revision_member
                  where revision_id = p_revision and entity_kind = 'eta_param');
  if v_bad is not null then
    raise exception 'revision % has an incomplete set of time-estimate parameters: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0029: every destination code of a member regional service names a member destination.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id || ' destination ' || c.code as ref
      from transit.revision_member m
      join transit.regional_service_version rsv on rsv.id = m.version_id
      cross join lateral unnest(rsv.destination_codes) as c(code)
     where m.revision_id = p_revision and m.entity_kind = 'regional_service'
       and not exists (
         select 1 from transit.revision_member dm join transit.regional_destination d on d.id = dm.entity_id
          where dm.revision_id = p_revision and dm.entity_kind = 'regional_destination' and d.code = c.code)
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has regional services with an unknown destination code: %', p_revision, v_bad
      using errcode = '23514';
  end if;

  -- 0029: no departures or fare observations under a suspended or discontinued member service.
  select string_agg(x.ref, ', ') into v_bad from (
    select m.entity_id || ' ' || rsv.status as ref
      from transit.revision_member m
      join transit.regional_service_version rsv on rsv.id = m.version_id
     where m.revision_id = p_revision and m.entity_kind = 'regional_service'
       and rsv.status in ('suspended', 'discontinued_reported')
       and (exists (select 1 from transit.regional_departure d where d.regional_service_version_id = rsv.id)
            or exists (select 1 from transit.fare_observation o where o.regional_service_version_id = rsv.id))
     order by 1 limit 5) x;
  if v_bad is not null then
    raise exception 'revision % has suspended or discontinued services with fares or departures: %', p_revision, v_bad
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

alter function transit.publish_revision(uuid) owner to paranaga_definer;
revoke execute on function transit.publish_revision(uuid) from public;

-- ---------------------------------------------------------------- validation facts (C8 + the intercity rules)
-- Same as 0024 plus regional_destination members and the intercity facts the publication rules
-- read (src/domain/admin): per member service its status, dates, destinations, source evidence
-- types and child counts; per member destination the number of member services that name it.
create or replace function transit.admin_validation_facts(p_revision uuid) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_rev transit.revision%rowtype;
  v_check jsonb;
begin
  perform transit.admin_assert_staff();
  select * into v_rev from transit.revision r where r.id = p_revision;
  if not found then
    raise exception 'unknown revision' using errcode = '22023';
  end if;

  -- Dry run: transit.publish_revision's own checks, rolled back whatever happens (the inner block
  -- is a subtransaction; the sentinel exception undoes a run that passed).
  begin
    perform transit.publish_revision(p_revision);
    raise exception 'paranaga:dry-run' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'paranaga:dry-run' then
        v_check := jsonb_build_object('ok', true);
      else
        v_check := jsonb_build_object('ok', false, 'code', sqlstate, 'message', left(sqlerrm, 500));
      end if;
    when sqlstate '23514' or sqlstate '22023' then
      v_check := jsonb_build_object('ok', false, 'code', sqlstate, 'message', left(sqlerrm, 500));
  end;

  return jsonb_build_object(
    'revision', jsonb_build_object('id', v_rev.id, 'label', v_rev.label, 'kind', v_rev.kind,
                  'status', v_rev.status, 'isSynthetic', v_rev.is_synthetic),
    'membershipHash', transit.revision_membership_hash(p_revision),
    'dbCheck', v_check,
    -- 0029 (IC1): the intercity facts.
    'regionalServices', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'status', v.status, 'mode', v.mode,
               'terminalCode', v.terminal_code, 'asOf', v.as_of, 'reviewBy', v.review_by,
               'statusNoteCode', v.status_note_code, 'destinationCodes', to_jsonb(v.destination_codes),
               'sourceEvidenceTypes', coalesce((select jsonb_agg(distinct src.evidence_type) from ingest.source src
                                                 where src.code = any (v.source_codes) and src.evidence_type is not null),
                                               '[]'::jsonb),
               'departureCount', (select count(*) from transit.regional_departure d where d.regional_service_version_id = v.id),
               'observationCount', (select count(*) from transit.fare_observation o where o.regional_service_version_id = v.id),
               'observationsWithoutMonth', (select count(*) from transit.fare_observation o
                                             where o.regional_service_version_id = v.id and o.observed_at is null))
             order by s.code)
        from transit.revision_member m
        join transit.regional_service s on s.id = m.entity_id
        join transit.regional_service_version v on v.id = m.version_id and v.regional_service_id = s.id
       where m.revision_id = p_revision and m.entity_kind = 'regional_service'), '[]'::jsonb),
    'regionalDestinations', coalesce((
      select jsonb_agg(jsonb_build_object('code', d.code, 'serviceCount', (
               select count(*) from transit.revision_member sm
                 join transit.regional_service_version v on v.id = sm.version_id
                where sm.revision_id = p_revision and sm.entity_kind = 'regional_service'
                  and d.code = any (v.destination_codes))) order by d.code)
        from transit.revision_member m
        join transit.regional_destination d on d.id = m.entity_id
       where m.revision_id = p_revision and m.entity_kind = 'regional_destination'), '[]'::jsonb),
    -- Every member with a readable code and its synthetic flag (stable row OR version row);
    -- null when the member's row is missing. Same cases as transit.publish_revision (0010).
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'code', x.code, 'isSynthetic', x.syn) order by x.kind, x.code)
        from (
          select m.entity_kind as kind,
                 coalesce(case m.entity_kind
                   when 'route' then (select r.public_code from transit.route r where r.id = m.entity_id)
                   when 'variant' then (
                     select r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end
                       from transit.variant v join transit.route r on r.id = v.route_id where v.id = m.entity_id)
                   when 'stop_point' then (
                     select coalesce(spv.source_layer || ' ' || spv.source_code_raw, sp.name)
                       from transit.stop_point_version spv join transit.stop_point sp on sp.id = spv.stop_point_id
                      where spv.id = m.version_id)
                   when 'fare_rule' then (select f.code from transit.fare_rule f where f.id = m.entity_id)
                   when 'terminal' then (select t.code from transit.terminal t where t.id = m.entity_id)
                   when 'barangay' then (select b.name from transit.barangay b where b.id = m.entity_id)
                   when 'route_note' then (select n.note_code from transit.route_note n where n.id = m.entity_id)
                   when 'regional_destination' then (select d.code from transit.regional_destination d where d.id = m.entity_id)
                 end, m.entity_id::text) as code,
                 (case m.entity_kind
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
                   when 'shape' then (
                     select s.is_synthetic or sv.is_synthetic
                       from transit.shape_version sv join transit.shape s on s.id = sv.shape_id
                      where sv.id = m.version_id and sv.shape_id = m.entity_id)
                   when 'walk_graph' then (
                     select g.is_synthetic or gv.is_synthetic
                       from transit.walk_graph_version gv join transit.walk_graph g on g.id = gv.walk_graph_id
                      where gv.id = m.version_id and gv.walk_graph_id = m.entity_id)
                   when 'eta_param' then (
                     select p.is_synthetic or pv.is_synthetic
                       from transit.eta_param_version pv join transit.eta_param p on p.id = pv.eta_param_id
                      where pv.id = m.version_id and pv.eta_param_id = m.entity_id)
                   when 'regional_destination' then (
                     select d.is_synthetic or dv.is_synthetic
                       from transit.regional_destination_version dv join transit.regional_destination d on d.id = dv.regional_destination_id
                      where dv.id = m.version_id and dv.regional_destination_id = m.entity_id)
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
                     when 'route_note' then (select t.is_synthetic from transit.route_note t where t.id = m.entity_id)
                   end) end
                 end) as syn
            from transit.revision_member m
           where m.revision_id = p_revision) x), '[]'::jsonb),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object('stopPointId', spv.stop_point_id, 'layer', spv.source_layer,
               'code', spv.source_code_raw, 'name', coalesce(spv.name, sp.name),
               'lat', extensions.ST_Y(spv.geog::extensions.geometry), 'lng', extensions.ST_X(spv.geog::extensions.geometry),
               -- 0024 (N5b): what the stop rules need.
               'status', spv.status, 'curbSide', spv.curb_side,
               'evidenceClaims', coalesce((select jsonb_agg(distinct l.claim) from transit.evidence_link l
                                            where l.stop_point_version_id = spv.id), '[]'::jsonb),
               'movedM', (select round(extensions.ST_Distance(pv.geog, spv.geog)::numeric, 1)
                            from transit.revision_member pm
                            join transit.stop_point_version pv on pv.id = pm.version_id
                           where pm.revision_id = v_rev.parent_revision_id and pm.entity_kind = 'stop_point'
                             and pm.entity_id = spv.stop_point_id and pm.version_id <> spv.id),
               'inSequence', exists (select 1 from transit.revision_member vm
                                      join transit.route_stop rs on rs.variant_version_id = vm.version_id
                                     where vm.revision_id = p_revision and vm.entity_kind = 'variant'
                                       and rs.stop_point_version_id = spv.id)))
        from transit.revision_member m
        join transit.stop_point_version spv on spv.id = m.version_id
        join transit.stop_point sp on sp.id = spv.stop_point_id
       where m.revision_id = p_revision and m.entity_kind = 'stop_point'), '[]'::jsonb),
    'terminals', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code,
               'lat', extensions.ST_Y(g.geog::extensions.geometry), 'lng', extensions.ST_X(g.geog::extensions.geometry)))
        from transit.revision_member m
        join transit.terminal t on t.id = m.entity_id
        left join transit.terminal_version tv on tv.id = m.version_id and tv.terminal_id = t.id
        cross join lateral (select coalesce(tv.geog, t.geog) as geog) g
       where m.revision_id = p_revision and m.entity_kind = 'terminal' and g.geog is not null), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'kind', v.kind, 'trialStatus', vv.trial_status, 'effectiveFrom', vv.effective_from,
               'trialDurationDays', vv.trial_duration_days, 'evidenceLevel', vv.evidence_level,
               'hasFareEvidence', (
                 exists (select 1 from transit.revision_member fm join transit.route_fare_observation o on o.id = fm.entity_id
                          where fm.revision_id = p_revision and fm.entity_kind = 'route_fare_observation' and o.route_id = r.id)
                 or exists (select 1 from transit.revision_member fm join transit.fare_rule f on f.id = fm.entity_id
                             where fm.revision_id = p_revision and fm.entity_kind = 'fare_rule'
                               and r.mode_code is not null and f.mode_code = r.mode_code))))
        from transit.revision_member m
        join transit.variant v on v.id = m.entity_id
        join transit.variant_version vv on vv.id = m.version_id and vv.variant_id = v.id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'variant'), '[]'::jsonb),
    'routeStops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variantRef', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'seq', rs.seq, 'distAlongM', rs.dist_along_m) order by rs.variant_version_id, rs.seq)
        from transit.revision_member m
        join transit.route_stop rs on rs.variant_version_id = m.version_id
        join transit.variant v on v.id = m.entity_id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'variant' and rs.dist_along_m is not null), '[]'::jsonb),
    'shapes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variantRef', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'traceStatus', sv.trace_status, 'untracedReason', sv.untraced_reason,
               'measures', coalesce((select jsonb_agg(jsonb_build_object('seq', e.value -> 'seq', 'measureM', e.value -> 'measureM'))
                                       from jsonb_array_elements(coalesce(sv.stop_measures, '[]'::jsonb)) e), '[]'::jsonb)))
        from transit.revision_member m
        join transit.shape s on s.id = m.entity_id
        join transit.shape_version sv on sv.id = m.version_id and sv.shape_id = s.id
        join transit.variant v on v.id = s.variant_id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'shape'), '[]'::jsonb));
end;
$$;
alter function transit.admin_validation_facts(uuid) owner to paranaga_definer;
revoke execute on function transit.admin_validation_facts(uuid) from public;
grant execute on function transit.admin_validation_facts(uuid) to paranaga_app;

-- ================================================================ published read model
-- 0008 view with the 0029 columns appended (create or replace keeps the existing columns first).
create or replace view transit.v_published_regional_services with (security_invoker = true) as
select pp.revision_id, s.id as regional_service_id, v.id as regional_service_version_id, s.code, v.mode, v.name,
       v.operators, v.terminal_code, v.terminal_note, v.destination, v.osm_relation_ids, v.osm_relation_versions,
       v.distance_km, v.distance_basis, v.status, v.fare_rule_codes, v.notes, v.source_codes,
       v.status_since, v.status_note_code, v.as_of, v.review_by, v.destination_codes, v.access_note_code
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'regional_service'
  join transit.regional_service s on s.id = m.entity_id
  join transit.regional_service_version v on v.id = m.version_id and v.regional_service_id = s.id
 where not s.is_synthetic and not v.is_synthetic;

create view transit.v_published_regional_destinations with (security_invoker = true) as
select pp.revision_id, d.id as regional_destination_id, v.id as regional_destination_version_id, d.code, v.name,
       v.aliases, v.group_code, v.psgc_code, v.kind, v.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'regional_destination'
  join transit.regional_destination d on d.id = m.entity_id
  join transit.regional_destination_version v on v.id = m.version_id and v.regional_destination_id = d.id
 where not d.is_synthetic and not v.is_synthetic;

-- Children of the member version of each published service.
create view transit.v_published_regional_departures with (security_invoker = true) as
select pp.revision_id, s.code as service_code, dp.id, dp.regional_service_version_id, dp.pattern, dp.times,
       dp.headway_min, dp.start_time, dp.end_time, dp.trips_per_day, dp.day_type, dp.basis, dp.observed_on,
       dp.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'regional_service'
  join transit.regional_service s on s.id = m.entity_id
  join transit.regional_service_version v on v.id = m.version_id and v.regional_service_id = s.id
  join transit.regional_departure dp on dp.regional_service_version_id = v.id
 where not s.is_synthetic and not v.is_synthetic and not dp.is_synthetic;

create view transit.v_published_regional_observations with (security_invoker = true) as
select pp.revision_id, s.code as service_code, o.id, o.regional_service_version_id, o.code, o.destination_code,
       o.mode_code, o.amount_centavos, o.amount_high_centavos, o.category, o.kind, o.seat_class_text, o.basis,
       o.observed_at, o.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'regional_service'
  join transit.regional_service s on s.id = m.entity_id
  join transit.regional_service_version v on v.id = m.version_id and v.regional_service_id = s.id
  join transit.fare_observation o on o.regional_service_version_id = v.id
 where not s.is_synthetic and not v.is_synthetic and not o.is_synthetic;

-- Same sources as 0010 plus those of the regional destinations, departures and observations, and
-- the sourceCodes arrays of the intercity_* dataset notes.
create or replace view transit.v_published_sources with (security_invoker = true) as
select pp.revision_id, s.code, s.title, s.url, s.evidence_type, s.published_or_enacted, s.checked_on
  from transit.published_pointer pp
  join ingest.source s on s.code in (
         select unnest(x.source_codes) from transit.v_published_routes x
         union select unnest(x.source_codes) from transit.v_published_variants x
         union select unnest(x.source_codes) from transit.v_published_fare_rules x
         union select unnest(x.source_codes) from transit.v_published_fare_observations x
         union select unnest(x.source_codes) from transit.v_published_terminals x
         union select x.source_code from transit.v_published_route_aliases x where x.source_code is not null
         union select x.source_code from transit.v_published_places x
         union select x.source_code from transit.v_published_barangays x where x.source_code is not null
         union select unnest(x.source_ids) from transit.v_published_designated_stop_candidates x
         union select unnest(x.source_codes) from transit.v_published_destination_categories x
         union select unnest(x.source_codes) from transit.v_published_feeder_leads x
         union select unnest(x.source_codes) from transit.v_published_route_vehicle_classes x
         union select unnest(x.aircon_source_codes) from transit.v_published_route_vehicle_classes x
         union select unnest(x.source_codes) from transit.v_published_route_cooperatives x
         union select unnest(x.source_codes) from transit.v_published_route_operating_statuses x
         union select unnest(x.source_codes) from transit.v_published_route_fare_observations x
         union select unnest(x.source_codes) from transit.v_published_regional_services x
         union select jsonb_array_elements_text(e.value)
                 from transit.v_published_terminals x
                 cross join lateral jsonb_each(coalesce(x.mode_sources, '{}'::jsonb)) e
                where jsonb_typeof(e.value) = 'array'
         union select x.road_source_code from transit.v_published_shapes x
         union select x.road_source_code from transit.v_published_walk_graph x
         union select unnest(x.source_codes) from transit.v_published_eta_params x
         union select unnest(x.source_codes) from transit.v_published_route_notes x
         union select unnest(x.source_codes) from transit.v_published_regional_destinations x
         union select unnest(x.source_codes) from transit.v_published_regional_departures x
         union select unnest(x.source_codes) from transit.v_published_regional_observations x
         union select jsonb_array_elements_text(x.value -> 'sourceCodes')
                 from transit.v_published_dataset_notes x
                where starts_with(x.key, 'intercity_') and jsonb_typeof(x.value -> 'sourceCodes') = 'array');

grant select on transit.v_published_regional_services, transit.v_published_regional_destinations,
  transit.v_published_regional_departures, transit.v_published_regional_observations, transit.v_published_sources
  to paranaga_app;

revoke create on schema transit from paranaga_definer;
