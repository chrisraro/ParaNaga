-- 0028_media_confirm_hardening.sql
-- Fix batch A (audit 2026-10-28, database I1). Same signatures as 0015, so callers are unchanged.
--   core.verify_and_promote_media  locks the row (FOR UPDATE) and returns true only when its own
--                                  UPDATE promoted the slot. Two racing confirms of one slot can
--                                  no longer both get true; the loser deletes only its own
--                                  per-attempt object (src/server/media/service.ts).
--   core.reject_media              the same: locks the row, true only when a slot was rejected.
-- Ownership checks and grants are as in 0015. FOR UPDATE also applies the definer's UPDATE policy
-- (0018 media_definer_promote: status = 'slot'), so a row that is no longer a slot is "not found"
-- and both functions return false for it, as before; nothing is changed either way.

grant create on schema core to paranaga_definer;

create or replace function core.verify_and_promote_media(
  p_slot_id uuid,
  p_dest_bucket text,
  p_dest_key text,
  p_sha256 text,
  p_bytes bigint,
  p_mime text
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_owner_id text;
  v_status text;
begin
  select owner_id, status into v_owner_id, v_status
    from core.media_object
   where id = p_slot_id
     for update;

  if not found then
    return false;
  end if;

  -- Ensure only the owner (or definer) can confirm
  if v_user_id is not null and v_owner_id <> v_user_id then
    raise exception 'forbidden: not slot owner' using errcode = '42501';
  end if;

  if v_status <> 'slot' then
    return false;
  end if;

  update core.media_object
     set bucket = p_dest_bucket,
         object_key = p_dest_key,
         sha256 = p_sha256,
         bytes = p_bytes,
         mime = p_mime,
         status = 'verified',
         verified_at = now()
   where id = p_slot_id
     and status = 'slot';

  return found;
end;
$$;
alter function core.verify_and_promote_media(uuid, text, text, text, bigint, text) owner to paranaga_definer;
revoke execute on function core.verify_and_promote_media(uuid, text, text, text, bigint, text) from public;
grant execute on function core.verify_and_promote_media(uuid, text, text, text, bigint, text) to paranaga_app;

create or replace function core.reject_media(
  p_slot_id uuid
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_owner_id text;
begin
  select owner_id into v_owner_id
    from core.media_object
   where id = p_slot_id
     for update;

  if not found then
    return false;
  end if;

  if v_user_id is not null and v_owner_id <> v_user_id then
    raise exception 'forbidden: not slot owner' using errcode = '42501';
  end if;

  update core.media_object
     set status = 'rejected'
   where id = p_slot_id
     and status = 'slot';

  return found;
end;
$$;
alter function core.reject_media(uuid) owner to paranaga_definer;
revoke execute on function core.reject_media(uuid) from public;
grant execute on function core.reject_media(uuid) to paranaga_app;

revoke create on schema core from paranaga_definer;
