-- 0013_core_saved_sync.sql
-- Increment B, Task B2: Optional server sync for saved places and trips.
--   - core.saved_place: commuter saved places synced to their account.
--   - core.saved_trip: commuter saved itineraries synced to their account.
-- Strictly commuter-owned. Row-level security is enabled and forced.
-- All writes/reads filtered by core.current_user_id().

create table core.saved_place (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  user_id     text not null,
  client_id   text not null check (char_length(client_id) between 1 and 100),
  label       text not null check (char_length(label) between 1 and 40),
  point       extensions.geography(Point, 4326) not null,
  source      text not null check (source in ('osm', 'pin', 'pinned', 'google')),
  saved_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, client_id)
);
create index saved_place_user_idx on core.saved_place (user_id);

create table core.saved_trip (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  user_id         text not null,
  client_id       text not null check (char_length(client_id) between 1 and 100),
  revision_id     uuid not null references transit.revision (id),
  revision_label  text not null,
  revision_kind   text not null check (revision_kind in ('provisional', 'verified')),
  published_at    timestamptz,
  start_label     text not null check (char_length(start_label) between 1 and 200),
  start_point     extensions.geography(Point, 4326) not null,
  start_place     text check (start_place in ('osm', 'pin', 'pinned', 'google')),
  dest_label      text not null check (char_length(dest_label) between 1 and 200),
  dest_point      extensions.geography(Point, 4326) not null,
  dest_place      text check (dest_place in ('osm', 'pin', 'pinned', 'google')),
  option          jsonb not null,
  stops           jsonb not null default '[]'::jsonb,
  variants        jsonb not null default '[]'::jsonb,
  saved_at        timestamptz not null default now(),
  invalidated_at  timestamptz,
  unique (user_id, client_id)
);
create index saved_trip_user_idx on core.saved_trip (user_id);

-- Grants
grant select, insert, update, delete on core.saved_place to paranaga_app;
grant select, insert, update, delete on core.saved_trip to paranaga_app;
grant select on core.saved_place to paranaga_definer;
grant select on core.saved_trip to paranaga_definer;

-- Row Level Security (RLS)
alter table core.saved_place enable row level security;
alter table core.saved_place force row level security;
alter table core.saved_trip enable row level security;
alter table core.saved_trip force row level security;

-- Policies: users access only their own rows
create policy saved_place_own on core.saved_place for all to paranaga_app
  using (user_id = (select core.current_user_id()))
  with check (user_id = (select core.current_user_id()));

create policy saved_trip_own on core.saved_trip for all to paranaga_app
  using (user_id = (select core.current_user_id()))
  with check (user_id = (select core.current_user_id()));

create policy saved_place_definer on core.saved_place for select to paranaga_definer using (true);
create policy saved_trip_definer on core.saved_trip for select to paranaga_definer using (true);
