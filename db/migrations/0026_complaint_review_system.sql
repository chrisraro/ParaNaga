-- 0026_complaint_review_system.sql
-- N7 (docs/spec/07-delivery.md §7.11): admin console C11 (complaint review) and C12 (users and
-- roles, audit log), plus the driver-evidence retention purge. Additive only (functions replaced
-- with the same signatures, new policies, new grants, new indexes).
--
-- C11 complaint review (role complaint_reviewer ONLY; admin does not imply it: the spec's admin
-- path is break-glass with a reason and notification of the other admins, not built here):
--   priv.assert_complaint_reviewer()   helper: the role first (else 42501 'forbidden', which the API
--                                      answers as 404), then a fresh step-up (priv.require_step_up).
--   priv.review_list(scope, limit)     the open or closed queue without the text, the evidence or
--                                      the reporter: reference, category, status, queue, dates,
--                                      evidence count. Never the reviewer's own reports. Audited.
--   priv.review_complaint(id)          one report in full for the reviewer (never reporter_id or
--                                      storage keys); evidence metadata only (no previews); history;
--                                      evidence access log. Audited 'complaint.review.open'; the 31st
--                                      open by one reviewer within 24 hours also writes
--                                      'complaint.review.alert' (spec 05 §5.5 rate watch).
--   priv.reviewer_evidence_download    0018's function, now through the helper and also audited
--                                      'complaint.evidence.read' (the priv.evidence_access row stays).
--   priv.set_complaint_status          unchanged (0018): role, step-up, transitions, audit.
--   priv.set_complaint_legal_hold(id, hold, note)  suspends or resumes the retention purge; the
--                                      note is a reviewer-only event, the audit row has no text.
--
-- Retention (spec 04 §4.8, 05 §5.8): closed and withdrawn reports are purged once retention_until
-- (set to closure + 365 days by set_complaint_status; closure/last update + 365 days when unset)
-- has passed, unless legal_hold. Evidence uploads never attached to a report are purged after 30
-- days. The server (src/server/complaints/retention.ts, /api/cron/retention, CRON_SECRET) deletes
-- the storage objects first, checks they are gone, then calls the purge functions, which delete the
-- rows together in one transaction and audit as 'system'. Callable only without a user in the
-- request context (the cron route); a signed-in request is refused.
--   priv.retention_due(limit)          what is due: complaints with their objects, abandoned uploads.
--   priv.retention_purge_complaint(id) deletes access log, handoff, events, evidence rows, the
--                                      complaint and its media objects; re-checks due under a lock.
--   priv.retention_purge_upload(id)    deletes one abandoned complaint_evidence media row.
--   priv.retention_record_run(...)     the run summary (counts only), audited 'retention.run'.
--   Deletes are granted to paranaga_definer on exactly these tables, each with a RESTRICTIVE delete
--   policy that only matches purgeable rows of a system caller, whatever the function does.
--
-- C12 users and roles (admin only; spec 05 §5.3, §5.4):
--   core.grant_role / core.revoke_role (same signatures as 0000) now also require a fresh step-up
--   and a reason, refuse any change to your own roles, refuse unknown users (no profile) and the
--   commuter role as a grant, and never remove the last active admin (advisory lock + count).
--   core.admin_find_user(email)        exact email match only (no listing, no prefix search), via
--                                      neon_auth."user" (select on four columns, granted here).
--   core.admin_staff()                 everyone holding a role other than commuter.
-- Audit log: core.audit_event stays append-only and admin-readable; staff (transport reviewer,
-- community moderator, complaint reviewer) now read their own rows (spec 05 §5.3 "own actions").
-- The definer may read it too (the rate watch above counts opens).

grant create on schema priv to paranaga_definer;
grant create on schema core to paranaga_definer;

-- ================================================================ C11 complaint review

create or replace function priv.assert_complaint_reviewer() returns text
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null or not core.has_role('complaint_reviewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform priv.require_step_up();
  return v_user;
end;
$$;
alter function priv.assert_complaint_reviewer() owner to paranaga_definer;
revoke execute on function priv.assert_complaint_reviewer() from public;

create or replace function priv.review_list(p_scope text default 'open', p_limit integer default 100)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user text := priv.assert_complaint_reviewer();
  v_out jsonb;
begin
  if p_scope is null or p_scope not in ('open', 'closed') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  perform core.audit('complaint.queue.read', 'complaint', null, jsonb_build_object('scope', p_scope));
  select coalesce(jsonb_agg(x.j order by x.rank_a, x.rank_b), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object(
               'id', c.id, 'publicRef', c.public_ref, 'category', c.category, 'status', c.status,
               'queue', c.queue, 'submittedAt', c.submitted_at, 'incidentAt', c.incident_at,
               'updatedAt', c.updated_at, 'closedAt', c.closed_at, 'outcomeCode', c.outcome_code,
               'legalHold', c.legal_hold,
               'evidenceCount', (select count(*) from priv.complaint_media cm where cm.complaint_id = c.id)) as j,
             case when p_scope = 'open' then (case when c.queue = 'queue_priority' then 0 else 1 end) else 0 end as rank_a,
             case when p_scope = 'open' then extract(epoch from c.submitted_at)
                  else -extract(epoch from coalesce(c.closed_at, c.updated_at)) end as rank_b
        from priv.complaint c
       where c.reporter_id <> v_user
         and ((p_scope = 'open' and c.status in ('submitted', 'under_review', 'needs_information'))
           or (p_scope = 'closed' and c.status in ('closed', 'withdrawn')))
       order by rank_a, rank_b
       limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) x;
  return v_out;
end;
$$;
alter function priv.review_list(text, integer) owner to paranaga_definer;
revoke execute on function priv.review_list(text, integer) from public;
grant execute on function priv.review_list(text, integer) to paranaga_app;

-- NULL when there is no such report or it is the reviewer's own (the API answers 404 either way).
create or replace function priv.review_complaint(p_id uuid)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, extensions, pg_temp
as $$
declare
  v_user text := priv.assert_complaint_reviewer();
  v_c priv.complaint%rowtype;
  v_opens integer;
begin
  select * into v_c from priv.complaint c where c.id = p_id;
  if not found or v_c.reporter_id = v_user then
    return null;
  end if;
  perform core.audit('complaint.review.open', 'complaint', p_id::text, null);
  select count(*) into v_opens from core.audit_event a
   where a.actor_user_id = v_user and a.action = 'complaint.review.open' and a.at > now() - interval '24 hours';
  if v_opens = 31 then
    perform core.audit('complaint.review.alert', 'user', v_user, jsonb_build_object('opens24h', v_opens));
  end if;
  return jsonb_build_object(
    'id', v_c.id, 'publicRef', v_c.public_ref, 'category', v_c.category, 'description', v_c.description,
    'incidentAt', v_c.incident_at, 'status', v_c.status, 'outcomeCode', v_c.outcome_code, 'queue', v_c.queue,
    'legalHold', v_c.legal_hold, 'retentionUntil', v_c.retention_until, 'submittedAt', v_c.submitted_at,
    'closedAt', v_c.closed_at, 'operator', v_c.operator_text, 'plate', v_c.plate_text, 'bodyNumber', v_c.body_number_text,
    'location', jsonb_build_object(
      'source', v_c.location_source, 'text', v_c.location_text, 'accuracyM', v_c.location_accuracy_m,
      'lat', case when v_c.incident_location is not null then round(extensions.ST_Y(v_c.incident_location::extensions.geometry)::numeric, 6) end,
      'lng', case when v_c.incident_location is not null then round(extensions.ST_X(v_c.incident_location::extensions.geometry)::numeric, 6) end),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cm.id, 'captureKind', cm.capture_kind, 'capturedAt', cm.captured_at_client,
               'receivedAt', cm.received_at_server, 'mime', m.mime, 'bytes', m.bytes, 'sha256', cm.sha256,
               'available', m.status = 'verified' and m.bucket = 'evidence-private')
             order by cm.received_at_server)
        from priv.complaint_media cm join core.media_object m on m.id = cm.media_object_id
       where cm.complaint_id = p_id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from', e.from_status, 'to', e.to_status, 'actorRole', e.actor_role,
               'mine', e.actor_id is not distinct from v_user and e.actor_role = 'complaint_reviewer',
               'visibility', e.visibility, 'outcomeCode', e.outcome_code, 'note', e.note, 'at', e.at)
             order by e.at)
        from priv.complaint_event e where e.complaint_id = p_id), '[]'::jsonb),
    'access', coalesce((
      select jsonb_agg(jsonb_build_object('accessorRole', x.accessor_role, 'mine', x.accessor_id = v_user,
               'purpose', x.purpose, 'issuedAt', x.issued_at) order by x.issued_at desc)
        from (select * from priv.evidence_access ea where ea.complaint_id = p_id
               order by ea.issued_at desc limit 50) x), '[]'::jsonb));
end;
$$;
alter function priv.review_complaint(uuid) owner to paranaga_definer;
revoke execute on function priv.review_complaint(uuid) from public;
grant execute on function priv.review_complaint(uuid) to paranaga_app;

-- 0018's function (same signature, owner and grants) through the helper, plus an audit row.
create or replace function priv.reviewer_evidence_download(p_complaint_id uuid, p_evidence_id uuid)
returns table (bucket text, object_key text, mime text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user_id text := priv.assert_complaint_reviewer();
  v_media uuid;
  v_reporter text;
begin
  select cm.media_object_id, c.reporter_id into v_media, v_reporter
    from priv.complaint_media cm
    join priv.complaint c on c.id = cm.complaint_id
   where cm.id = p_evidence_id and c.id = p_complaint_id;
  if not found then
    return;
  end if;
  if v_reporter = v_user_id then
    raise exception 'forbidden: own report' using errcode = '42501';
  end if;
  insert into priv.evidence_access (complaint_id, media_object_id, accessor_id, accessor_role, purpose, expires_at, request_id)
  values (p_complaint_id, v_media, v_user_id, 'complaint_reviewer', 'complaint_review', now() + interval '60 seconds', core.current_request_id());
  perform core.audit('complaint.evidence.read', 'complaint', p_complaint_id::text, jsonb_build_object('evidence', p_evidence_id));
  return query
  select m.bucket, m.object_key, m.mime from core.media_object m
   where m.id = v_media and m.status = 'verified' and m.bucket = 'evidence-private';
end;
$$;
alter function priv.reviewer_evidence_download(uuid, uuid) owner to paranaga_definer;
revoke execute on function priv.reviewer_evidence_download(uuid, uuid) from public;
grant execute on function priv.reviewer_evidence_download(uuid, uuid) to paranaga_app;

create or replace function priv.set_complaint_legal_hold(p_id uuid, p_hold boolean, p_note text)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user text := priv.assert_complaint_reviewer();
  v_c priv.complaint%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_hold is null then
    raise exception 'hold is required' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'a note of up to 1000 characters is required' using errcode = '22023';
  end if;
  select * into v_c from priv.complaint c where c.id = p_id for update;
  if not found or v_c.reporter_id = v_user then
    return false;
  end if;
  if v_c.legal_hold = p_hold then
    return true;
  end if;
  update priv.complaint c set legal_hold = p_hold, updated_at = now() where c.id = p_id;
  insert into priv.complaint_event (complaint_id, from_status, to_status, actor_role, actor_id, visibility, note)
  values (p_id, v_c.status, v_c.status, 'complaint_reviewer', v_user, 'reviewer_only',
          case when p_hold then 'Legal hold on: ' else 'Legal hold off: ' end || v_note);
  perform core.audit('complaint.legal_hold', 'complaint', p_id::text, jsonb_build_object('hold', p_hold));
  return true;
end;
$$;
alter function priv.set_complaint_legal_hold(uuid, boolean, text) owner to paranaga_definer;
revoke execute on function priv.set_complaint_legal_hold(uuid, boolean, text) from public;
grant execute on function priv.set_complaint_legal_hold(uuid, boolean, text) to paranaga_app;

-- ================================================================ retention purge

-- True when the report may be purged now (used by the functions and the restrictive policies).
create or replace function priv.complaint_purgeable(p_id uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, priv, pg_temp
as $$
  select exists (
    select 1 from priv.complaint c
     where c.id = p_id
       and c.legal_hold = false
       and c.status in ('closed', 'withdrawn')
       and coalesce(c.retention_until, coalesce(c.closed_at, c.updated_at) + interval '365 days') <= now())
$$;
alter function priv.complaint_purgeable(uuid) owner to paranaga_definer;
revoke execute on function priv.complaint_purgeable(uuid) from public;

-- An evidence upload that no report uses, older than 30 days.
create or replace function priv.upload_purgeable(p_media uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, priv, core, pg_temp
as $$
  select exists (
    select 1 from core.media_object m
     where m.id = p_media
       and m.purpose = 'complaint_evidence'
       and m.created_at < now() - interval '30 days'
       and not exists (select 1 from priv.complaint_media cm where cm.media_object_id = m.id)
       and not exists (select 1 from priv.evidence_access ea where ea.media_object_id = m.id))
$$;
alter function priv.upload_purgeable(uuid) owner to paranaga_definer;
revoke execute on function priv.upload_purgeable(uuid) from public;

-- Raises unless the caller is the system (no user in the request context).
create or replace function priv.assert_system() returns void
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
begin
  if core.current_user_id() is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
alter function priv.assert_system() owner to paranaga_definer;
revoke execute on function priv.assert_system() from public;

create or replace function priv.retention_due(p_limit integer default 50)
returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform priv.assert_system();
  return jsonb_build_object(
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'objects', coalesce((
               select jsonb_agg(distinct jsonb_build_object('bucket', o.bucket, 'key', o.key))
                 from priv.complaint_media cm
                 join core.media_object m on m.id = cm.media_object_id
                 cross join lateral (values (m.bucket, m.object_key), (m.bucket, cm.original_key), (m.bucket, cm.redacted_key)) o(bucket, key)
                where cm.complaint_id = c.id and o.key is not null), '[]'::jsonb)))
        from (select c0.id from priv.complaint c0
               where c0.legal_hold = false and c0.status in ('closed', 'withdrawn')
                 and coalesce(c0.retention_until, coalesce(c0.closed_at, c0.updated_at) + interval '365 days') <= now()
               order by c0.closed_at nulls first, c0.id
               limit v_lim) c), '[]'::jsonb),
    'uploads', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'bucket', m.bucket, 'key', m.object_key))
        from (select m0.* from core.media_object m0
               where m0.purpose = 'complaint_evidence'
                 and m0.created_at < now() - interval '30 days'
                 and not exists (select 1 from priv.complaint_media cm where cm.media_object_id = m0.id)
                 and not exists (select 1 from priv.evidence_access ea where ea.media_object_id = m0.id)
               order by m0.created_at, m0.id
               limit v_lim) m), '[]'::jsonb));
end;
$$;
alter function priv.retention_due(integer) owner to paranaga_definer;
revoke execute on function priv.retention_due(integer) from public;
grant execute on function priv.retention_due(integer) to paranaga_app;

-- Deletes one due report and everything that belongs to it. False when it is no longer due (a
-- concurrent run purged it, or a legal hold was set since the list was read).
create or replace function priv.retention_purge_complaint(p_id uuid)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_media uuid[];
begin
  perform priv.assert_system();
  perform 1 from priv.complaint c where c.id = p_id for update;
  if not found or not priv.complaint_purgeable(p_id) then
    return false;
  end if;
  select coalesce(array_agg(cm.media_object_id), '{}') into v_media from priv.complaint_media cm where cm.complaint_id = p_id;
  delete from priv.evidence_access ea where ea.complaint_id = p_id;
  delete from priv.external_handoff h where h.complaint_id = p_id;
  delete from priv.complaint_event e where e.complaint_id = p_id;
  delete from priv.complaint_media cm where cm.complaint_id = p_id;
  delete from priv.complaint c where c.id = p_id;
  delete from core.media_object m where m.id = any (v_media) and m.purpose = 'complaint_evidence';
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (null, 'system', 'retention.purge', 'complaint', p_id::text,
          jsonb_build_object('media', cardinality(v_media)), core.current_request_id());
  return true;
end;
$$;
alter function priv.retention_purge_complaint(uuid) owner to paranaga_definer;
revoke execute on function priv.retention_purge_complaint(uuid) from public;
grant execute on function priv.retention_purge_complaint(uuid) to paranaga_app;

create or replace function priv.retention_purge_upload(p_media uuid)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
begin
  perform priv.assert_system();
  perform 1 from core.media_object m where m.id = p_media for update;
  if not found or not priv.upload_purgeable(p_media) then
    return false;
  end if;
  delete from core.media_object m where m.id = p_media and m.purpose = 'complaint_evidence';
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (null, 'system', 'retention.purge_upload', 'media', p_media::text, null, core.current_request_id());
  return true;
end;
$$;
alter function priv.retention_purge_upload(uuid) owner to paranaga_definer;
revoke execute on function priv.retention_purge_upload(uuid) from public;
grant execute on function priv.retention_purge_upload(uuid) to paranaga_app;

create or replace function priv.retention_record_run(
  p_dry_run boolean, p_complaints integer, p_uploads integer, p_objects integer, p_failed integer
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
begin
  perform priv.assert_system();
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (null, 'system', 'retention.run', 'job', 'retention_purge',
          jsonb_build_object('dryRun', coalesce(p_dry_run, true), 'complaints', greatest(coalesce(p_complaints, 0), 0),
                             'uploads', greatest(coalesce(p_uploads, 0), 0), 'objects', greatest(coalesce(p_objects, 0), 0),
                             'failed', greatest(coalesce(p_failed, 0), 0)),
          core.current_request_id());
end;
$$;
alter function priv.retention_record_run(boolean, integer, integer, integer, integer) owner to paranaga_definer;
revoke execute on function priv.retention_record_run(boolean, integer, integer, integer, integer) from public;
grant execute on function priv.retention_record_run(boolean, integer, integer, integer, integer) to paranaga_app;

-- Deletes for the purge only. The existing definer policies on priv are permissive FOR ALL; these
-- RESTRICTIVE policies narrow every delete to purgeable rows of a system caller.
grant delete on priv.complaint, priv.complaint_media, priv.complaint_event, priv.evidence_access, priv.external_handoff to paranaga_definer;
grant delete on core.media_object to paranaga_definer;

create policy complaint_definer_purge on priv.complaint as restrictive for delete to paranaga_definer
  using (core.current_user_id() is null and priv.complaint_purgeable(id));
create policy complaint_media_definer_purge on priv.complaint_media as restrictive for delete to paranaga_definer
  using (core.current_user_id() is null and priv.complaint_purgeable(complaint_id));
create policy complaint_event_definer_purge on priv.complaint_event as restrictive for delete to paranaga_definer
  using (core.current_user_id() is null and priv.complaint_purgeable(complaint_id));
create policy evidence_access_definer_purge on priv.evidence_access as restrictive for delete to paranaga_definer
  using (core.current_user_id() is null and priv.complaint_purgeable(complaint_id));
create policy external_handoff_definer_purge on priv.external_handoff as restrictive for delete to paranaga_definer
  using (core.current_user_id() is null and priv.complaint_purgeable(complaint_id));
-- core.media_object had no definer delete policy: only complaint evidence, only the system, only
-- when its report is purged in this transaction (no complaint_media row left) or it was never used.
create policy media_definer_purge on core.media_object for delete to paranaga_definer
  using (core.current_user_id() is null and purpose = 'complaint_evidence'
         and not exists (select 1 from priv.complaint_media cm where cm.media_object_id = media_object.id));

-- ================================================================ C12 users and roles

-- Exact email lookup needs the auth provider's user table (Neon Managed Better Auth). Four columns
-- only; skipped where neon_auth does not exist (the functions then answer 'user lookup unavailable').
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'neon_auth')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'neon_auth' and c.relname = 'user') then
    execute 'grant usage on schema neon_auth to paranaga_definer';
    execute 'grant select (id, name, email, "emailVerified") on neon_auth."user" to paranaga_definer';
  end if;
end
$$;

create or replace function core.assert_admin() returns text
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null or not core.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
alter function core.assert_admin() owner to paranaga_definer;
revoke execute on function core.assert_admin() from public;

-- The roles of one user (active first, then the 20 most recent revocations).
create or replace function core.user_roles_json(p_user text) returns jsonb
  language sql stable
  set search_path = pg_catalog, core, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'role', r.role_code, 'active', r.revoked_at is null, 'grantedAt', r.granted_at,
           'grantedBy', (select p.display_name from core.profile p where p.user_id = r.granted_by),
           'revokedAt', r.revoked_at, 'reason', r.reason)
         order by (r.revoked_at is null) desc, coalesce(r.revoked_at, r.granted_at) desc), '[]'::jsonb)
    from (select * from core.user_role ur where ur.user_id = p_user
           order by (ur.revoked_at is null) desc, coalesce(ur.revoked_at, ur.granted_at) desc limit 30) r
$$;
alter function core.user_roles_json(text) owner to paranaga_definer;
revoke execute on function core.user_roles_json(text) from public;

-- Exact (case-insensitive) email match; NULL when no account has it. No listing, no prefix.
create or replace function core.admin_find_user(p_email text) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.assert_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id text;
  v_name text;
  v_verified boolean;
  v_profile core.profile%rowtype;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'enter a full email address' using errcode = '22023';
  end if;
  begin
    select u.id::text, u.name, u."emailVerified" into v_id, v_name, v_verified
      from neon_auth."user" u where lower(u.email) = v_email;
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    raise exception 'user lookup unavailable' using errcode = '55000';
  end;
  perform core.audit('user.lookup', 'user', v_id, jsonb_build_object('found', v_id is not null));
  if v_id is null then
    return null;
  end if;
  select * into v_profile from core.profile p where p.user_id = v_id;
  return jsonb_build_object(
    'userId', v_id, 'name', coalesce(v_profile.display_name, v_name), 'email', v_email,
    'emailVerified', coalesce(v_verified, false), 'hasProfile', v_profile.user_id is not null,
    'self', v_id = v_actor,
    'suspended', coalesce(v_profile.suspended_until > now(), false),
    'roles', core.user_roles_json(v_id));
end;
$$;
alter function core.admin_find_user(text) owner to paranaga_definer;
revoke execute on function core.admin_find_user(text) from public;
grant execute on function core.admin_find_user(text) to paranaga_app;

create or replace function core.admin_staff() returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.assert_admin();
  v_emails jsonb := '{}'::jsonb;
begin
  begin
    select coalesce(jsonb_object_agg(u.id::text, u.email), '{}'::jsonb) into v_emails
      from neon_auth."user" u
     where u.id::text in (select ur.user_id from core.user_role ur where ur.revoked_at is null and ur.role_code <> 'commuter');
  exception when undefined_table or invalid_schema_name or insufficient_privilege or invalid_text_representation then
    v_emails := '{}'::jsonb;
  end;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'userId', s.user_id, 'name', coalesce(p.display_name, s.user_id), 'email', v_emails ->> s.user_id,
             'self', s.user_id = v_actor, 'suspended', coalesce(p.suspended_until > now(), false),
             'roles', core.user_roles_json(s.user_id))
           order by coalesce(p.display_name, s.user_id))
      from (select distinct ur.user_id from core.user_role ur where ur.revoked_at is null and ur.role_code <> 'commuter') s
      left join core.profile p on p.user_id = s.user_id), '[]'::jsonb);
end;
$$;
alter function core.admin_staff() owner to paranaga_definer;
revoke execute on function core.admin_staff() from public;
grant execute on function core.admin_staff() to paranaga_app;

-- 0000's functions, same signatures, owner and grants; now with step-up, a reason, no change to your
-- own roles, known users only, and never the last admin.
create or replace function core.grant_role(p_user text, p_role text, p_reason text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new integer;
begin
  if v_actor is null or not core.has_role('admin') then
    raise exception 'only admins can grant roles' using errcode = '42501';
  end if;
  perform priv.require_step_up();
  if p_user is null or btrim(p_user) = '' or p_role is null then
    raise exception 'user and role are required' using errcode = '22023';
  end if;
  if p_user = v_actor then
    raise exception 'admins cannot grant roles to themselves' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'a reason of 3 to 500 characters is required' using errcode = '22023';
  end if;
  if p_role = 'commuter' or not exists (select 1 from core.role where code = p_role) then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  if not exists (select 1 from core.profile p where p.user_id = p_user) then
    raise exception 'unknown user: they must sign in once first' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('core.user_role'));
  insert into core.user_role (user_id, role_code, granted_by, reason)
  values (p_user, p_role, v_actor, v_reason)
  on conflict (user_id, role_code) where revoked_at is null do nothing;
  get diagnostics v_new = row_count;
  if v_new = 1 then
    insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
    values (v_actor, 'admin', 'role.grant', 'user', p_user,
            jsonb_build_object('role', p_role, 'reason', left(v_reason, 200)), core.current_request_id());
  end if;
end
$$;
alter function core.grant_role(text, text, text) owner to paranaga_definer;
revoke execute on function core.grant_role(text, text, text) from public;
grant execute on function core.grant_role(text, text, text) to paranaga_app;

create or replace function core.revoke_role(p_user text, p_role text, p_reason text) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_changed integer;
begin
  if v_actor is null or not core.has_role('admin') then
    raise exception 'only admins can revoke roles' using errcode = '42501';
  end if;
  perform priv.require_step_up();
  if p_user = v_actor then
    raise exception 'admins cannot change their own roles' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'a reason of 3 to 500 characters is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('core.user_role'));
  if p_role = 'admin' and not exists (
    select 1 from core.user_role ur
      left join core.profile p on p.user_id = ur.user_id
     where ur.role_code = 'admin' and ur.revoked_at is null and ur.user_id <> p_user
       and (p.suspended_until is null or p.suspended_until <= now())) then
    raise exception 'cannot remove the last admin' using errcode = '55000';
  end if;
  update core.user_role
     set revoked_at = now(), revoked_by = v_actor
   where user_id = p_user and role_code = p_role and revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'that user does not hold this role' using errcode = '22023';
  end if;
  insert into core.audit_event (actor_user_id, actor_role, action, entity_type, entity_id, after, request_id)
  values (v_actor, 'admin', 'role.revoke', 'user', p_user,
          jsonb_build_object('role', p_role, 'reason', left(v_reason, 200)), core.current_request_id());
end
$$;
alter function core.revoke_role(text, text, text) owner to paranaga_definer;
revoke execute on function core.revoke_role(text, text, text) from public;
grant execute on function core.revoke_role(text, text, text) to paranaga_app;

-- ================================================================ audit log

-- Staff read their own actions (admins already read everything, 0000 audit_read_admin).
create policy audit_read_own_staff on core.audit_event for select to paranaga_app
  using (actor_user_id = (select core.current_user_id())
         and ((select core.has_role('transport_reviewer')) or (select core.has_role('community_moderator'))
              or (select core.has_role('complaint_reviewer'))));
-- The definer counts a reviewer's opens (priv.review_complaint).
grant select on core.audit_event to paranaga_definer;
create policy audit_definer_read on core.audit_event for select to paranaga_definer using (true);

create index if not exists audit_event_at_idx on core.audit_event (at desc, id desc);
create index if not exists audit_event_action_idx on core.audit_event (action, at desc);

revoke create on schema core from paranaga_definer;
revoke create on schema priv from paranaga_definer;
