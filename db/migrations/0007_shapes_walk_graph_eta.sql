-- 0007_shapes_walk_graph_eta.sql
-- All modes, Increment D, Task 7: the outputs of the road snapshot and the time-estimate
-- parameters land in the same revision/provenance model as 0001/0003/0006:
--   transit.shape + shape_version   one approximate path per variant (J1), traced on the pinned OSM
--                                   road snapshot (ODbL derived database). A version records the
--                                   trace of ONE variant version: ok / flagged (drawn, with its
--                                   per-segment off-list reasons and lengths) or untraced (no line,
--                                   "Path could not be traced from the street list", with the reason);
--   transit.walk_graph + walk_graph_version  the on-device walk graph payload (Task 6, format v1),
--                                   stored verbatim with its byte size and sha256 (D7 budget);
--   transit.eta_param + eta_param_version    the five time-estimate parameters (D8/D9), each with
--                                   its basis, sources and assumption note (A1–A3).
-- Every new table: RLS enabled and forced, paranaga_app SELECT only, paranaga_import SELECT +
-- INSERT (no UPDATE/DELETE: rows are immutable once written), paranaga_definer SELECT for publish.
-- The published views are in 0009 (0008 is the Task 3 read model; migrations apply in name order,
-- and nothing here depends on 0008).

-- ================================================================ approximate paths
create table transit.shape (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  variant_id   uuid not null unique references transit.variant (id),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

create table transit.shape_version (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  shape_id           uuid not null references transit.shape (id),
  -- The variant version this trace follows (its street list, pins or anchors). Publish requires it
  -- to be the variant's member version, so a changed street list can never keep an old path.
  variant_version_id uuid not null references transit.variant_version (id),
  trace_status       text not null check (trace_status in ('ok', 'flagged', 'untraced')),
  flag_reason        text check (flag_reason in ('oneway_conflict', 'off_list_detour')),
  untraced_reason    text check (untraced_reason in (
                       'anchor_unresolved', 'pin_unsnapped', 'unmatched_streets', 'not_continuous', 'empty')),
  geog               extensions.geography(LineString, 4326),   -- NULL exactly when untraced
  length_m           numeric check (length_m > 0),               -- NULL exactly when untraced
  evidence_kind      text not null default 'approximate_street_trace'
                       check (evidence_kind in ('approximate_street_trace')),
  approximate        boolean not null default true check (approximate),
  label              text not null default 'Approximate path, not a verified route shape'
                       check (label = 'Approximate path, not a verified route shape'),
  -- [{seq, stopPointVersionId, measureM, snapM}] along the line (pins), NULL for variants without stops.
  stop_measures      jsonb check (stop_measures is null or jsonb_typeof(stop_measures) = 'array'),
  -- [{fromM, toM, lengthM, reason, streets: [{name, m}], against?}]: every off-list stretch with its
  -- reason (off_list_detour / oneway_conflict / terminal_access), so the map can apply the rendering
  -- rules (dashed only when flagged; oneway_conflict ≥ 100 m dashed even on ok; terminal_access solid).
  off_list_segments  jsonb not null default '[]'::jsonb check (jsonb_typeof(off_list_segments) = 'array'),
  -- The tracer's quality report (matched/unmatched streets, off-list shares, snaps, builder version).
  trace_quality      jsonb not null check (jsonb_typeof(trace_quality) = 'object'),
  -- sha256 over the trace inputs: street list / pins / anchors, aliases, landmark and terminus
  -- points, and the road snapshot sha256.
  inputs_hash        text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  road_source_code   text not null references ingest.source (code)
                       check (road_source_code ~ '^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic       boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint shape_version_shape_uq unique (id, shape_id),
  constraint shape_version_content_uq unique (shape_id, content_hash),
  constraint shape_version_line check ((trace_status = 'untraced') = (geog is null)
                                       and (geog is null) = (length_m is null)),
  constraint shape_version_flag check ((trace_status = 'flagged') = (flag_reason is not null)),
  constraint shape_version_untraced check ((trace_status = 'untraced') = (untraced_reason is not null)),
  constraint shape_version_untraced_measures check (trace_status <> 'untraced' or stop_measures is null),
  -- The service area of 0001, buffered by 200 m (the road snapshot reaches 300 m past the boundary).
  constraint shape_version_in_area check (geog is null or extensions.ST_CoveredBy(geog, extensions.ST_Buffer(
    extensions.ST_MakeEnvelope(123.05, 13.45, 123.40, 13.80, 4326)::extensions.geography, 200)))
);
create index shape_version_shape_idx on transit.shape_version (shape_id);
create index shape_version_variant_version_idx on transit.shape_version (variant_version_id);

-- ================================================================ walk graph (D7, Task 6 format v1)
create table transit.walk_graph (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z][a-z0-9-]*$'),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

create table transit.walk_graph_version (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  walk_graph_id    uuid not null references transit.walk_graph (id),
  format_version   integer not null check (format_version = 1),
  payload          text not null,   -- the compact JSON served verbatim
  bytes            integer not null check (bytes > 0 and bytes <= 614400),          -- D7: ≤ 600 KB
  gzip_bytes       integer not null check (gzip_bytes > 0 and gzip_bytes <= 225280), -- D7: ≤ 220 KB
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  node_count       integer not null check (node_count > 0),
  edge_count       integer not null check (edge_count > 0),
  road_source_code text not null references ingest.source (code)
                     check (road_source_code ~ '^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  builder_version  text not null check (btrim(builder_version) <> ''),
  content_hash     text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic     boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint walk_graph_version_graph_uq unique (id, walk_graph_id),
  constraint walk_graph_version_content_uq unique (walk_graph_id, content_hash),
  -- The stored size and hash describe the stored text exactly (the ETag is this sha256).
  constraint walk_graph_version_bytes check (octet_length(payload) = bytes),
  constraint walk_graph_version_sha256 check (
    sha256 = encode(pg_catalog.sha256(convert_to(payload, 'UTF8')), 'hex'))
);
create index walk_graph_version_graph_idx on transit.walk_graph_version (walk_graph_id);

-- ================================================================ time-estimate parameters (D8/D9)
create table transit.eta_param (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  key          text not null unique check (key in (
                 'walk_speed_kmh', 'walk_slowdown_factor', 'jeepney_speed_offpeak_kmh',
                 'jeepney_speed_peak_kmh', 'peak_windows')),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

create table transit.eta_param_version (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  eta_param_id    uuid not null references transit.eta_param (id),
  value_low       numeric check (value_low > 0),
  value_high      numeric check (value_high > 0),
  unit            text not null check (unit in ('km_per_h', 'factor', 'windows')),
  windows         jsonb check (windows is null or (jsonb_typeof(windows) = 'array' and jsonb_array_length(windows) > 0)),
  days            text check (days in ('every_day')),
  applies_to      text[] not null check (cardinality(applies_to) > 0 and applies_to <@ array['walk', 'jeepney']::text[]),
  is_assumption   boolean not null,
  assumption_note text check (assumption_note is null or btrim(assumption_note) <> ''),
  basis           text not null check (btrim(basis) <> ''),
  source_codes    text[] not null default '{}' check (array_position(source_codes, null) is null),
  content_hash    text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint eta_param_version_param_uq unique (id, eta_param_id),
  constraint eta_param_version_content_uq unique (eta_param_id, content_hash),
  -- A value is sourced or an assumption with its note; a mixed band (one end sourced, the other an
  -- assumption) is an assumption that also lists its sources.
  constraint eta_param_version_basis check (is_assumption or cardinality(source_codes) > 0),
  constraint eta_param_version_assumption_note check (not is_assumption or assumption_note is not null),
  constraint eta_param_version_shape check (case when unit = 'windows'
    then windows is not null and days is not null and value_low is null and value_high is null
    else windows is null and value_low is not null and value_high is not null and value_low <= value_high end)
);
create index eta_param_version_param_idx on transit.eta_param_version (eta_param_id);

-- ================================================================ membership kinds
alter table transit.revision_member drop constraint revision_member_entity_kind_check;
alter table transit.revision_member add constraint revision_member_entity_kind_check check (entity_kind in (
  'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
  'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
  'provider_presence', 'rail_status', 'designated_stop_candidate',
  'external_destination_category', 'dataset_note', 'place',
  'route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation',
  'regional_service', 'shape', 'walk_graph', 'eta_param'));

-- ================================================================ grants and RLS
grant select, insert on
  transit.shape, transit.shape_version, transit.walk_graph, transit.walk_graph_version,
  transit.eta_param, transit.eta_param_version
  to paranaga_import;
grant select on
  transit.shape, transit.shape_version, transit.walk_graph, transit.walk_graph_version,
  transit.eta_param, transit.eta_param_version
  to paranaga_app, paranaga_definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'transit.shape', 'transit.shape_version', 'transit.walk_graph', 'transit.walk_graph_version',
    'transit.eta_param', 'transit.eta_param_version']
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format('create policy public_read on %s for select to paranaga_app using (true)', t);
    execute format('create policy import_read on %s for select to paranaga_import using (true)', t);
    -- Always true for a new row; documents the rule as for the other version tables (0003, 0006).
    execute format(
      'create policy import_insert on %s for insert to paranaga_import with check (not transit.in_released_revision(id))', t);
    execute format('create policy definer_read on %s for select to paranaga_definer using (true)', t);
  end loop;
end
$$;

-- ================================================================ publish
-- Same function as 0006 (every check kept, in the same order) with:
--   - shape / walk_graph / eta_param in the synthetic/missing check (version rows of their identity);
--   - a shape whose variant is not a member, or whose variant version is not the member version of
--     that variant, is refused; so is a stop measure that does not name a route stop (seq and stop
--     point version) of that member variant version, or a traced shape of a variant with stops
--     that does not measure every stop;
--   - at most one walk_graph member;
--   - eta_param: none, or every one of the five keys exactly once.
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
