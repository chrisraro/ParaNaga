-- 0016_community_correction.sql
-- Increment B, Task B6: Report a correction (S16, F-D1).
--   - community.correction: a commuter proposal to change a stop, route, fare or trip.
--     NEVER changes published transit data; a transport reviewer must accept it and a
--     validated publication must incorporate it (AC-13).
--   - community.correction_event: append-only status history.
--   - community.submit_correction(...): the only way a commuter creates a row (definer).
--   - community.review_queue(...) and community.set_correction_status(...): reviewer access (definer).
-- Commuters see only their own rows (forced RLS). No community_moderator read or write access.
-- core.ack already exists (0000) and already lets a commuter insert and read their own rows.

grant usage on schema community to paranaga_app, paranaga_definer;
grant create on schema community to paranaga_definer;

create table community.correction (
  id                       uuid primary key default pg_catalog.gen_random_uuid(),
  author_id                text not null,
  client_request_id        uuid not null,
  entity_type              text not null check (entity_type in ('stop', 'route', 'fare', 'trip')),
  entity_id                text not null check (char_length(entity_id) between 1 and 120),
  entity_label             text check (entity_label is null or char_length(entity_label) between 1 and 120),
  entity_revision_id       uuid references transit.revision (id),
  kind                     text not null check (kind in (
    'wrong_curb_side', 'stop_moved_removed', 'route_not_stopping', 'route_deviation',
    'fare_mismatch', 'hours_service', 'crossing_access', 'other_trip', 'other')),
  description              text not null check (char_length(description) between 10 and 1000),
  proposed                 jsonb not null default '{}'::jsonb,
  observed_at              timestamptz not null default now(),
  location                 extensions.geography(Point, 4326),
  location_accuracy_m      numeric check (location_accuracy_m is null or location_accuracy_m between 0 and 5000),
  media_ids                uuid[] not null default '{}' check (cardinality(media_ids) <= 3),
  status                   text not null default 'submitted' check (status in (
    'draft', 'submitted', 'under_review', 'needs_evidence', 'accepted', 'rejected',
    'duplicate', 'incorporated', 'superseded')),
  moderation_reason        text check (moderation_reason is null or char_length(moderation_reason) <= 60),
  duplicate_of             uuid references community.correction (id),
  reviewer_note            text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  incorporated_revision_id uuid references transit.revision (id),
  submitted_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (author_id, client_request_id)
);
create index correction_author_idx on community.correction (author_id, created_at desc);
create index correction_queue_idx on community.correction (status, submitted_at)
  where status in ('submitted', 'under_review', 'needs_evidence');
create index correction_entity_idx on community.correction (entity_type, entity_id);

create table community.correction_event (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  correction_id  uuid not null references community.correction (id) on delete cascade,
  from_status    text,
  to_status      text not null,
  actor_id       text,
  actor_role     text,
  reason_code    text check (reason_code is null or char_length(reason_code) <= 60),
  note           text check (note is null or char_length(note) <= 1000),
  at             timestamptz not null default now()
);
create index correction_event_idx on community.correction_event (correction_id, at);

-- Grants: the app role may only read; writes go through the definer functions below.
grant select on community.correction to paranaga_app;
grant select on community.correction_event to paranaga_app;
grant select, insert, update on community.correction to paranaga_definer;
grant select, insert on community.correction_event to paranaga_definer;
grant select on core.media_object to paranaga_definer;
grant select on transit.revision to paranaga_definer;

alter table community.correction enable row level security;
alter table community.correction force row level security;
alter table community.correction_event enable row level security;
alter table community.correction_event force row level security;

create policy correction_own_read on community.correction for select to paranaga_app
  using (author_id = (select core.current_user_id()));
create policy correction_event_own_read on community.correction_event for select to paranaga_app
  using (exists (
    select 1 from community.correction c
     where c.id = correction_id and c.author_id = (select core.current_user_id())));

create policy correction_definer on community.correction for all to paranaga_definer
  using (true) with check (true);
create policy correction_event_definer on community.correction_event for all to paranaga_definer
  using (true) with check (true);

-- ---------------------------------------------------------------- submit (commuter)
create or replace function community.submit_correction(
  p_client_request_id uuid,
  p_kind text,
  p_entity_type text,
  p_entity_id text,
  p_entity_label text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric,
  p_media_ids uuid[],
  p_moderation_reason text
) returns table (
  id uuid,
  kind text,
  entity_type text,
  entity_id text,
  entity_label text,
  status text,
  submitted_at timestamptz
)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, transit, extensions, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_row community.correction%rowtype;
  v_revision uuid;
  v_good integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotent retry: the same request id returns the row already stored.
  select * into v_row from community.correction c
   where c.author_id = v_user_id and c.client_request_id = p_client_request_id;
  if not found then
    -- Evidence photos must be the caller's own, verified correction_evidence uploads.
    if p_media_ids is not null and cardinality(p_media_ids) > 0 then
      select count(*) into v_good from core.media_object m
       where m.id = any (p_media_ids) and m.owner_id = v_user_id
         and m.purpose = 'correction_evidence' and m.status = 'verified';
      if v_good <> cardinality(p_media_ids) then
        raise exception 'invalid media' using errcode = '22023';
      end if;
    end if;

    -- The revision the commuter was looking at: the published one, if any.
    select r.id into v_revision from transit.revision r
     where r.status = 'published' order by r.published_at desc nulls last limit 1;

    insert into community.correction (
      author_id, client_request_id, entity_type, entity_id, entity_label, entity_revision_id, kind,
      description, location, location_accuracy_m, media_ids, status, moderation_reason, submitted_at
    ) values (
      v_user_id, p_client_request_id, p_entity_type, p_entity_id, p_entity_label, v_revision, p_kind,
      p_description,
      case when p_lat is null or p_lng is null then null
           else extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography end,
      p_accuracy_m, coalesce(p_media_ids, '{}'), 'submitted', p_moderation_reason, now()
    ) returning * into v_row;

    insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role, reason_code)
    values (v_row.id, 'draft', 'submitted', v_user_id, 'commuter', p_moderation_reason);
  end if;

  return query
  select v_row.id, v_row.kind, v_row.entity_type, v_row.entity_id, v_row.entity_label, v_row.status, v_row.submitted_at;
end;
$$;
alter function community.submit_correction(uuid, text, text, text, text, text, double precision, double precision, numeric, uuid[], text) owner to paranaga_definer;
revoke execute on function community.submit_correction(uuid, text, text, text, text, text, double precision, double precision, numeric, uuid[], text) from public;
grant execute on function community.submit_correction(uuid, text, text, text, text, text, double precision, double precision, numeric, uuid[], text) to paranaga_app;

-- ---------------------------------------------------------------- reviewers (definer only)
create or replace function community.review_queue(p_limit integer default 50)
returns table (
  id uuid,
  kind text,
  entity_type text,
  entity_id text,
  entity_label text,
  description text,
  status text,
  submitted_at timestamptz,
  has_location boolean,
  media_count integer
)
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
begin
  if core.current_user_id() is null
     or not (core.has_role('transport_reviewer') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select c.id, c.kind, c.entity_type, c.entity_id, c.entity_label, c.description, c.status, c.submitted_at,
         c.location is not null, cardinality(c.media_ids)
    from community.correction c
   where c.status in ('submitted', 'under_review', 'needs_evidence')
     and c.author_id <> core.current_user_id()
   order by c.submitted_at
   limit least(greatest(p_limit, 1), 200);
end;
$$;
alter function community.review_queue(integer) owner to paranaga_definer;
revoke execute on function community.review_queue(integer) from public;
grant execute on function community.review_queue(integer) to paranaga_app;

create or replace function community.set_correction_status(
  p_id uuid,
  p_to text,
  p_reason_code text default null,
  p_note text default null
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_from text;
  v_author text;
begin
  if v_actor is null or not (core.has_role('transport_reviewer') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status, author_id into v_from, v_author from community.correction where id = p_id for update;
  if not found then
    return false;
  end if;
  if v_author = v_actor then
    raise exception 'forbidden: own submission' using errcode = '42501';
  end if;
  -- Transition table (mirrors src/domain/corrections/status.ts). 'incorporated' is set only by
  -- the revision publication function, never here.
  if not ((v_from, p_to) in (
    ('submitted', 'under_review'), ('submitted', 'needs_evidence'), ('submitted', 'duplicate'), ('submitted', 'rejected'),
    ('under_review', 'accepted'), ('under_review', 'rejected'), ('under_review', 'duplicate'), ('under_review', 'needs_evidence'),
    ('accepted', 'superseded'))) then
    raise exception 'invalid transition % to %', v_from, p_to using errcode = '22023';
  end if;
  update community.correction
     set status = p_to, reviewer_note = coalesce(p_note, reviewer_note), updated_at = now()
   where id = p_id;
  insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role, reason_code, note)
  values (p_id, v_from, p_to, v_actor, 'transport_reviewer', p_reason_code, p_note);
  return true;
end;
$$;
alter function community.set_correction_status(uuid, text, text, text) owner to paranaga_definer;
revoke execute on function community.set_correction_status(uuid, text, text, text) from public;
grant execute on function community.set_correction_status(uuid, text, text, text) to paranaga_app;
