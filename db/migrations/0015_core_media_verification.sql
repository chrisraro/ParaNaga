-- 0015_core_media_verification.sql
-- Increment B, Task B4: Media slot creation, verification and promotion definer functions.
--   - core.create_media_slot(p_purpose, p_expected_bytes, p_mime)
--     Creates a quarantine slot row for current user.
--   - core.verify_and_promote_media(p_slot_id, p_dest_bucket, p_dest_key, p_sha256, p_bytes, p_mime)
--     Promotes verified media object with SHA-256 and marks status = 'verified'.
--   - core.reject_media(p_slot_id, p_reason)
--     Marks media object status = 'rejected'.
--   - core.sweep_orphan_media_slots(p_older_than)
--     Identifies unconfirmed slots older than threshold (1 hour) for cleanup.

grant create on schema core to paranaga_definer;

-- Slot creation definer function
create or replace function core.create_media_slot(
  p_purpose text,
  p_expected_bytes bigint,
  p_mime text default null
) returns table (
  id uuid,
  bucket text,
  object_key text,
  expected_bytes bigint
)
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_id uuid := pg_catalog.gen_random_uuid();
  v_year text := to_char(now(), 'YYYY');
  v_key text;
  v_bucket text := 'quarantine';
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_purpose not in ('community_photo', 'correction_evidence', 'stop_photo', 'complaint_evidence') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;

  if p_expected_bytes <= 0 or p_expected_bytes > 26214400 then -- 25MB cap
    raise exception 'invalid expected bytes' using errcode = '22023';
  end if;

  v_key := 'quarantine/' || p_purpose || '/' || v_year || '/' || v_id::text;

  insert into core.media_object (
    id, bucket, object_key, mime, expected_bytes, owner_id, purpose, status
  ) values (
    v_id, v_bucket, v_key, p_mime, p_expected_bytes, v_user_id, p_purpose, 'slot'
  );

  return query
  select v_id, v_bucket, v_key, p_expected_bytes;
end;
$$;
alter function core.create_media_slot(text, bigint, text) owner to paranaga_definer;
revoke execute on function core.create_media_slot(text, bigint, text) from public;
grant execute on function core.create_media_slot(text, bigint, text) to paranaga_app;

-- Verify and promote media
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
   where id = p_slot_id;

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

  return true;
end;
$$;
alter function core.verify_and_promote_media(uuid, text, text, text, bigint, text) owner to paranaga_definer;
revoke execute on function core.verify_and_promote_media(uuid, text, text, text, bigint, text) from public;
grant execute on function core.verify_and_promote_media(uuid, text, text, text, bigint, text) to paranaga_app;

-- Reject media
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
   where id = p_slot_id;

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

  return true;
end;
$$;
alter function core.reject_media(uuid) owner to paranaga_definer;
revoke execute on function core.reject_media(uuid) from public;
grant execute on function core.reject_media(uuid) to paranaga_app;

-- Orphan sweep query helper
create or replace function core.find_orphan_media_slots(
  p_older_than interval default interval '1 hour'
) returns table (
  id uuid,
  bucket text,
  object_key text
)
  language sql stable security definer
  set search_path = pg_catalog, core, pg_temp
as $$
  select id, bucket, object_key
    from core.media_object
   where status = 'slot'
     and created_at < now() - p_older_than;
$$;
alter function core.find_orphan_media_slots(interval) owner to paranaga_definer;
revoke execute on function core.find_orphan_media_slots(interval) from public;
grant execute on function core.find_orphan_media_slots(interval) to paranaga_app;

revoke create on schema core from paranaga_definer;
