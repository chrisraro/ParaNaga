-- 0017_community_hub.sql
-- Increment B, Task B7: Community hub (S17, F-D2).
--   - community.post / post_version: a post and its versions. An edit adds a NEW version; the
--     published version stays live until the edit passes review (AC-11).
--   - community.comment: threaded comments, depth 1 or 2 (a reply to a reply is refused).
--   - community.reaction ('helpful'), bookmark, user_block, content_report.
-- Every table: ENABLE + FORCE row level security. The app role may only SELECT, and only
-- published rows plus the caller's own rows; every write goes through a definer function below.
-- Moderators act only through definer functions (content_review_queue, set_content_status,
-- report_queue, resolve_report); nobody moderates their own content. community_moderator has no
-- grant in priv.
-- core.ack already allows a commuter to record the community_guidelines acknowledgement (0000).
-- Not applied here: the controller applies this migration.

grant usage on schema community to paranaga_app, paranaga_definer;
grant create on schema community to paranaga_definer;

-- A pseudonymous, stable label for a user: the hub never shows names or ids.
create or replace function community.handle(p_user text) returns text
  language sql immutable
  set search_path = pg_catalog, pg_temp
as $$ select 'Commuter ' || upper(substr(pg_catalog.md5('paranaga-community|' || p_user), 1, 5)) $$;
grant execute on function community.handle(text) to paranaga_app, paranaga_definer;

-- ---------------------------------------------------------------- tables
create table community.post (
  id                   uuid primary key default pg_catalog.gen_random_uuid(),
  seq                  bigint generated always as identity,
  author_id            text not null,
  client_request_id    uuid not null,
  topic                text not null check (topic in ('commute_tips', 'first_time', 'route_stop_feedback')),
  route_code           text check (route_code is null or route_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,15}$'),
  label                text not null default 'community' check (label in ('community', 'official_notice', 'incorporated_change')),
  published_version_id uuid,
  helpful_count        integer not null default 0 check (helpful_count >= 0),
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (author_id, client_request_id)
);
create unique index post_seq_idx on community.post (seq);
create index post_feed_idx on community.post (seq desc) where published_version_id is not null and deleted_at is null;
create index post_author_idx on community.post (author_id, seq desc) where deleted_at is null;
create index post_topic_idx on community.post (topic, seq desc) where published_version_id is not null and deleted_at is null;

create table community.post_version (
  id                uuid primary key default pg_catalog.gen_random_uuid(),
  post_id           uuid not null references community.post (id) on delete cascade,
  n                 integer not null check (n >= 1),
  author_id         text not null,
  client_request_id uuid,
  title             text not null check (char_length(title) between 5 and 120),
  body              text not null check (char_length(body) between 10 and 2000),
  tags              text[] not null default '{}' check (cardinality(tags) <= 3),
  moderation_status text not null check (moderation_status in ('pending', 'published', 'rejected', 'human_review', 'superseded')),
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 60),
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  unique (post_id, n)
);
create unique index post_version_request_idx on community.post_version (post_id, client_request_id) where client_request_id is not null;
create index post_version_tags_idx on community.post_version using gin (tags);
create index post_version_status_idx on community.post_version (moderation_status, submitted_at)
  where moderation_status in ('pending', 'human_review');
-- At most one live version per post.
create unique index post_version_one_live_idx on community.post_version (post_id) where moderation_status = 'published';

alter table community.post
  add constraint post_published_version_fk foreign key (published_version_id) references community.post_version (id);

create table community.comment (
  id                uuid primary key default pg_catalog.gen_random_uuid(),
  post_id           uuid not null references community.post (id) on delete cascade,
  parent_comment_id uuid references community.comment (id),
  depth             smallint not null check (depth in (1, 2)),
  author_id         text not null,
  client_request_id uuid not null,
  body              text not null check (char_length(body) between 2 and 600),
  moderation_status text not null check (moderation_status in ('pending', 'published', 'rejected', 'human_review')),
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 60),
  helpful_count     integer not null default 0 check (helpful_count >= 0),
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  unique (author_id, client_request_id),
  check ((depth = 1) = (parent_comment_id is null))
);
create index comment_post_idx on community.comment (post_id, created_at, id) where deleted_at is null;
create index comment_status_idx on community.comment (moderation_status, created_at)
  where moderation_status in ('pending', 'human_review') and deleted_at is null;

create table community.reaction (
  user_id     text not null,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  kind        text not null default 'helpful' check (kind = 'helpful'),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table community.bookmark (
  user_id    text not null,
  post_id    uuid not null references community.post (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table community.user_block (
  id         uuid primary key default pg_catalog.gen_random_uuid(),
  blocker_id text not null,
  blocked_id text not null check (blocked_id <> blocker_id),
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

create table community.content_report (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  reporter_id text not null,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  reason      text not null check (reason in ('spam', 'harassment', 'personal_info', 'off_topic', 'misleading', 'other')),
  note        text check (note is null or char_length(note) <= 300),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  unique (reporter_id, target_type, target_id)
);
create index content_report_open_idx on community.content_report (created_at) where status = 'open';

-- ---------------------------------------------------------------- grants and RLS
grant select on community.post, community.post_version, community.comment, community.reaction,
  community.bookmark, community.user_block, community.content_report to paranaga_app;
grant select, insert, update on community.post, community.post_version, community.comment to paranaga_definer;
grant select, insert, update, delete on community.reaction, community.bookmark, community.user_block to paranaga_definer;
grant select, insert, update on community.content_report to paranaga_definer;

alter table community.post enable row level security;
alter table community.post force row level security;
alter table community.post_version enable row level security;
alter table community.post_version force row level security;
alter table community.comment enable row level security;
alter table community.comment force row level security;
alter table community.reaction enable row level security;
alter table community.reaction force row level security;
alter table community.bookmark enable row level security;
alter table community.bookmark force row level security;
alter table community.user_block enable row level security;
alter table community.user_block force row level security;
alter table community.content_report enable row level security;
alter table community.content_report force row level security;

-- Guests and commuters read published posts; an author also reads their own (pending) posts.
create policy post_read on community.post for select to paranaga_app
  using (deleted_at is null and (published_version_id is not null or author_id = (select core.current_user_id())));
-- A version is readable when published (and its post is readable), or when it is the caller's own.
create policy post_version_read on community.post_version for select to paranaga_app
  using (
    author_id = (select core.current_user_id())
    or (moderation_status = 'published' and exists (select 1 from community.post p where p.id = post_id))
  );
create policy comment_read on community.comment for select to paranaga_app
  using (
    deleted_at is null
    and exists (select 1 from community.post p where p.id = post_id)
    and (moderation_status = 'published' or author_id = (select core.current_user_id()))
  );
create policy reaction_own_read on community.reaction for select to paranaga_app
  using (user_id = (select core.current_user_id()));
create policy bookmark_own_read on community.bookmark for select to paranaga_app
  using (user_id = (select core.current_user_id()));
create policy user_block_own_read on community.user_block for select to paranaga_app
  using (blocker_id = (select core.current_user_id()));
create policy content_report_own_read on community.content_report for select to paranaga_app
  using (reporter_id = (select core.current_user_id()));

create policy post_definer on community.post for all to paranaga_definer using (true) with check (true);
create policy post_version_definer on community.post_version for all to paranaga_definer using (true) with check (true);
create policy comment_definer on community.comment for all to paranaga_definer using (true) with check (true);
create policy reaction_definer on community.reaction for all to paranaga_definer using (true) with check (true);
create policy bookmark_definer on community.bookmark for all to paranaga_definer using (true) with check (true);
create policy user_block_definer on community.user_block for all to paranaga_definer using (true) with check (true);
create policy content_report_definer on community.content_report for all to paranaga_definer using (true) with check (true);

-- ---------------------------------------------------------------- commuter writes (definer)
-- p_status is the moderation decision made by the server (decideModeration): 'pending' unless
-- auto-publish is on and Jev was confident; 'rejected' only on a high-certainty reject.
create or replace function community.create_post(
  p_client_request_id uuid,
  p_topic text,
  p_title text,
  p_body text,
  p_tags text[],
  p_route_code text,
  p_status text,
  p_reason text
) returns table (post_id uuid, version_id uuid, status text, created_at timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_post community.post%rowtype;
  v_version community.post_version%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in ('pending', 'published', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select * into v_post from community.post p where p.author_id = v_user and p.client_request_id = p_client_request_id;
  if not found then
    insert into community.post (author_id, client_request_id, topic, route_code)
    values (v_user, p_client_request_id, p_topic, p_route_code)
    returning * into v_post;
    insert into community.post_version (post_id, n, author_id, title, body, tags, moderation_status, moderation_reason, decided_at)
    values (v_post.id, 1, v_user, p_title, p_body, coalesce(p_tags, '{}'), p_status, p_reason,
            case when p_status = 'pending' then null else now() end)
    returning * into v_version;
    if p_status = 'published' then
      update community.post set published_version_id = v_version.id, updated_at = now() where id = v_post.id;
    end if;
  else
    select * into v_version from community.post_version pv where pv.post_id = v_post.id and pv.n = 1;
  end if;

  return query select v_post.id, v_version.id, v_version.moderation_status, v_post.created_at;
end;
$$;
alter function community.create_post(uuid, text, text, text, text[], text, text, text) owner to paranaga_definer;
revoke execute on function community.create_post(uuid, text, text, text, text[], text, text, text) from public;
grant execute on function community.create_post(uuid, text, text, text, text[], text, text, text) to paranaga_app;

-- An edit never touches the live version: it adds version n+1 as 'pending' (or 'published' when
-- auto-publish decided so, which then supersedes the old live one). An older unreviewed edit is
-- superseded by the newer one.
create or replace function community.edit_post(
  p_post_id uuid,
  p_client_request_id uuid,
  p_title text,
  p_body text,
  p_tags text[],
  p_status text,
  p_reason text
) returns table (post_id uuid, version_id uuid, n integer, status text, is_live boolean)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_post community.post%rowtype;
  v_version community.post_version%rowtype;
  v_next integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in ('pending', 'published', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_post from community.post p where p.id = p_post_id and p.deleted_at is null for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_post.author_id <> v_user then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_version from community.post_version pv where pv.post_id = p_post_id and pv.client_request_id = p_client_request_id;
  if not found then
    select coalesce(max(pv.n), 0) + 1 into v_next from community.post_version pv where pv.post_id = p_post_id;
    update community.post_version pv set moderation_status = 'superseded'
     where pv.post_id = p_post_id and pv.moderation_status in ('pending', 'human_review');
    if p_status = 'published' then
      update community.post_version pv set moderation_status = 'superseded'
       where pv.post_id = p_post_id and pv.moderation_status = 'published';
    end if;
    insert into community.post_version (post_id, n, author_id, client_request_id, title, body, tags, moderation_status, moderation_reason, decided_at)
    values (p_post_id, v_next, v_user, p_client_request_id, p_title, p_body, coalesce(p_tags, '{}'), p_status, p_reason,
            case when p_status = 'pending' then null else now() end)
    returning * into v_version;
    if p_status = 'published' then
      update community.post set published_version_id = v_version.id, updated_at = now() where id = p_post_id;
    else
      update community.post set updated_at = now() where id = p_post_id;
    end if;
  end if;

  return query select p_post_id, v_version.id, v_version.n, v_version.moderation_status, (v_version.moderation_status = 'published');
end;
$$;
alter function community.edit_post(uuid, uuid, text, text, text[], text, text) owner to paranaga_definer;
revoke execute on function community.edit_post(uuid, uuid, text, text, text[], text, text) from public;
grant execute on function community.edit_post(uuid, uuid, text, text, text[], text, text) to paranaga_app;

create or replace function community.delete_post(p_post_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update community.post set deleted_at = now(), updated_at = now()
   where id = p_post_id and author_id = v_user and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.delete_post(uuid) owner to paranaga_definer;
revoke execute on function community.delete_post(uuid) from public;
grant execute on function community.delete_post(uuid) to paranaga_app;

create or replace function community.create_comment(
  p_client_request_id uuid,
  p_post_id uuid,
  p_parent_comment_id uuid,
  p_body text,
  p_status text,
  p_reason text
) returns table (comment_id uuid, status text, depth smallint, created_at timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_row community.comment%rowtype;
  v_parent community.comment%rowtype;
  v_depth smallint := 1;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in ('pending', 'published', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select * into v_row from community.comment c where c.author_id = v_user and c.client_request_id = p_client_request_id;
  if not found then
    -- Only a live, published post takes comments.
    if not exists (select 1 from community.post p
                    where p.id = p_post_id and p.deleted_at is null and p.published_version_id is not null) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if p_parent_comment_id is not null then
      select * into v_parent from community.comment c
       where c.id = p_parent_comment_id and c.post_id = p_post_id and c.deleted_at is null
         and c.moderation_status = 'published';
      if not found then
        raise exception 'not found' using errcode = 'P0002';
      end if;
      -- Two levels only: a reply to a reply is refused.
      if v_parent.depth >= 2 then
        raise exception 'too deep' using errcode = '22023';
      end if;
      v_depth := v_parent.depth + 1;
    end if;
    insert into community.comment (post_id, parent_comment_id, depth, author_id, client_request_id, body,
                                   moderation_status, moderation_reason, decided_at)
    values (p_post_id, p_parent_comment_id, v_depth, v_user, p_client_request_id, p_body, p_status, p_reason,
            case when p_status = 'pending' then null else now() end)
    returning * into v_row;
  end if;

  return query select v_row.id, v_row.moderation_status, v_row.depth, v_row.created_at;
end;
$$;
alter function community.create_comment(uuid, uuid, uuid, text, text, text) owner to paranaga_definer;
revoke execute on function community.create_comment(uuid, uuid, uuid, text, text, text) from public;
grant execute on function community.create_comment(uuid, uuid, uuid, text, text, text) to paranaga_app;

create or replace function community.delete_comment(p_comment_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update community.comment set deleted_at = now()
   where id = p_comment_id and author_id = v_user and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.delete_comment(uuid) owner to paranaga_definer;
revoke execute on function community.delete_comment(uuid) from public;
grant execute on function community.delete_comment(uuid) to paranaga_app;

-- Helpful reaction: one per user and target, toggled. Only published, live content, never your own.
create or replace function community.toggle_reaction(p_target_type text, p_target_id uuid)
returns table (active boolean, helpful_count integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_author text;
  v_count integer;
  v_active boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target_type = 'post' then
    select p.author_id into v_author from community.post p
     where p.id = p_target_id and p.deleted_at is null and p.published_version_id is not null;
  elsif p_target_type = 'comment' then
    select c.author_id into v_author from community.comment c
     where c.id = p_target_id and c.deleted_at is null and c.moderation_status = 'published';
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_user then
    raise exception 'own content' using errcode = '22023';
  end if;

  delete from community.reaction r where r.user_id = v_user and r.target_type = p_target_type and r.target_id = p_target_id;
  if found then
    v_active := false;
  else
    insert into community.reaction (user_id, target_type, target_id) values (v_user, p_target_type, p_target_id);
    v_active := true;
  end if;

  if p_target_type = 'post' then
    update community.post p set helpful_count = (select count(*) from community.reaction r
                                                  where r.target_type = 'post' and r.target_id = p_target_id)
     where p.id = p_target_id returning p.helpful_count into v_count;
  else
    update community.comment c set helpful_count = (select count(*) from community.reaction r
                                                     where r.target_type = 'comment' and r.target_id = p_target_id)
     where c.id = p_target_id returning c.helpful_count into v_count;
  end if;
  return query select v_active, v_count;
end;
$$;
alter function community.toggle_reaction(text, uuid) owner to paranaga_definer;
revoke execute on function community.toggle_reaction(text, uuid) from public;
grant execute on function community.toggle_reaction(text, uuid) to paranaga_app;

create or replace function community.toggle_bookmark(p_post_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from community.bookmark b where b.user_id = v_user and b.post_id = p_post_id;
  if found then
    return false;
  end if;
  if not exists (select 1 from community.post p
                  where p.id = p_post_id and p.deleted_at is null and p.published_version_id is not null) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into community.bookmark (user_id, post_id) values (v_user, p_post_id);
  return true;
end;
$$;
alter function community.toggle_bookmark(uuid) owner to paranaga_definer;
revoke execute on function community.toggle_bookmark(uuid) from public;
grant execute on function community.toggle_bookmark(uuid) to paranaga_app;

-- Block the author of a post or comment. The client never learns the author's id.
create or replace function community.block_author(p_target_type text, p_target_id uuid)
returns table (block_id uuid, handle text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_author text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target_type = 'post' then
    select p.author_id into v_author from community.post p
     where p.id = p_target_id and p.deleted_at is null and p.published_version_id is not null;
  elsif p_target_type = 'comment' then
    select c.author_id into v_author from community.comment c
     where c.id = p_target_id and c.deleted_at is null and c.moderation_status = 'published';
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_user then
    raise exception 'own content' using errcode = '22023';
  end if;
  insert into community.user_block (blocker_id, blocked_id) values (v_user, v_author)
  on conflict (blocker_id, blocked_id) do nothing;
  select b.id into v_id from community.user_block b where b.blocker_id = v_user and b.blocked_id = v_author;
  return query select v_id, community.handle(v_author);
end;
$$;
alter function community.block_author(text, uuid) owner to paranaga_definer;
revoke execute on function community.block_author(text, uuid) from public;
grant execute on function community.block_author(text, uuid) to paranaga_app;

create or replace function community.unblock(p_block_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_count integer;
begin
  if core.current_user_id() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from community.user_block b where b.id = p_block_id and b.blocker_id = core.current_user_id();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.unblock(uuid) owner to paranaga_definer;
revoke execute on function community.unblock(uuid) from public;
grant execute on function community.unblock(uuid) to paranaga_app;

-- Report content: once per reporter and target, never your own, only content that is public.
create or replace function community.report_content(p_target_type text, p_target_id uuid, p_reason text, p_note text)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_author text;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target_type = 'post' then
    select p.author_id into v_author from community.post p
     where p.id = p_target_id and p.deleted_at is null and p.published_version_id is not null;
  elsif p_target_type = 'comment' then
    select c.author_id into v_author from community.comment c
     where c.id = p_target_id and c.deleted_at is null and c.moderation_status = 'published';
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_user then
    raise exception 'own content' using errcode = '22023';
  end if;
  insert into community.content_report (reporter_id, target_type, target_id, reason, note)
  values (v_user, p_target_type, p_target_id, p_reason, p_note)
  on conflict (reporter_id, target_type, target_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.report_content(text, uuid, text, text) owner to paranaga_definer;
revoke execute on function community.report_content(text, uuid, text, text) from public;
grant execute on function community.report_content(text, uuid, text, text) to paranaga_app;

-- ---------------------------------------------------------------- moderators (definer only)
create or replace function community.content_review_queue(p_limit integer default 50)
returns table (kind text, id uuid, post_id uuid, excerpt text, status text, submitted_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
begin
  if core.current_user_id() is null
     or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select * from (
    select 'post_version'::text, v.id, v.post_id, left(v.title, 120), v.moderation_status, v.submitted_at
      from community.post_version v
      join community.post p on p.id = v.post_id and p.deleted_at is null
     where v.moderation_status in ('pending', 'human_review') and v.author_id <> core.current_user_id()
    union all
    select 'comment'::text, c.id, c.post_id, left(c.body, 120), c.moderation_status, c.created_at
      from community.comment c
     where c.moderation_status in ('pending', 'human_review') and c.deleted_at is null
       and c.author_id <> core.current_user_id()
  ) q
  order by 6
  limit least(greatest(p_limit, 1), 200);
end;
$$;
alter function community.content_review_queue(integer) owner to paranaga_definer;
revoke execute on function community.content_review_queue(integer) from public;
grant execute on function community.content_review_queue(integer) to paranaga_app;

create or replace function community.set_content_status(p_kind text, p_id uuid, p_to text, p_reason text default null)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_author text;
  v_post uuid;
  v_status text;
begin
  if v_actor is null or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_to not in ('published', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_kind = 'post_version' then
    select v.author_id, v.post_id, v.moderation_status into v_author, v_post, v_status
      from community.post_version v where v.id = p_id for update;
    if not found then
      return false;
    end if;
    if v_author = v_actor then
      raise exception 'forbidden: own content' using errcode = '42501';
    end if;
    if v_status not in ('pending', 'human_review') then
      raise exception 'invalid transition' using errcode = '22023';
    end if;
    if p_to = 'published' then
      update community.post_version set moderation_status = 'superseded'
       where post_id = v_post and moderation_status = 'published';
    end if;
    update community.post_version set moderation_status = p_to, moderation_reason = left(p_reason, 60), decided_at = now()
     where id = p_id;
    if p_to = 'published' then
      update community.post set published_version_id = p_id, updated_at = now() where id = v_post;
    end if;
    return true;
  elsif p_kind = 'comment' then
    select c.author_id, c.moderation_status into v_author, v_status from community.comment c where c.id = p_id for update;
    if not found then
      return false;
    end if;
    if v_author = v_actor then
      raise exception 'forbidden: own content' using errcode = '42501';
    end if;
    if v_status not in ('pending', 'human_review') then
      raise exception 'invalid transition' using errcode = '22023';
    end if;
    update community.comment set moderation_status = p_to, moderation_reason = left(p_reason, 60), decided_at = now()
     where id = p_id;
    return true;
  end if;
  raise exception 'invalid kind' using errcode = '22023';
end;
$$;
alter function community.set_content_status(text, uuid, text, text) owner to paranaga_definer;
revoke execute on function community.set_content_status(text, uuid, text, text) from public;
grant execute on function community.set_content_status(text, uuid, text, text) to paranaga_app;

-- Open reports, without the reporter's identity.
create or replace function community.report_queue(p_limit integer default 50)
returns table (id uuid, target_type text, target_id uuid, reason text, note text, created_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
begin
  if core.current_user_id() is null
     or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at
    from community.content_report r
   where r.status = 'open'
   order by r.created_at
   limit least(greatest(p_limit, 1), 200);
end;
$$;
alter function community.report_queue(integer) owner to paranaga_definer;
revoke execute on function community.report_queue(integer) from public;
grant execute on function community.report_queue(integer) to paranaga_app;

create or replace function community.resolve_report(p_id uuid, p_status text) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_count integer;
begin
  if core.current_user_id() is null
     or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update community.content_report
     set status = p_status, resolved_by = core.current_user_id(), resolved_at = now()
   where id = p_id and status = 'open';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.resolve_report(uuid, text) owner to paranaga_definer;
revoke execute on function community.resolve_report(uuid, text) from public;
grant execute on function community.resolve_report(uuid, text) to paranaga_app;
