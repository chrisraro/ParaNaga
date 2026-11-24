-- 0038_reporter_actions.sql
-- What a reporter can do with their own report after sending it (docs/ERD.md §4.3, §4.6; spec 04 §4.7).
-- No table changes: an answer is the note of an event, deleted with the report.
--
-- 1. priv.withdraw_complaint(id): submitted or needs_information -> withdrawn, outcome
--    'reporter_withdrew', deleted 30 days later by the existing purge (owner decision 2026-11-24; a
--    closed report keeps 365 days; a legal hold stops the purge either way). Not while a reviewer has
--    it (under_review) and not once closed: 55000. Withdrawing twice is not an error.
-- 2. priv.answer_complaint(id, text, evidence): needs_information -> under_review, with the text as a
--    reporter event and up to 3 new files of the reporter's own (6 in total on a report).
-- 3. community.answer_correction(id, text, media ids): needs_evidence -> submitted, with the text as an
--    event and photos added to the report (3 in total, the existing CHECK).
-- All three: the signed-in owner only; null when the report is not theirs (the API answers 404, no
-- existence leak); 55000 when it is not waiting for that; 22023 for a bad text or file. The row is
-- locked, so a reviewer's decision at the same moment is seen. Audited without any report text.
--
-- Rollback:
--   drop function priv.withdraw_complaint(uuid), priv.answer_complaint(uuid, text, jsonb),
--     community.answer_correction(uuid, text, uuid[]);
--   delete from public.schema_migrations where name = '0038_reporter_actions.sql';

set local lock_timeout = '5s';

grant create on schema priv, community to paranaga_definer;

create or replace function priv.withdraw_complaint(p_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_from text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select c.status into v_from from priv.complaint c where c.id = p_id and c.reporter_id = v_user for update;
  if not found then
    return null;
  end if;
  if v_from = 'withdrawn' then
    return true;
  end if;
  if v_from not in ('submitted', 'needs_information') then
    raise exception 'this report can no longer be withdrawn' using errcode = '55000';
  end if;
  update priv.complaint c
     set status = 'withdrawn', outcome_code = 'reporter_withdrew', closed_at = now(),
         retention_until = now() + interval '30 days', updated_at = now()
   where c.id = p_id;
  insert into priv.complaint_event (complaint_id, from_status, to_status, actor_role, actor_id, visibility, outcome_code)
  values (p_id, v_from, 'withdrawn', 'reporter', v_user, 'reporter', 'reporter_withdrew');
  perform core.audit('complaint.withdraw', 'complaint', p_id::text, jsonb_build_object('from', v_from));
  return true;
end;
$$;
alter function priv.withdraw_complaint(uuid) owner to paranaga_definer;
revoke execute on function priv.withdraw_complaint(uuid) from public;
grant execute on function priv.withdraw_complaint(uuid) to paranaga_app;

-- p_evidence: as priv.submit_complaint: [{"mediaId": uuid, "captureKind": text, "capturedAt": timestamptz?}].
create or replace function priv.answer_complaint(p_id uuid, p_text text, p_evidence jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_text text := btrim(coalesce(p_text, ''));
  v_status text;
  v_ids uuid[];
  v_count integer;
  v_good integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_text) not between 1 and 1000 then
    raise exception 'invalid answer' using errcode = '22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'invalid evidence' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_evidence);
  if v_count > 3 then
    raise exception 'invalid evidence' using errcode = '22023';
  end if;
  select c.status into v_status from priv.complaint c where c.id = p_id and c.reporter_id = v_user for update;
  if not found then
    return null;
  end if;
  if v_status <> 'needs_information' then
    raise exception 'this report is not waiting for an answer' using errcode = '55000';
  end if;
  if v_count > 0 then
    select array_agg((e ->> 'mediaId')::uuid) into v_ids from jsonb_array_elements(p_evidence) e;
    if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
       or v_count + (select count(*) from priv.complaint_media cm where cm.complaint_id = p_id) > 6 then
      raise exception 'invalid evidence' using errcode = '22023';
    end if;
    -- Only the caller's own verified complaint uploads, in the private bucket, not used before.
    select count(*) into v_good from core.media_object m
     where m.id = any (v_ids)
       and m.owner_id = v_user
       and m.purpose = 'complaint_evidence'
       and m.status = 'verified'
       and m.bucket = 'evidence-private'
       and m.sha256 is not null
       and not exists (select 1 from priv.complaint_media cm where cm.media_object_id = m.id);
    if v_good <> v_count then
      raise exception 'invalid evidence' using errcode = '22023';
    end if;
    insert into priv.complaint_media (complaint_id, media_object_id, capture_kind, captured_at_client, sha256, original_key)
    select p_id, m.id, e ->> 'captureKind', (e ->> 'capturedAt')::timestamptz, m.sha256, m.object_key
      from jsonb_array_elements(p_evidence) e
      join core.media_object m on m.id = (e ->> 'mediaId')::uuid;
  end if;
  update priv.complaint c set status = 'under_review', updated_at = now() where c.id = p_id;
  insert into priv.complaint_event (complaint_id, from_status, to_status, actor_role, actor_id, visibility, note)
  values (p_id, 'needs_information', 'under_review', 'reporter', v_user, 'reporter', v_text);
  perform core.audit('complaint.answer', 'complaint', p_id::text, jsonb_build_object('evidence', v_count));
  return true;
end;
$$;
alter function priv.answer_complaint(uuid, text, jsonb) owner to paranaga_definer;
revoke execute on function priv.answer_complaint(uuid, text, jsonb) from public;
grant execute on function priv.answer_complaint(uuid, text, jsonb) to paranaga_app;

create or replace function community.answer_correction(p_id uuid, p_text text, p_media_ids uuid[]) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_text text := btrim(coalesce(p_text, ''));
  v_ids uuid[] := coalesce(p_media_ids, '{}');
  c community.correction%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_text) not between 1 and 1000 then
    raise exception 'invalid answer' using errcode = '22023';
  end if;
  select * into c from community.correction x where x.id = p_id and x.author_id = v_user for update;
  if not found then
    return null;
  end if;
  if c.status <> 'needs_evidence' then
    raise exception 'this report is not waiting for an answer' using errcode = '55000';
  end if;
  if cardinality(v_ids) + cardinality(c.media_ids) > 3
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or v_ids && c.media_ids
     or cardinality(v_ids) <> (select count(*) from core.media_object m
                                where m.id = any (v_ids) and m.owner_id = v_user
                                  and m.purpose = 'correction_evidence' and m.status = 'verified') then
    raise exception 'invalid media' using errcode = '22023';
  end if;
  update community.correction x
     set status = 'submitted', media_ids = c.media_ids || v_ids, updated_at = now()
   where x.id = p_id;
  insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role, note)
  values (p_id, 'needs_evidence', 'submitted', v_user, 'commuter', v_text);
  perform core.audit('correction.answer', 'community.correction', p_id::text, jsonb_build_object('photos', cardinality(v_ids)));
  return true;
end;
$$;
alter function community.answer_correction(uuid, text, uuid[]) owner to paranaga_definer;
revoke execute on function community.answer_correction(uuid, text, uuid[]) from public;
grant execute on function community.answer_correction(uuid, text, uuid[]) to paranaga_app;

revoke create on schema priv, community from paranaga_definer;
