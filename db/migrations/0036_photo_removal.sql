-- 0036_photo_removal.sql
-- Owner-approved rule (docs/ERD.md §4.6, 2026-11-24): the public copy of a photo goes when its post is
-- deleted or taken down, or the photo is taken down; the private original and the rows go 30 days
-- later, never while an appeal that can still be decided is open. The storage part is
-- src/server/community/photo-removal.ts: begin (committed), storage, finish. No lock is held while
-- storage works, and a step that never finishes is taken again.
--
-- 1. community.post_photo:
--    public_copy         what is known of the public object: 'ok' (as the decision left it),
--                        'removing' or 'restoring' (unknown until the step finishes), 'removed'.
--    removal_claimed_at  one worker at a time, for 5 minutes (longer than the storage timeouts); also
--                        the retry delay and the fair order of the list.
--    purge_started_at    from here on the original may be gone: the photo is hidden from everyone,
--                        cannot be appealed or decided, and only purging it is left.
--    A trigger resets public_copy when the state changes: to 'ok', because a decision makes or drops
--    the copy itself; or, when a step is under way, to 'restoring' (unknown) with a new claim, so the
--    step's result is ignored and the copy is settled once the step has certainly ended.
-- 2. community.photo_action(id), the one rule:
--    'purge'   - already started; or the post was deleted 30 days ago; or, with no open appeal on the
--                photo and no decision on it for 30 days, the photo was taken down 30 days ago; or the whole post was taken down,
--                nothing was decided or submitted on it or on the photo for 30 days, nothing waits
--                for review, and no appeal on a version is open. (An appeal on a deleted post can
--                never be decided, so it does not block.)
--    'remove'  - the copy should not be there and is not known to be gone.
--    'restore' - the post is live, the photo approved, and the copy is not known to be there.
-- 3. community.photo_removal_due(limit, purge): the list of purges or of copies, longest untried first.
-- 4. community.photo_removal_begin(id, action): locks the post, then the photo (the order of
--    content_target and submit_appeal), checks the rule again and records the step. Null when it is
--    not due any more or another worker has it. Returns the claim.
-- 5. community.photo_removal_finish(id, action, claim): the result, only for the claim that began it.
--    A purge deletes the rows and is audited with ids only.
--    All three for the system only.
-- 6. community.content_target: a photo whose purge started is gone (nothing else changes).
-- 7. Policies: the app never reads a photo whose purge started; the definer role deletes a post photo
--    only when its purge started, and a media object only when it is a community photo older than 30
--    days that no post uses any more; both only for the system.
--
-- Manual rollback (owner; a purged photo cannot come back):
--   drop trigger post_photo_state_change on community.post_photo;
--   drop policy post_photo_not_purged on community.post_photo; drop policy definer_purge on community.post_photo;
--   drop policy media_definer_purge_photo on core.media_object;
--   revoke delete on community.post_photo from paranaga_definer;
--   drop function community.photo_removal_begin(uuid, text), community.photo_removal_finish(uuid, text, timestamptz),
--     community.photo_removal_due(integer, boolean), community.photo_action(uuid), community.post_photo_state_change();
--   run the community.content_target block of 0032 (grant create on schema community first, revoke after);
--   alter table community.post_photo drop column public_copy, drop column removal_claimed_at, drop column purge_started_at;
--   delete from public.schema_migrations where name = '0036_photo_removal.sql';

set local lock_timeout = '5s';

grant create on schema community to paranaga_definer;

alter table community.post_photo
  add column public_copy text not null default 'ok' check (public_copy in ('ok', 'removing', 'removed', 'restoring')),
  add column removal_claimed_at timestamptz,
  add column purge_started_at timestamptz;
grant update (public_copy, removal_claimed_at, purge_started_at) on community.post_photo to paranaga_definer;

create or replace function community.post_photo_state_change() returns trigger
  language plpgsql
  set search_path = pg_catalog, community, pg_temp
as $$
begin
  if old.removal_claimed_at is null then
    new.public_copy := 'ok';
  else
    new.public_copy := 'restoring';
    new.removal_claimed_at := clock_timestamp();
  end if;
  return new;
end;
$$;
alter function community.post_photo_state_change() owner to paranaga_definer;
revoke execute on function community.post_photo_state_change() from public;
create trigger post_photo_state_change before update of moderation_status on community.post_photo
  for each row when (old.moderation_status is distinct from new.moderation_status)
  execute function community.post_photo_state_change();

create or replace function community.photo_action(p_id uuid) returns text
  language plpgsql stable
  set search_path = pg_catalog, community, pg_temp
as $$
declare
  c_cut constant timestamptz := now() - interval '30 days';
  ph community.post_photo%rowtype;
  p community.post%rowtype;
  v_post_down boolean;
begin
  select * into ph from community.post_photo x where x.id = p_id;
  if not found then
    return null;
  end if;
  select * into p from community.post x where x.id = ph.post_id;
  if ph.purge_started_at is not null or p.deleted_at <= c_cut then
    return 'purge';
  end if;
  v_post_down := p.deleted_at is null and p.published_version_id is null
    and exists (select 1 from community.post_version v where v.post_id = p.id and v.taken_down_at is not null);

  if ph.moderation_status <> 'pending'
     and not exists (select 1 from community.appeal a
                      where a.status = 'open' and a.target_type = 'photo' and a.target_id = ph.id)
     -- An upheld appeal changes no row of the item; the decision itself is what is recent.
     and not exists (select 1 from community.moderation_decision d
                      where d.target_type = 'photo' and d.target_id = ph.id and d.created_at > c_cut) then
    if ph.taken_down_at <= c_cut then
      return 'purge';
    end if;
    if v_post_down
       and coalesce(greatest(ph.decided_at, ph.taken_down_at), '-infinity') <= c_cut
       and not exists (select 1 from community.post_version v
                        where v.post_id = p.id
                          and (v.moderation_status in ('pending', 'human_review')
                               or greatest(v.submitted_at, v.decided_at, v.taken_down_at) > c_cut))
       and not exists (select 1 from community.moderation_decision d
                         join community.post_version v on v.id = d.target_id
                        where d.target_type = 'post_version' and v.post_id = p.id and d.created_at > c_cut)
       and not exists (select 1 from community.appeal a
                         join community.post_version v on v.id = a.target_id
                        where a.status = 'open' and a.target_type = 'post_version' and v.post_id = p.id) then
      return 'purge';
    end if;
  end if;

  if ph.moderation_status = 'published' and p.deleted_at is null and p.published_version_id is not null then
    return case when ph.public_copy <> 'ok' then 'restore' end;
  end if;
  if ph.public_copy in ('removing', 'restoring')
     or (ph.public_copy = 'ok'
         and (ph.taken_down_at is not null or (ph.moderation_status = 'published' and (p.deleted_at is not null or v_post_down)))) then
    return 'remove';
  end if;
  return null;
end;
$$;
alter function community.photo_action(uuid) owner to paranaga_definer;
revoke execute on function community.photo_action(uuid) from public;

create or replace function community.photo_removal_due(p_limit integer, p_purge boolean) returns table (id uuid, action text)
  language plpgsql stable security definer
  set search_path = pg_catalog, community, priv, core, pg_temp
as $$
begin
  perform priv.assert_system();
  return query
    select x.id, x.a
      from (select ph.id, community.photo_action(ph.id) as a, ph.removal_claimed_at, ph.created_at
              from community.post_photo ph
              join community.post p on p.id = ph.post_id
             where (p.deleted_at is not null or p.published_version_id is null
                    or ph.taken_down_at is not null or ph.public_copy <> 'ok' or ph.purge_started_at is not null)
               and (ph.removal_claimed_at is null or ph.removal_claimed_at < clock_timestamp() - interval '5 minutes')) x
     where x.a is not null and (x.a = 'purge') = coalesce(p_purge, false)
     order by x.removal_claimed_at nulls first, x.created_at, x.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
alter function community.photo_removal_due(integer, boolean) owner to paranaga_definer;
revoke execute on function community.photo_removal_due(integer, boolean) from public;
grant execute on function community.photo_removal_due(integer, boolean) to paranaga_app;

create or replace function community.photo_removal_begin(p_id uuid, p_action text) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, priv, core, pg_temp
as $$
declare
  ph community.post_photo%rowtype;
  m core.media_object%rowtype;
  v_claim timestamptz;
begin
  perform priv.assert_system();
  perform 1 from community.post p
    where p.id = (select x.post_id from community.post_photo x where x.id = p_id) for update;
  select * into ph from community.post_photo x where x.id = p_id for update;
  v_claim := clock_timestamp();
  if ph.id is null or ph.removal_claimed_at >= v_claim - interval '5 minutes'
     or p_action is null or community.photo_action(p_id) is distinct from p_action then
    return null;
  end if;
  select * into m from core.media_object x where x.id = ph.media_object_id;
  if m.purpose is distinct from 'community_photo' then
    raise exception 'not a community photo' using errcode = '55000';
  end if;
  update community.post_photo x
     set removal_claimed_at = v_claim,
         purge_started_at = case when p_action = 'purge' then coalesce(x.purge_started_at, v_claim) else x.purge_started_at end,
         public_copy = case p_action when 'remove' then 'removing' when 'restore' then 'restoring' else x.public_copy end
   where x.id = p_id;
  return jsonb_build_object('claim', v_claim, 'bucket', m.bucket, 'key', m.object_key, 'publicBucket', ph.public_bucket);
end;
$$;
alter function community.photo_removal_begin(uuid, text) owner to paranaga_definer;
revoke execute on function community.photo_removal_begin(uuid, text) from public;
grant execute on function community.photo_removal_begin(uuid, text) to paranaga_app;

create or replace function community.photo_removal_finish(p_id uuid, p_action text, p_claim timestamptz) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, priv, core, pg_temp
as $$
declare
  ph community.post_photo%rowtype;
begin
  perform priv.assert_system();
  perform 1 from community.post p
    where p.id = (select x.post_id from community.post_photo x where x.id = p_id) for update;
  select * into ph from community.post_photo x where x.id = p_id for update;
  if ph.id is null or p_claim is null or ph.removal_claimed_at is distinct from p_claim then
    return false;
  end if;
  if p_action = 'purge' and ph.purge_started_at is not null then
    delete from community.post_photo x where x.id = ph.id;
    if not found then
      raise exception 'the photo could not be removed' using errcode = '55000';
    end if;
    delete from core.media_object x where x.id = ph.media_object_id;
    if not found then
      raise exception 'the photo could not be removed' using errcode = '55000';
    end if;
    insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
    values (null, 'system', 'retention.purge_photo', 'community.photo', ph.id::text,
            jsonb_build_object('post_id', ph.post_id), core.current_request_id());
    return true;
  end if;
  if not ((p_action = 'remove' and ph.public_copy = 'removing') or (p_action = 'restore' and ph.public_copy = 'restoring')) then
    return false;
  end if;
  update community.post_photo x
     set removal_claimed_at = null, public_copy = case p_action when 'remove' then 'removed' else 'ok' end
   where x.id = ph.id;
  return true;
end;
$$;
alter function community.photo_removal_finish(uuid, text, timestamptz) owner to paranaga_definer;
revoke execute on function community.photo_removal_finish(uuid, text, timestamptz) from public;
grant execute on function community.photo_removal_finish(uuid, text, timestamptz) to paranaga_app;

-- ================================================================ 6. a photo being purged is gone
create or replace function community.content_target(p_type text, p_id uuid, out o_author text, out o_status text, out o_post uuid)
  language plpgsql volatile
  set search_path = pg_catalog, community, pg_temp
as $$
begin
  if p_type = 'comment' then
    select c.author_id, c.moderation_status, c.post_id into o_author, o_status, o_post
      from community.comment c where c.id = p_id and c.deleted_at is null for update;
    return;
  elsif p_type = 'post_version' then
    select v.post_id into o_post from community.post_version v where v.id = p_id;
  elsif p_type = 'photo' then
    select ph.post_id into o_post from community.post_photo ph where ph.id = p_id;
  else
    raise exception 'unknown content type' using errcode = '22023';
  end if;
  perform 1 from community.post p where p.id = o_post and p.deleted_at is null for update;
  if not found then
    o_post := null;
    return;
  end if;
  if p_type = 'post_version' then
    select v.author_id, v.moderation_status into o_author, o_status
      from community.post_version v where v.id = p_id for update;
  else
    select ph.author_id, ph.moderation_status into o_author, o_status
      from community.post_photo ph where ph.id = p_id and ph.purge_started_at is null for update;
  end if;
end;
$$;
alter function community.content_target(text, uuid) owner to paranaga_definer;
revoke execute on function community.content_target(text, uuid) from public;

-- ================================================================ 7. policies
create policy post_photo_not_purged on community.post_photo as restrictive for select to paranaga_app
  using (purge_started_at is null);
grant delete on community.post_photo to paranaga_definer;
create policy definer_purge on community.post_photo for delete to paranaga_definer
  using (core.current_user_id() is null and purge_started_at is not null);
create policy media_definer_purge_photo on core.media_object for delete to paranaga_definer
  using (core.current_user_id() is null and purpose = 'community_photo' and created_at < now() - interval '30 days'
         and not exists (select 1 from community.post_photo ph where ph.media_object_id = media_object.id));

revoke create on schema community from paranaga_definer;
