-- 0001_transit_and_ingest.sql
-- Research-data provenance (ingest.*) and the revisioned public transit network (transit.*),
-- trimmed to what the Naga research package and the provisional Loop A/B planner need
-- (docs/spec/04-data-model.md §4.3–4.4, 03-architecture.md §3.5).
--
-- Roles (created NOLOGIN in 0000; login passwords are set outside migrations):
--   paranaga_import  — import script. Inserts/updates ingest.* and transit.* rows; may only
--                      create and edit DRAFT revisions and their membership. Cannot publish
--                      except through transit.publish_revision().
--   paranaga_app     — runtime. SELECT only on the public tables (this data is public).
--   paranaga_definer — owns transit.publish_revision(); reach listed table by table below.
--
-- Versions (*_version rows) are revision-independent; a revision is a complete snapshot
-- recorded in transit.revision_member. For entities without a version table
-- (route, terminal, barangay, …) the member's version_id equals its entity_id.
--
-- Coordinates are WGS 84 (EPSG:4326). NULL means unknown, never zero or false.

-- ---------------------------------------------------------------- role plumbing
-- The migrating role needs SET on paranaga_import so scripts can `SET ROLE paranaga_import`.
do $$
begin
  execute format('grant paranaga_import to %I', current_user);
end
$$;

grant usage on schema ingest, transit to paranaga_app;
grant usage on schema transit to paranaga_definer;

-- ALTER FUNCTION … OWNER TO requires the new owner to hold CREATE on the schema;
-- granted only for this migration, revoked below.
grant create on schema transit to paranaga_definer;

-- ================================================================ ingest
create table ingest.source (
  code                 text primary key check (code ~ '^S[0-9]{2,3}$'),
  title                text not null,
  url                  text,
  evidence_type        text not null,
  published_or_enacted text,          -- verbatim: a date, a year or a description
  checked_on           date,
  created_at           timestamptz not null default now()
);

create table ingest.source_document (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  source_code  text references ingest.source (code),
  file_name    text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes        bigint not null check (bytes >= 0),
  retrieved_on date,
  storage_key  text,
  created_at   timestamptz not null default now(),
  unique (file_name, sha256)
);

create table ingest.batch (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  source_document_id uuid references ingest.source_document (id),
  snapshot_version   text not null,   -- e.g. mymaps:<map id>:2026-10-15
  mode               text not null check (mode in ('dry_run', 'commit')),
  status             text not null default 'running'
                     check (status in ('running', 'committed', 'failed', 'aborted')),
  counts             jsonb not null default '{}'::jsonb,
  started_by         text not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);
-- Blocks concurrent or repeated commits of the same snapshot.
create unique index batch_one_commit_uq on ingest.batch (snapshot_version)
  where mode = 'commit' and status in ('running', 'committed');

create table ingest.raw_feature (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id        uuid not null references ingest.batch (id),
  source_identity text not null,      -- sha256 of the identity key (spec §4.7)
  identity_method text not null check (identity_method in ('placemark_id', 'layer_code_label', 'layer_position')),
  source_layer    text not null,      -- verbatim, e.g. "Loop Service A"
  source_code_raw text,               -- verbatim; not unique across layers
  label_raw       text not null,      -- verbatim spelling
  description_raw text,
  lon             numeric(11, 8) not null check (lon between -180 and 180),
  lat             numeric(11, 8) not null check (lat between -90 and 90),
  properties      jsonb not null default '{}'::jsonb,
  content_hash    text not null,
  created_at      timestamptz not null default now(),
  unique (batch_id, source_identity)
);
create index raw_feature_identity_idx on ingest.raw_feature (source_identity);

create table ingest.change (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id        uuid not null references ingest.batch (id),
  source_identity text not null,
  kind            text not null check (kind in ('added', 'unchanged', 'changed', 'missing')),
  diff            jsonb,
  unique (batch_id, source_identity)
);

-- refs = sorted source identities of the records involved (stable across re-imports).
create table ingest.conflict (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id    uuid not null references ingest.batch (id),
  kind        text not null check (kind in ('code_prefix_mismatch', 'exact_coordinate_shared', 'near_duplicate', 'label_variant')),
  refs        text[] not null check (cardinality(refs) > 0),
  detail      jsonb not null default '{}'::jsonb,
  resolution  text,
  resolved_by text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (batch_id, kind, refs)
);

create table ingest.error (
  id         uuid primary key default pg_catalog.gen_random_uuid(),
  batch_id   uuid not null references ingest.batch (id),
  row_ref    text,
  code       text not null,
  message    text not null,
  created_at timestamptz not null default now()
);
create index error_batch_idx on ingest.error (batch_id);

-- ================================================================ transit: revisions
create table transit.revision (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  seq                bigint generated always as identity unique,
  label              text not null unique,
  kind               text not null check (kind in ('provisional', 'verified')),
  status             text not null default 'draft'
                     check (status in ('draft', 'validating', 'published', 'superseded')),
  created_by         text not null,
  created_at         timestamptz not null default now(),
  published_by       text,
  published_at       timestamptz,
  parent_revision_id uuid references transit.revision (id),
  validation_report  jsonb,
  content_hash       text,
  is_synthetic       boolean not null default false
);
-- Backstop; transit.published_pointer is the source of truth.
create unique index revision_one_published_uq on transit.revision ((true)) where status = 'published';

create table transit.revision_member (
  revision_id uuid not null references transit.revision (id),
  entity_kind text not null check (entity_kind in (
                'route', 'route_alias', 'variant', 'stop_point', 'terminal', 'fare_rule',
                'fare_observation', 'fare_conflict', 'barangay', 'coverage_audit', 'feeder_lead',
                'provider_presence', 'rail_status', 'designated_stop_candidate',
                'external_destination_category', 'dataset_note')),
  entity_id   uuid not null,   -- stable identity
  version_id  uuid not null,   -- *_version row used in this revision (= entity_id when unversioned)
  primary key (revision_id, entity_kind, entity_id)
);
create index revision_member_version_idx on transit.revision_member (version_id);

create table transit.published_pointer (
  singleton   boolean primary key default true check (singleton),
  revision_id uuid not null references transit.revision (id),
  updated_at  timestamptz not null default now()
);

-- ================================================================ transit: routes and stops
create table transit.route (
  id                               uuid primary key default pg_catalog.gen_random_uuid(),
  public_code                      text not null unique,     -- R1 … R8-D
  official_group_number            integer,
  name                             text not null,
  mode_code                        text not null,
  legal_status                     text not null,
  allocated_units                  integer check (allocated_units >= 0),
  allocation_is_active_fleet_count boolean not null default false,
  notes                            text,
  source_codes                     text[] not null default '{}',
  is_synthetic                     boolean not null default false,
  created_at                       timestamptz not null default now()
);

create table transit.route_alias (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  route_id      uuid not null references transit.route (id),
  alias         text not null,
  kind          text not null check (kind in ('legacy_name', 'signboard', 'local', 'legacy_color')),
  is_historical boolean not null default false,
  source_code   text,
  is_synthetic  boolean not null default false,
  unique (route_id, kind, alias)
);

create table transit.variant (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  route_id     uuid not null references transit.route (id),
  direction    text not null check (direction in ('inbound', 'outbound', 'circuit', 'clockwise', 'counterclockwise', 'branch')),
  kind         text not null check (kind in ('permanent', 'trial', 'event', 'construction')),
  is_synthetic boolean not null default false,
  unique (route_id, direction, kind)
);

create table transit.variant_version (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  variant_id          uuid not null references transit.variant (id),
  headsign            text,                                     -- NULL until a signboard is verified
  vehicle_class       text,
  legal_streets       jsonb,                                    -- {inbound|outbound|circuit: [street, …]} as text
  trial_status        text,
  effective_from      date,
  trial_duration_days integer check (trial_duration_days > 0),
  operating_status    text not null default 'unverified' check (operating_status in ('unverified', 'observed', 'confirmed')),
  evidence_level      text not null check (evidence_level in ('documentary', 'provisional', 'verified')),
  is_circular         boolean not null default false,
  navigation_approved boolean not null default false,
  source_codes        text[] not null default '{}',
  notes               text,
  content_hash        text,
  is_synthetic        boolean not null default false,
  created_at          timestamptz not null default now()
);
create index variant_version_variant_idx on transit.variant_version (variant_id);
create unique index variant_version_content_uq on transit.variant_version (variant_id, content_hash)
  where content_hash is not null;

create table transit.stop_point (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  name             text not null,
  official_stop_id text,
  is_synthetic     boolean not null default false,
  created_at       timestamptz not null default now()
);

create table transit.stop_point_version (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  stop_point_id       uuid not null references transit.stop_point (id),
  geog                extensions.geography(Point, 4326) not null,
  geog_accuracy_m     numeric check (geog_accuracy_m >= 0),
  status              text not null default 'candidate' check (status in (
                        'candidate', 'documentary', 'installed', 'field_verified', 'published',
                        'temporary', 'relocated', 'retired')),
  source_layer        text,
  source_code_raw     text,
  label_raw           text,
  curb_side           text check (curb_side in ('left_of_travel', 'right_of_travel', 'terminal_bay', 'unknown')),
  boarding_allowed    boolean,
  alighting_allowed   boolean,
  sign_installed      boolean,
  navigation_approved boolean not null default false,
  content_hash        text,
  is_synthetic        boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint stop_point_version_published_needs_approval check (status <> 'published' or navigation_approved),
  constraint stop_point_version_in_city check (extensions.ST_CoveredBy(
    geog, extensions.ST_MakeEnvelope(123.05, 13.45, 123.40, 13.80, 4326)::extensions.geography))
);
create index stop_point_version_stop_idx on transit.stop_point_version (stop_point_id);
create index stop_point_version_geog_idx on transit.stop_point_version using gist (geog);
create unique index stop_point_version_content_uq on transit.stop_point_version (stop_point_id, content_hash)
  where content_hash is not null;

-- Links candidate stops to the source pins they came from (provenance never collapses).
create table transit.stop_point_source (
  stop_point_id  uuid not null references transit.stop_point (id),
  raw_feature_id uuid not null references ingest.raw_feature (id),
  is_synthetic   boolean not null default false,
  primary key (stop_point_id, raw_feature_id)
);
create index stop_point_source_raw_idx on transit.stop_point_source (raw_feature_id);

-- Remembers which candidate stop each source identity created, across snapshots.
create table ingest.raw_feature_lineage (
  source_identity text primary key,
  stop_point_id   uuid not null references transit.stop_point (id),
  created_at      timestamptz not null default now()
);
create index raw_feature_lineage_stop_idx on ingest.raw_feature_lineage (stop_point_id);

create table transit.route_stop (
  id                    uuid primary key default pg_catalog.gen_random_uuid(),
  variant_version_id    uuid not null references transit.variant_version (id),
  stop_point_version_id uuid not null references transit.stop_point_version (id),
  seq                   integer not null check (seq >= 1),
  dist_along_m          numeric check (dist_along_m >= 0),
  boarding_allowed      boolean,
  alighting_allowed     boolean,
  evidence_level        text not null check (evidence_level in ('documentary', 'provisional', 'verified')),
  is_synthetic          boolean not null default false,
  unique (variant_version_id, seq)
);
create index route_stop_stop_idx on transit.route_stop (stop_point_version_id);

create table transit.terminal (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  code            text not null unique,     -- T01 …
  name            text not null,
  location_text   text,
  modes           text[] not null default '{}',
  evidence_status text,
  notes           text,
  geog            extensions.geography(Point, 4326),   -- NULL until evidenced
  source_codes    text[] not null default '{}',
  is_synthetic    boolean not null default false
);
create index terminal_geog_idx on transit.terminal using gist (geog);

-- ================================================================ transit: fares
create table transit.fare_rule (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  code          text not null unique,       -- F01 …
  mode_code     text not null,
  vehicle_class text,
  is_synthetic  boolean not null default false
);

create table transit.fare_rule_version (
  id                         uuid primary key default pg_catalog.gen_random_uuid(),
  fare_rule_id               uuid not null references transit.fare_rule (id),
  base_centavos              integer check (base_centavos >= 0),
  base_km                    numeric check (base_km >= 0),
  increment_centavos_per_km  integer check (increment_centavos_per_km >= 0),
  discount_percent           numeric check (discount_percent between 0 and 100),
  discounted_base_centavos   integer check (discounted_base_centavos >= 0),
  discount_groups            text[],
  rounding                   text check (rounding in ('none', 'nearest_25c', 'nearest_peso', 'ceil_peso')),
  effective_from             date,
  enacted_on                 date,
  evidence_status            text,
  status                     text not null default 'draft' check (status in ('draft', 'verified', 'superseded', 'conflicted')),
  publish_exact              boolean not null default false,
  source_codes               text[] not null default '{}',
  content_hash               text,
  is_synthetic               boolean not null default false,
  created_at                 timestamptz not null default now()
);
create index fare_rule_version_rule_idx on transit.fare_rule_version (fare_rule_id);
create unique index fare_rule_version_content_uq on transit.fare_rule_version (fare_rule_id, content_hash)
  where content_hash is not null;

create table transit.fare_observation (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  code            text,                     -- F05 … (one code may carry several categories)
  fare_rule_id    uuid references transit.fare_rule (id),
  mode_code       text not null,
  amount_centavos integer not null check (amount_centavos >= 0),
  category        text not null,
  kind            text not null check (kind in ('official_matrix', 'charged_fare', 'estimate', 'exclusive_quote', 'reported_practice')),
  observed_at     date,
  evidence_status text,
  source_codes    text[] not null default '{}',
  details         jsonb not null default '{}'::jsonb,
  is_synthetic    boolean not null default false,
  unique nulls not distinct (code, category)
);
create index fare_observation_rule_idx on transit.fare_observation (fare_rule_id);

create table transit.fare_conflict (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  fare_rule_id        uuid not null references transit.fare_rule (id),
  fare_observation_id uuid not null references transit.fare_observation (id),
  status              text not null default 'open' check (status in ('open', 'resolved')),
  note                text,
  is_synthetic        boolean not null default false,
  unique (fare_rule_id, fare_observation_id)
);
create index fare_conflict_observation_idx on transit.fare_conflict (fare_observation_id);

-- ================================================================ transit: coverage and context
create table transit.barangay (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  name          text not null unique,
  psgc_code     text unique,
  survey_status text not null default 'not_surveyed',
  source_code   text,
  is_synthetic  boolean not null default false
);

create table transit.coverage_audit (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  barangay_id  uuid not null unique references transit.barangay (id),
  dimensions   jsonb not null default '{}'::jsonb,
  is_synthetic boolean not null default false
);

create table transit.feeder_lead (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  code             text not null unique,     -- SF01 …
  name             text not null,
  notes            text,
  operating_status text not null default 'unverified',
  fare_centavos    integer check (fare_centavos >= 0),
  source_codes     text[] not null default '{}',
  is_synthetic     boolean not null default false
);

-- Ride-hailing presence only; quotes stay NULL until evidenced.
create table transit.provider_presence (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  name           text not null unique,
  city_presence  text,
  products       text[],
  quote_centavos integer check (quote_centavos >= 0),
  source_codes   text[] not null default '{}',
  is_synthetic   boolean not null default false
);

create table transit.rail_status (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  key          text not null unique,
  value        text,
  source_codes text[] not null default '{}',
  is_synthetic boolean not null default false
);

-- Label-only records from the designated-stop programme; no coordinates by design.
create table transit.designated_stop_candidate (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  code             text not null unique,     -- DSC-A-01 …
  label_raw        text not null,
  label_type       text,
  route_code       text,
  direction        text,
  source_ids       text[] not null default '{}',
  source_context   text,
  operating_status text,
  notes            text,
  properties       jsonb not null default '{}'::jsonb,
  is_synthetic     boolean not null default false
);

create table transit.external_destination_category (
  id                      uuid primary key default pg_catalog.gen_random_uuid(),
  category                text not null unique,
  destinations            text[] not null default '{}',
  candidate_terminal_code text,
  evidence_status         text,
  source_codes            text[] not null default '{}',
  is_synthetic            boolean not null default false
);

-- public_stop_map, stop_inventory_gaps, designated_stop_program, dataset_version, coverage_claim, …
create table transit.dataset_note (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  key          text not null unique,
  value        jsonb not null,
  is_synthetic boolean not null default false
);

-- ================================================================ publish / rollback
-- Publish and rollback are the same operation: lock the pointer, validate the target,
-- supersede the current revision, publish the target, move the pointer, audit.
create function transit.publish_revision(p_revision uuid) returns void
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
          jsonb_build_object('revision_id', p_revision, 'label', v_rev.label, 'kind', v_rev.kind),
          core.current_request_id());
end
$$;
alter function transit.publish_revision(uuid) owner to paranaga_definer;

revoke create on schema transit from paranaga_definer;

revoke execute on function transit.publish_revision(uuid) from public;
grant execute on function transit.publish_revision(uuid) to paranaga_import;

-- ================================================================ grants
-- paranaga_import: writes on ingest.* and transit.* (no deletes except draft membership).
grant select, insert, update on all tables in schema ingest to paranaga_import;
grant select, insert, update on
  transit.revision, transit.route, transit.route_alias, transit.variant, transit.variant_version,
  transit.stop_point, transit.stop_point_version, transit.stop_point_source, transit.route_stop,
  transit.terminal, transit.fare_rule, transit.fare_rule_version, transit.fare_observation,
  transit.fare_conflict, transit.barangay, transit.coverage_audit, transit.feeder_lead,
  transit.provider_presence, transit.rail_status, transit.designated_stop_candidate,
  transit.external_destination_category, transit.dataset_note
  to paranaga_import;
grant select, insert, update, delete on transit.revision_member to paranaga_import;
grant select on transit.published_pointer to paranaga_import;

-- paranaga_app: read-only public data.
grant select on all tables in schema transit to paranaga_app;
grant select on ingest.source, ingest.source_document, ingest.raw_feature, ingest.conflict to paranaga_app;

-- paranaga_definer: what publish_revision reads and writes.
grant select on all tables in schema transit to paranaga_definer;
grant update (status, published_at, published_by) on transit.revision to paranaga_definer;
grant insert, update on transit.published_pointer to paranaga_definer;

-- ================================================================ RLS
do $$
declare
  t text;
begin
  foreach t in array array[
    'ingest.source', 'ingest.source_document', 'ingest.batch', 'ingest.raw_feature',
    'ingest.raw_feature_lineage', 'ingest.change', 'ingest.conflict', 'ingest.error',
    'transit.revision', 'transit.revision_member', 'transit.published_pointer', 'transit.route',
    'transit.route_alias', 'transit.variant', 'transit.variant_version', 'transit.stop_point',
    'transit.stop_point_version', 'transit.stop_point_source', 'transit.route_stop', 'transit.terminal',
    'transit.fare_rule', 'transit.fare_rule_version', 'transit.fare_observation', 'transit.fare_conflict',
    'transit.barangay', 'transit.coverage_audit', 'transit.feeder_lead', 'transit.provider_presence',
    'transit.rail_status', 'transit.designated_stop_candidate', 'transit.external_destination_category',
    'transit.dataset_note']
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end
$$;

-- Public data: the app reads every transit table and the ingest provenance tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ingest.source', 'ingest.source_document', 'ingest.raw_feature', 'ingest.conflict',
    'transit.revision', 'transit.revision_member', 'transit.published_pointer', 'transit.route',
    'transit.route_alias', 'transit.variant', 'transit.variant_version', 'transit.stop_point',
    'transit.stop_point_version', 'transit.stop_point_source', 'transit.route_stop', 'transit.terminal',
    'transit.fare_rule', 'transit.fare_rule_version', 'transit.fare_observation', 'transit.fare_conflict',
    'transit.barangay', 'transit.coverage_audit', 'transit.feeder_lead', 'transit.provider_presence',
    'transit.rail_status', 'transit.designated_stop_candidate', 'transit.external_destination_category',
    'transit.dataset_note']
  loop
    execute format('create policy public_read on %s for select to paranaga_app using (true)', t);
  end loop;
end
$$;

-- Import: non-personal research tables, written only by the import script.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ingest.source', 'ingest.source_document', 'ingest.batch', 'ingest.raw_feature',
    'ingest.raw_feature_lineage', 'ingest.change', 'ingest.conflict', 'ingest.error',
    'transit.route', 'transit.route_alias', 'transit.variant', 'transit.variant_version',
    'transit.stop_point', 'transit.stop_point_version', 'transit.stop_point_source', 'transit.route_stop',
    'transit.terminal', 'transit.fare_rule', 'transit.fare_rule_version', 'transit.fare_observation',
    'transit.fare_conflict', 'transit.barangay', 'transit.coverage_audit', 'transit.feeder_lead',
    'transit.provider_presence', 'transit.rail_status', 'transit.designated_stop_candidate',
    'transit.external_destination_category', 'transit.dataset_note']
  loop
    execute format('create policy import_write on %s for all to paranaga_import using (true) with check (true)', t);
  end loop;
end
$$;

-- Import may only create and edit draft revisions and their membership.
create policy import_read on transit.revision for select to paranaga_import using (true);
create policy import_insert_draft on transit.revision for insert to paranaga_import
  with check (status = 'draft' and published_at is null and published_by is null);
create policy import_update_draft on transit.revision for update to paranaga_import
  using (status in ('draft', 'validating'))
  with check (status in ('draft', 'validating') and published_at is null and published_by is null);

create policy import_read on transit.revision_member for select to paranaga_import using (true);
create policy import_write_draft on transit.revision_member for all to paranaga_import
  using (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'))
  with check (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'));

create policy import_read on transit.published_pointer for select to paranaga_import using (true);

-- Definer (publish_revision): reads every transit table; writes revision status and the pointer.
do $$
declare
  t text;
begin
  foreach t in array array[
    'transit.revision_member', 'transit.route', 'transit.route_alias', 'transit.variant',
    'transit.variant_version', 'transit.stop_point', 'transit.stop_point_version',
    'transit.stop_point_source', 'transit.route_stop', 'transit.terminal', 'transit.fare_rule',
    'transit.fare_rule_version', 'transit.fare_observation', 'transit.fare_conflict', 'transit.barangay',
    'transit.coverage_audit', 'transit.feeder_lead', 'transit.provider_presence', 'transit.rail_status',
    'transit.designated_stop_candidate', 'transit.external_destination_category', 'transit.dataset_note']
  loop
    execute format('create policy definer_read on %s for select to paranaga_definer using (true)', t);
  end loop;
end
$$;
create policy definer_publish on transit.revision for all to paranaga_definer using (true) with check (true);
create policy definer_pointer on transit.published_pointer for all to paranaga_definer using (true) with check (true);
