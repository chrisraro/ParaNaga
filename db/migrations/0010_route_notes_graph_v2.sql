-- 0010_route_notes_graph_v2.sql
-- Increment E (anywhere-alight), Task 4:
--   - ingest.source accepts the 2026-10 research codes RT01…, RL01…, RP01…, RH01… (R-prefixed so
--     they never clash with terminal codes T01…); U02 already matches ^U[0-9]{2}$;
--   - transit.route_note: reviewed per-route notes (<= 120 chars) with an evidence level, sources
--     and an optional "near" circle. Immutable rows (a change is a new row), per-route like the
--     0006 per-route records: member version_id = id, and the route must be a member too;
--   - revision_member.entity_kind accepts route_note;
--   - transit.walk_graph_version accepts format_version 2 (street graph) and the larger budget
--     (800 KB raw, 260 KB gzip, plan E §C);
--   - publish_revision (0007 function, every check kept in order) refuses a route_note whose route
--     is not a member; a synthetic route_note is refused by the existing synthetic/missing check;
--   - transit.v_published_route_notes (security_invoker, synthetic hidden) and v_published_sources
--     citing the sources of the notes.
-- Same RLS pattern as 0006/0007: enabled and forced, paranaga_app SELECT only, paranaga_import
-- SELECT + INSERT, paranaga_definer SELECT.

-- ================================================================ ingest
alter table ingest.source drop constraint source_code_check;
alter table ingest.source add constraint source_code_check check (
  code ~ '^S[0-9]{2,3}$' or code ~ '^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or code ~ '^N[0-9]{2}$' or code ~ '^U[0-9]{2}$' or code ~ '^OSMR-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or code ~ '^R[TLPH][0-9]{2}$');

-- ================================================================ street graph v2
alter table transit.walk_graph_version drop constraint walk_graph_version_format_version_check;
alter table transit.walk_graph_version add constraint walk_graph_version_format_version_check
  check (format_version in (1, 2));
alter table transit.walk_graph_version drop constraint walk_graph_version_bytes_check;
alter table transit.walk_graph_version add constraint walk_graph_version_bytes_check
  check (bytes > 0 and bytes <= 819200);            -- plan E §C: <= 800 KB
alter table transit.walk_graph_version drop constraint walk_graph_version_gzip_bytes_check;
alter table transit.walk_graph_version add constraint walk_graph_version_gzip_bytes_check
  check (gzip_bytes > 0 and gzip_bytes <= 266240);  -- <= 260 KB

-- ================================================================ route notes
create table transit.route_note (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  route_id      uuid not null references transit.route (id),
  note_code     text not null check (note_code ~ '^RN[0-9]{2}$'),
  text          text not null check (btrim(text) <> '' and char_length(text) <= 120),
  evidence      text not null check (evidence in ('official', 'news', 'community', 'owner_report_unverified')),
  near_geog     extensions.geography(Point, 4326),    -- NULL = shown in route detail and ride detail only
  near_radius_m integer check (near_radius_m between 50 and 2000),
  source_codes  text[] not null check (cardinality(source_codes) > 0 and array_position(source_codes, null) is null),
  content_hash  text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint route_note_content_uq unique (route_id, content_hash),
  constraint route_note_near_both check ((near_geog is null) = (near_radius_m is null))
);
create index route_note_route_idx on transit.route_note (route_id);

alter table transit.revision_member drop constraint revision_member_entity_kind_check;
alter table transit.revision_member add constraint revision_member_entity_kind_check check (entity_kind in (
  'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
  'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
  'provider_presence', 'rail_status', 'designated_stop_candidate',
  'external_destination_category', 'dataset_note', 'place',
  'route_vehicle_class', 'route_cooperative', 'route_operating_status', 'route_fare_observation',
  'regional_service', 'shape', 'walk_graph', 'eta_param', 'route_note'));

grant select, insert on transit.route_note to paranaga_import;
grant select on transit.route_note to paranaga_app, paranaga_definer;

alter table transit.route_note enable row level security;
alter table transit.route_note force row level security;
create policy public_read on transit.route_note for select to paranaga_app using (true);
create policy import_read on transit.route_note for select to paranaga_import using (true);
-- Always true for a new row; documents the rule as for the other version tables (0003, 0006, 0007).
create policy import_insert on transit.route_note for insert to paranaga_import
  with check (not transit.in_released_revision(id));
create policy definer_read on transit.route_note for select to paranaga_definer using (true);

-- ================================================================ publish
-- Same function as 0007 (every check kept, in the same order) with route_note added to the
-- synthetic/missing check and to the "per-route record needs a member route" check.
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

-- ================================================================ published read model
create view transit.v_published_route_notes with (security_invoker = true) as
select pp.revision_id, n.id, n.route_id, r.public_code as route_code, n.note_code, n.text, n.evidence,
       extensions.ST_Y(n.near_geog::extensions.geometry) as near_lat,
       extensions.ST_X(n.near_geog::extensions.geometry) as near_lng,
       n.near_radius_m, n.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route_note'
  join transit.route_note n on n.id = m.entity_id
  join transit.route r on r.id = n.route_id
 where not n.is_synthetic and not r.is_synthetic;

-- Same sources as 0009 plus those of the route notes.
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
         union select unnest(x.source_codes) from transit.v_published_route_notes x);

grant select on transit.v_published_route_notes, transit.v_published_sources to paranaga_app;
