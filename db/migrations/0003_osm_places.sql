-- 0003_osm_places.sql
-- Named places from OpenStreetMap (decisions Q1 and D10, Task 3): a committed, dated snapshot
-- (data/source/osm/naga-places-YYYY-MM-DD.osm.json, ODbL 1.0, © OpenStreetMap contributors)
-- imported with the same revision/provenance pattern as 0001:
--   ingest.source          one row per snapshot, code OSM-YYYY-MM-DD (evidence type open_data);
--   ingest.source_document, ingest.batch, ingest.raw_feature (source_layer 'osm',
--                          identity_method 'osm_id') for the file and each kept element;
--   transit.place          stable identity = (osm_type, osm_id);
--   transit.place_version  name, aliases, category, coordinate, OSM version and timestamp
--                          (insert-only: a changed place is a new version in a new draft revision);
--   transit.revision_member entity_kind 'place' (version_id = place_version.id).
-- Places are places, not transport data: no entrances, hours, photos or ratings are stored, and
-- an OSM bus station never becomes a ParaNaga terminal or stop.

-- ---------------------------------------------------------------- ingest: OSM provenance
alter table ingest.source drop constraint source_code_check;
alter table ingest.source add constraint source_code_check
  check (code ~ '^S[0-9]{2,3}$' or code ~ '^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$');

alter table ingest.raw_feature drop constraint raw_feature_identity_method_check;
alter table ingest.raw_feature add constraint raw_feature_identity_method_check
  check (identity_method in ('placemark_id', 'layer_code_label', 'layer_position', 'osm_id'));

-- ---------------------------------------------------------------- transit: places
create table transit.place (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  osm_type     text not null check (osm_type in ('node', 'way', 'relation')),
  osm_id       bigint not null check (osm_id > 0),
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (osm_type, osm_id)
);

create table transit.place_version (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  place_id       uuid not null references transit.place (id),
  name           text not null check (btrim(name) <> ''),
  aliases        text[] not null default '{}' check (array_position(aliases, null) is null),
  category       text not null check (category in (
                   'mall', 'market', 'school', 'college_university', 'hospital_clinic', 'place_of_worship',
                   'government', 'bus_terminal', 'park', 'square')),
  geog           extensions.geography(Point, 4326) not null,
  osm_version    integer not null check (osm_version >= 1),
  osm_timestamp  timestamptz not null,
  source_code    text not null references ingest.source (code),
  raw_feature_id uuid not null references ingest.raw_feature (id),
  content_hash   text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_synthetic   boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint place_version_place_uq unique (id, place_id),
  constraint place_version_content_uq unique (place_id, content_hash),
  -- Same service area as stop_point_version (the parser already keeps only points inside the city polygon).
  constraint place_version_in_city check (extensions.ST_CoveredBy(
    geog, extensions.ST_MakeEnvelope(123.05, 13.45, 123.40, 13.80, 4326)::extensions.geography))
);
create index place_version_place_idx on transit.place_version (place_id);
create index place_version_geog_idx on transit.place_version using gist (geog);
create index place_version_raw_idx on transit.place_version (raw_feature_id);

alter table transit.revision_member drop constraint revision_member_entity_kind_check;
alter table transit.revision_member add constraint revision_member_entity_kind_check check (entity_kind in (
  'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
  'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
  'provider_presence', 'rail_status', 'designated_stop_candidate',
  'external_destination_category', 'dataset_note', 'place'));

-- ---------------------------------------------------------------- grants and RLS
-- Import: INSERT only (no UPDATE, no DELETE grant): released place rows are immutable.
grant select, insert on transit.place, transit.place_version to paranaga_import;
grant select on transit.place, transit.place_version to paranaga_app, paranaga_definer;

alter table transit.place enable row level security;
alter table transit.place force row level security;
alter table transit.place_version enable row level security;
alter table transit.place_version force row level security;

create policy public_read on transit.place for select to paranaga_app using (true);
create policy public_read on transit.place_version for select to paranaga_app using (true);
create policy import_read on transit.place for select to paranaga_import using (true);
create policy import_read on transit.place_version for select to paranaga_import using (true);
create policy import_insert on transit.place for insert to paranaga_import with check (true);
-- A version is written only while no released revision references its id (always true for a new
-- row; it documents the rule as for the other version tables).
create policy import_insert on transit.place_version for insert to paranaga_import
  with check (not transit.in_released_revision(id));
create policy definer_read on transit.place for select to paranaga_definer using (true);
create policy definer_read on transit.place_version for select to paranaga_definer using (true);

-- ---------------------------------------------------------------- publish: place members
-- Same function as 0001 with one more member kind: a 'place' member must resolve to a
-- non-synthetic place_version of a non-synthetic place, so the synthetic test fixture can never
-- be published. CREATE OR REPLACE keeps the owner (paranaga_definer) and the EXECUTE grants.
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
         else case when m.version_id <> m.entity_id then null else (case m.entity_kind
           when 'route' then (select t.is_synthetic from transit.route t where t.id = m.entity_id)
           when 'route_alias' then (select t.is_synthetic from transit.route_alias t where t.id = m.entity_id)
           when 'terminal' then (select t.is_synthetic from transit.terminal t where t.id = m.entity_id)
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

-- ---------------------------------------------------------------- published read model
-- Published places: pointer → membership → version, synthetic rows hidden (stable or version).
create view transit.v_published_places with (security_invoker = true) as
select pp.revision_id, p.id as place_id, pv.id as place_version_id, p.osm_type, p.osm_id,
       pv.name, pv.aliases, pv.category,
       extensions.ST_X(pv.geog::extensions.geometry) as lon,
       extensions.ST_Y(pv.geog::extensions.geometry) as lat,
       pv.osm_version, pv.osm_timestamp, pv.source_code
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'place'
  join transit.place p on p.id = m.entity_id
  join transit.place_version pv on pv.id = m.version_id and pv.place_id = p.id
 where not p.is_synthetic and not pv.is_synthetic;

-- The sources register also cites the OSM snapshot behind the published places.
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
         union select x.source_code from transit.v_published_places x);

grant select on transit.v_published_places, transit.v_published_sources to paranaga_app;
