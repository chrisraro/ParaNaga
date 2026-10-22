-- 0022_step_up.sql
-- N3 (docs/spec/07-delivery.md §7.11): step-up verification, spec 05 §5.4 ("fresh OTP within 15 min").
-- 0018's priv.require_step_up() checks the transaction-local setting app.step_up_at, but nothing
-- ever set it, so every gated function failed closed. This migration adds the server-side record
-- that setting is filled from:
--   - core.step_up: one row per (user, Neon Auth session), keyed by sha256(session id). It holds the
--     open challenge (a code was sent) and the last verification time. paranaga_app has no grant on
--     it: definer functions only, scoped to core.current_user_id().
--   - core.step_up_begin(key): the server sent a fresh email OTP (Neon Auth email-otp, type
--     sign-in); opens a 10-minute challenge for this session. Audited.
--   - core.step_up_pending(key): is a challenge open for this session (checked before the code is
--     sent to Neon Auth for checking).
--   - core.step_up_finish(key, ok): the server checked the code with Neon Auth. On success, and
--     only if a challenge is open, records verified_at = now() and closes the challenge (so one sent
--     code gives one step-up). Success and failure are both audited, without the code.
--   - core.step_up_apply(key): called first in the same transaction as a protected query; sets
--     app.step_up_at (transaction-local) from verified_at when it is under 15 minutes old, else
--     clears it. priv.require_step_up() then passes or fails closed as before.
--   - priv.my_evidence_download now calls priv.require_step_up() (0018 TODO, spec §5.8): a reporter
--     downloading their own ORIGINAL needs a fresh step-up. It sits before the ownership lookup, so
--     the answer without step-up is the same for every id (no existence leak) and no
--     evidence_access row is written.
-- The OTP itself is generated, sent, stored and checked by Neon Auth (Better Auth email-otp
-- plugin); no code, hash or secret is stored here. Trust model unchanged: only the app server
-- (paranaga_app) calls these, after it checked the code.

grant create on schema core to paranaga_definer;
grant create on schema priv to paranaga_definer;

create table core.step_up (
  user_id       text not null,
  session_key   text not null check (session_key ~ '^[0-9a-f]{64}$'),
  challenged_at timestamptz,
  verified_at   timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, session_key)
);
alter table core.step_up enable row level security;
alter table core.step_up force row level security;
revoke all on core.step_up from public;
grant select, insert, update, delete on core.step_up to paranaga_definer;
create policy step_up_definer_own on core.step_up for all to paranaga_definer
  using (user_id = core.current_user_id())
  with check (user_id = core.current_user_id());

create or replace function core.step_up_begin(p_session_key text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_session_key is null or p_session_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid session key' using errcode = '22023';
  end if;
  -- Housekeeping: the caller's rows for other, idle sessions.
  delete from core.step_up s
   where s.user_id = v_user and s.session_key <> p_session_key and s.updated_at < now() - interval '1 day';
  insert into core.step_up (user_id, session_key, challenged_at, updated_at)
  values (v_user, p_session_key, now(), now())
  on conflict (user_id, session_key) do update set challenged_at = now(), updated_at = now();
  perform core.audit('step_up.request', 'step_up', null, null);
end;
$$;
alter function core.step_up_begin(text) owner to paranaga_definer;
revoke execute on function core.step_up_begin(text) from public;
grant execute on function core.step_up_begin(text) to paranaga_app;

create or replace function core.step_up_pending(p_session_key text) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, core, pg_temp
as $$
  select exists (
    select 1 from core.step_up s
     where s.user_id = core.current_user_id() and s.session_key = p_session_key
       and s.challenged_at > now() - interval '10 minutes')
$$;
alter function core.step_up_pending(text) owner to paranaga_definer;
revoke execute on function core.step_up_pending(text) from public;
grant execute on function core.step_up_pending(text) to paranaga_app;

create or replace function core.step_up_finish(p_session_key text, p_ok boolean) returns timestamptz
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_ok is true then
    update core.step_up s
       set verified_at = now(), challenged_at = null, updated_at = now()
     where s.user_id = v_user and s.session_key = p_session_key
       and s.challenged_at > now() - interval '10 minutes'
    returning s.verified_at into v_at;
  end if;
  if v_at is null then
    perform core.audit('step_up.failure', 'step_up', null,
      jsonb_build_object('reason', case when p_ok is true then 'no_challenge' else 'code' end));
    return null;
  end if;
  perform core.audit('step_up.success', 'step_up', null, null);
  return v_at;
end;
$$;
alter function core.step_up_finish(text, boolean) owner to paranaga_definer;
revoke execute on function core.step_up_finish(text, boolean) from public;
grant execute on function core.step_up_finish(text, boolean) to paranaga_app;

-- Same 15-minute window as priv.require_step_up(). set_config(..., true) is transaction-local, so
-- the value never reaches the next user of a pooled connection.
create or replace function core.step_up_apply(p_session_key text) returns timestamptz
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_at timestamptz;
begin
  select s.verified_at into v_at
    from core.step_up s
   where s.user_id = core.current_user_id() and s.session_key = p_session_key
     and s.verified_at > now() - interval '15 minutes' and s.verified_at <= now() + interval '1 minute';
  perform set_config('app.step_up_at', coalesce(v_at::text, ''), true);
  return v_at;
end;
$$;
alter function core.step_up_apply(text) owner to paranaga_definer;
revoke execute on function core.step_up_apply(text) from public;
grant execute on function core.step_up_apply(text) to paranaga_app;

-- ---------------------------------------------------------------- reporter's own evidence
-- 0018's function plus the step-up gate (signature, owner and grants unchanged).
create or replace function priv.my_evidence_download(p_complaint_id uuid, p_evidence_id uuid)
returns table (bucket text, object_key text, mime text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_media uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform priv.require_step_up();
  select cm.media_object_id into v_media
    from priv.complaint_media cm
    join priv.complaint c on c.id = cm.complaint_id
   where cm.id = p_evidence_id and c.id = p_complaint_id and c.reporter_id = v_user_id;
  if not found then
    return;
  end if;
  insert into priv.evidence_access (complaint_id, media_object_id, accessor_id, accessor_role, purpose, expires_at, request_id)
  values (p_complaint_id, v_media, v_user_id, 'reporter', 'reporter_download', now() + interval '60 seconds', core.current_request_id());
  return query
  select m.bucket, m.object_key, m.mime from core.media_object m
   where m.id = v_media and m.status = 'verified' and m.bucket = 'evidence-private';
end;
$$;
alter function priv.my_evidence_download(uuid, uuid) owner to paranaga_definer;
revoke execute on function priv.my_evidence_download(uuid, uuid) from public;
grant execute on function priv.my_evidence_download(uuid, uuid) to paranaga_app;

revoke create on schema core from paranaga_definer;
revoke create on schema priv from paranaga_definer;
