-- 0037_photo_recheck.sql
-- The server deletes a photo's public copy directly in two places (src/server/admin/review-handlers.ts):
-- after a photo take-down, and when a photo approval failed. That delete can land after another
-- moderator's approval of the same photo made a new copy, and nothing repaired it (0036 trusts 'ok').
--
-- community.photo_recheck(bucket key): called before such a delete. Marks the photo's copy unknown
-- ('restoring', 0036) with a fresh claim, so no step runs while the delete may still land; after 5
-- minutes the daily job copies the photo again (approved and live) or removes the copy (otherwise).
-- An approval meanwhile keeps the mark (the 0036 trigger). System only; false when there is no such
-- photo or its purge started.
--
-- Rollback: drop function community.photo_recheck(text);
--   delete from public.schema_migrations where name = '0037_photo_recheck.sql';

set local lock_timeout = '5s';

grant create on schema community to paranaga_definer;

create or replace function community.photo_recheck(p_key text) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, priv, core, pg_temp
as $$
declare
  v_id uuid;
begin
  perform priv.assert_system();
  select ph.id into v_id
    from community.post_photo ph join core.media_object m on m.id = ph.media_object_id
   where m.object_key = p_key and m.purpose = 'community_photo';
  if not found then
    return false;
  end if;
  -- The post, then the photo: the order of content_target.
  perform 1 from community.post p
    where p.id = (select x.post_id from community.post_photo x where x.id = v_id) for update;
  update community.post_photo x
     set public_copy = 'restoring', removal_claimed_at = clock_timestamp()
   where x.id = v_id and x.purge_started_at is null;
  return found;
end;
$$;
alter function community.photo_recheck(text) owner to paranaga_definer;
revoke execute on function community.photo_recheck(text) from public;
grant execute on function community.photo_recheck(text) to paranaga_app;

revoke create on schema community from paranaga_definer;
