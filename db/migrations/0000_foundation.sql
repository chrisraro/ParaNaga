-- 0000_foundation.sql
-- Foundation: extensions, schemas, roles, core identity/roles/audit, ops tables, RLS.
-- Run as the database owner via `pnpm db:migrate` (DATABASE_URL_UNPOOLED).
--
-- Roles are created HERE, in SQL, not in the Neon console: console-created roles join
-- neon_superuser (BYPASSRLS), which would silently disable every policy below. After
-- this migration, give the login roles passwords from psql (never committed):
--   alter role paranaga_app    with login password '<generated>';
--   alter role paranaga_import with login password '<generated>';
--
-- Every table has FORCE ROW LEVEL SECURITY, which binds the owner too. Later migrations
-- that seed or backfill rows must do it through a definer function or temporarily
-- `alter table … no force row level security` and re-force in the same file.
--
-- User ids are text: they come from Neon Managed Better Auth (neon_auth schema).

-- ---------------------------------------------------------------- roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'paranaga_app') then
    create role paranaga_app nologin noinherit nobypassrls nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'paranaga_import') then
    create role paranaga_import nologin noinherit nobypassrls nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'paranaga_definer') then
    create role paranaga_definer nologin noinherit nobypassrls nocreaterole nocreatedb;
  end if;
end
$$;

-- Refuse to continue if any runtime role can bypass RLS or holds broad data roles.
do $$
declare
  bad text;
begin
  select string_agg(r.rolname, ', ') into bad
    from pg_roles r
   where r.rolname in ('paranaga_app', 'paranaga_import', 'paranaga_definer')
     and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb
          or exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                      where m.member = r.oid
                        and g.rolname in ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data')));
  if bad is not null then
    raise exception 'Roles % are over-privileged (superuser/bypassrls/createrole or neon_superuser member). Drop and let this migration create them.', bad;
  end if;
end
$$;

-- The migrating role needs SET on paranaga_definer to hand it function ownership.
do $$
begin
  execute format('grant paranaga_definer to %I', current_user);
end
$$;

-- ---------------------------------------------------------------- extensions
-- Runtime code must schema-qualify extension objects (extensions.ST_*, extensions.gin_trgm_ops).
create schema if not exists extensions;
create extension if not exists postgis    with schema extensions;
create extension if not exists pg_trgm    with schema extensions;
create extension if not exists unaccent   with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------- schemas
revoke create on schema public from public;

create schema if not exists core;
create schema if not exists ingest;
create schema if not exists transit;
create schema if not exists community;
create schema if not exists priv;
create schema if not exists ops;

revoke all on schema core, ingest, transit, community, priv, ops, extensions from public;
grant usage on schema extensions to paranaga_app, paranaga_import, paranaga_definer;
grant usage on schema core, ops to paranaga_app, paranaga_definer;
grant usage on schema core, ingest, transit to paranaga_import;

alter default privileges revoke execute on functions from public;
alter default privileges for role paranaga_definer revoke execute on functions from public;

-- ALTER FUNCTION … OWNER TO requires the new owner to hold CREATE on the schema;
-- granted only for this migration, revoked at the end.
grant create on schema core to paranaga_definer;

-- ---------------------------------------------------------------- core
create table core.role (
  code        text primary key,
  description text not null
);

insert into core.role (code, description) values
  ('commuter',            'Signed-in commuter: saved trips, preferences, posts within limits'),
  ('contributor',         'May submit transport corrections with evidence'),
  ('transport_reviewer',  'Reviews corrections and edits draft transport revisions'),
  ('community_moderator', 'Moderates community posts, comments and appeals'),
  ('complaint_reviewer',  'Reviews private driver complaints and their evidence'),
  ('admin',               'Manages roles, providers and publication');

create table core.profile (
  user_id      text primary key,
  display_name text not null check (char_length(display_name) between 1 and 40),
  locale       text not null default 'en' check (locale in ('en', 'fil', 'bcl')),
  suspended_until timestamptz,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table core.user_role (
  id         uuid primary key default pg_catalog.gen_random_uuid(),
  user_id    text not null,
  role_code  text not null references core.role (code),
  granted_by text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  reason     text not null check (char_length(reason) between 1 and 500)
);
create unique index user_role_active_uq on core.user_role (user_id, role_code) where revoked_at is null;
create index user_role_role_idx on core.user_role (role_code) where revoked_at is null;

create table core.preference (
  user_id         text primary key,
  fare_category   text not null default 'regular'
                  check (fare_category in ('regular', 'student', 'senior', 'pwd', 'solo_parent')),
  max_walk_m      integer not null default 800 check (max_walk_m between 100 and 3000),
  avoid_stairs    boolean not null default false,
  high_contrast   boolean not null default false,
  reduced_motion  boolean not null default false,
  low_data        boolean not null default false,
  history_enabled boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table core.ack (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  user_id     text not null,
  kind        text not null check (kind in ('community_guidelines', 'driver_report_notice', 'ai_processing_disclosure')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, kind, version)
);

-- Append-only, written only through core.audit() and other definer functions.
-- Never store free text or personal data from priv here (05-security §5.9).
create table core.audit_event (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  actor_user_id text,
  actor_role    text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  request_id    text,
  at            timestamptz not null default now()
);
create index audit_event_entity_idx on core.audit_event (entity_type, entity_id);
create index audit_event_actor_idx on core.audit_event (actor_user_id, at desc);

create table core.media_object (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  bucket         text not null,
  object_key     text not null unique,
  mime           text,
  bytes          bigint check (bytes >= 0),
  expected_bytes bigint not null check (expected_bytes > 0),
  sha256         text check (sha256 ~ '^[0-9a-f]{64}$'),
  owner_id       text not null,
  purpose        text not null check (purpose in ('community_photo', 'correction_evidence', 'stop_photo', 'complaint_evidence')),
  status         text not null default 'slot' check (status in ('slot', 'verified', 'rejected', 'deleted')),
  created_at     timestamptz not null default now(),
  verified_at    timestamptz
);
create index media_object_owner_idx on core.media_object (owner_id);
create index media_object_slot_idx on core.media_object (created_at) where status = 'slot';

-- ---------------------------------------------------------------- ops
create table ops.job (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  kind            text not null,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status          text not null default 'queued' check (status in ('queued', 'running', 'retry', 'done', 'dead')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 5 check (max_attempts between 1 and 20),
  run_after       timestamptz not null default now(),
  locked_until    timestamptz,
  locked_by       text,
  last_error_code text,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create unique index job_idem_uq on ops.job (kind, idempotency_key) where status not in ('done', 'dead');
create index job_claim_idx on ops.job (run_after) where status in ('queued', 'retry', 'running');

create table ops.rate_limit_bucket (
  key_hash     text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key_hash, window_start)
);
create index rate_limit_window_idx on ops.rate_limit_bucket (window_start);

create table ops.feature_flag (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into ops.feature_flag (key, enabled) values
  ('auto_publish', false),
  ('jev_complaints', false),
  ('bot_challenge', false),
  ('publish_requires_second_reviewer', false);

create table ops.provider_health (
  provider             text primary key,
  last_ok_at           timestamptz,
  last_error_code      text,
  consecutive_failures integer not null default 0,
  circuit_open_until   timestamptz
);

create table ops.moderation_policy (
  version      text primary key,
  thresholds   jsonb not null,
  question_set jsonb not null,
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index moderation_policy_active_uq on ops.moderation_policy ((true)) where active;

-- ---------------------------------------------------------------- identity helpers
-- NULL for guests; never errors on an unset or empty setting.
create function core.current_user_id() returns text
  language sql stable
  set search_path = pg_catalog, pg_temp
as $$ select nullif(current_setting('app.user_id', true), '') $$;

create function core.current_request_id() returns text
  language sql stable
  set search_path = pg_catalog, pg_temp
as $$ select nullif(current_setting('app.request_id', true), '') $$;

-- Definer so it can read core.user_role under forced RLS; no identity parameter.
-- Suspended accounts hold no effective roles.
create function core.has_role(p_role text) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, core, pg_temp
as $$
  select exists (
    select 1 from core.user_role ur
    where ur.user_id = core.current_user_id()
      and ur.role_code = p_role
      and ur.revoked_at is null)
  and not exists (
    select 1 from core.profile p
    where p.user_id = core.current_user_id()
      and p.suspended_until is not null and p.suspended_until > now())
$$;
alter function core.has_role(text) owner to paranaga_definer;

-- The only audit writer for app code: actor and request come from the request
-- context, never from arguments.
create function core.audit(p_action text, p_entity_type text, p_entity_id text, p_after jsonb default null)
  returns void
  language sql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (core.current_user_id(),
          case when core.current_user_id() is null then 'guest' else 'user' end,
          left(p_action, 80), left(p_entity_type, 80), left(p_entity_id, 200), p_after,
          core.current_request_id())
$$;
alter function core.audit(text, text, text, jsonb) owner to paranaga_definer;

-- First sign-in only: creates the profile, preferences and commuter role once.
-- Returns immediately if a profile exists, so revoked roles are never re-granted.
create function core.ensure_commuter(p_display_name text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_new integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into core.profile (user_id, display_name)
  values (v_user, left(coalesce(nullif(btrim(p_display_name), ''), 'Commuter'), 40))
  on conflict (user_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return;
  end if;
  insert into core.preference (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into core.user_role (user_id, role_code, granted_by, reason)
  values (v_user, 'commuter', null, 'self sign-up')
  on conflict (user_id, role_code) where revoked_at is null do nothing;
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (v_user, 'system', 'role.grant', 'user', v_user, jsonb_build_object('role', 'commuter'),
          core.current_request_id());
end
$$;
alter function core.ensure_commuter(text) owner to paranaga_definer;

create function core.grant_role(p_user text, p_role text, p_reason text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_new integer;
begin
  if v_actor is null or not core.has_role('admin') then
    raise exception 'only admins can grant roles' using errcode = '42501';
  end if;
  if p_user is null or btrim(p_user) = '' or p_role is null then
    raise exception 'user and role are required' using errcode = '22023';
  end if;
  if p_user = v_actor then
    raise exception 'admins cannot grant roles to themselves' using errcode = '42501';
  end if;
  if not exists (select 1 from core.role where code = p_role) then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  insert into core.user_role (user_id, role_code, granted_by, reason)
  values (p_user, p_role, v_actor, p_reason)
  on conflict (user_id, role_code) where revoked_at is null do nothing;
  get diagnostics v_new = row_count;
  if v_new = 1 then
    insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
    values (v_actor, 'admin', 'role.grant', 'user', p_user, jsonb_build_object('role', p_role),
            core.current_request_id());
  end if;
end
$$;
alter function core.grant_role(text, text, text) owner to paranaga_definer;

create function core.revoke_role(p_user text, p_role text, p_reason text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_changed integer;
begin
  if v_actor is null or not core.has_role('admin') then
    raise exception 'only admins can revoke roles' using errcode = '42501';
  end if;
  if p_user = v_actor and p_role = 'admin' then
    raise exception 'admins cannot revoke their own admin role' using errcode = '42501';
  end if;
  update core.user_role
     set revoked_at = now(), revoked_by = v_actor
   where user_id = p_user and role_code = p_role and revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
    values (v_actor, 'admin', 'role.revoke', 'user', p_user,
            jsonb_build_object('role', p_role, 'reason', left(p_reason, 200)), core.current_request_id());
  end if;
end
$$;
alter function core.revoke_role(text, text, text) owner to paranaga_definer;

-- Used once by scripts/bootstrap-admin.ts with the owner connection (the owner is a
-- member of paranaga_definer). Never granted to paranaga_app.
create function core.bootstrap_admin(p_user text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('paranaga_bootstrap_admin'));
  if exists (select 1 from core.user_role where role_code = 'admin' and revoked_at is null) then
    raise exception 'an admin already exists; use core.grant_role from an admin session' using errcode = '42501';
  end if;
  insert into core.profile (user_id, display_name) values (p_user, 'Admin') on conflict (user_id) do nothing;
  insert into core.preference (user_id) values (p_user) on conflict (user_id) do nothing;
  insert into core.user_role (user_id, role_code, granted_by, reason)
  values (p_user, 'commuter', null, 'initial admin bootstrap')
  on conflict (user_id, role_code) where revoked_at is null do nothing;
  insert into core.user_role (user_id, role_code, granted_by, reason)
  values (p_user, 'admin', null, 'initial admin bootstrap');
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after)
  values (null, 'bootstrap', 'role.grant', 'user', p_user, jsonb_build_object('role', 'admin'));
end
$$;
alter function core.bootstrap_admin(text) owner to paranaga_definer;

revoke create on schema core from paranaga_definer;

-- ---------------------------------------------------------------- function grants
revoke execute on all functions in schema core from public;
grant execute on function core.current_user_id() to paranaga_app, paranaga_definer, paranaga_import;
grant execute on function core.current_request_id() to paranaga_app, paranaga_definer;
grant execute on function core.has_role(text) to paranaga_app, paranaga_import;
grant execute on function core.audit(text, text, text, jsonb) to paranaga_app;
grant execute on function core.ensure_commuter(text) to paranaga_app;
grant execute on function core.grant_role(text, text, text) to paranaga_app;
grant execute on function core.revoke_role(text, text, text) to paranaga_app;

-- ---------------------------------------------------------------- table grants
grant select on core.role to paranaga_app;
grant select, update on core.profile to paranaga_app;
grant select on core.user_role to paranaga_app;
grant select, update on core.preference to paranaga_app;
grant select, insert on core.ack to paranaga_app;
grant select on core.audit_event to paranaga_app;
grant select, insert on core.media_object to paranaga_app;
grant update (mime) on core.media_object to paranaga_app;

grant select, insert, update on ops.job to paranaga_app;
grant select, insert, update, delete on ops.rate_limit_bucket to paranaga_app;
grant select, insert, update on ops.provider_health to paranaga_app;
grant select, update (enabled, updated_at, updated_by) on ops.feature_flag to paranaga_app;
grant select on ops.moderation_policy to paranaga_app;

grant select on core.role to paranaga_definer;
grant select, insert, update on core.user_role to paranaga_definer;
grant select, insert on core.profile, core.preference to paranaga_definer;
grant insert on core.audit_event to paranaga_definer;

-- ---------------------------------------------------------------- RLS
alter table core.role              enable row level security;
alter table core.profile           enable row level security;
alter table core.user_role         enable row level security;
alter table core.preference        enable row level security;
alter table core.ack               enable row level security;
alter table core.audit_event       enable row level security;
alter table core.media_object      enable row level security;
alter table ops.job                enable row level security;
alter table ops.rate_limit_bucket  enable row level security;
alter table ops.feature_flag       enable row level security;
alter table ops.provider_health    enable row level security;
alter table ops.moderation_policy  enable row level security;

alter table core.role              force row level security;
alter table core.profile           force row level security;
alter table core.user_role         force row level security;
alter table core.preference        force row level security;
alter table core.ack               force row level security;
alter table core.audit_event       force row level security;
alter table core.media_object      force row level security;
alter table ops.job                force row level security;
alter table ops.rate_limit_bucket  force row level security;
alter table ops.feature_flag       force row level security;
alter table ops.provider_health    force row level security;
alter table ops.moderation_policy  force row level security;

-- role catalogue: readable by everyone the app serves
create policy role_read on core.role for select to paranaga_app, paranaga_definer using (true);

-- profile: own row; admins read all; created only by definer functions
create policy profile_own_read on core.profile for select to paranaga_app
  using (user_id = (select core.current_user_id()) or (select core.has_role('admin')));
create policy profile_own_update on core.profile for update to paranaga_app
  using (user_id = (select core.current_user_id()))
  with check (user_id = (select core.current_user_id()));
create policy profile_definer on core.profile for all to paranaga_definer using (true) with check (true);

-- user_role: own roles visible; admins see all; writes only through definer functions
create policy user_role_read on core.user_role for select to paranaga_app
  using (user_id = (select core.current_user_id()) or (select core.has_role('admin')));
create policy user_role_definer on core.user_role for all to paranaga_definer using (true) with check (true);

-- preference: own row only
create policy preference_own_read on core.preference for select to paranaga_app
  using (user_id = (select core.current_user_id()));
create policy preference_own_update on core.preference for update to paranaga_app
  using (user_id = (select core.current_user_id()))
  with check (user_id = (select core.current_user_id()));
create policy preference_definer on core.preference for all to paranaga_definer using (true) with check (true);

-- ack: own rows
create policy ack_own_read on core.ack for select to paranaga_app
  using (user_id = (select core.current_user_id()));
create policy ack_own_insert on core.ack for insert to paranaga_app
  with check (user_id = (select core.current_user_id()));

-- audit: written by definer functions only; read by admins only
create policy audit_insert_definer on core.audit_event for insert to paranaga_definer with check (true);
create policy audit_read_admin on core.audit_event for select to paranaga_app
  using ((select core.has_role('admin')));

-- media objects: owners create slots and read their own rows; verification is definer-only (later increment)
create policy media_own_read on core.media_object for select to paranaga_app
  using (owner_id = (select core.current_user_id()));
create policy media_own_slot on core.media_object for insert to paranaga_app
  with check (owner_id = (select core.current_user_id())
              and status = 'slot' and sha256 is null and bytes is null and verified_at is null);
create policy media_own_update on core.media_object for update to paranaga_app
  using (owner_id = (select core.current_user_id()) and status = 'slot')
  with check (owner_id = (select core.current_user_id()) and status = 'slot');

-- ops: internal server tables (no deletes on jobs; they finish as done/dead)
create policy job_app_read on ops.job for select to paranaga_app using (true);
create policy job_app_insert on ops.job for insert to paranaga_app with check (status = 'queued' and attempts = 0);
create policy job_app_update on ops.job for update to paranaga_app using (true) with check (true);
create policy rate_limit_app on ops.rate_limit_bucket for all to paranaga_app using (true) with check (true);
create policy provider_health_app on ops.provider_health for all to paranaga_app using (true) with check (true);
create policy feature_flag_read on ops.feature_flag for select to paranaga_app using (true);
create policy feature_flag_admin on ops.feature_flag for update to paranaga_app
  using ((select core.has_role('admin')))
  with check ((select core.has_role('admin')) and updated_by = (select core.current_user_id()));
create policy moderation_policy_read on ops.moderation_policy for select to paranaga_app using (true);
