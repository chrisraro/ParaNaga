-- 0018_priv_complaint.sql
-- Increment B, Task B8: Report a driver, private (S18, F-D4). Spec: 04-data-model §4.8,
-- 05-security §5.3/§5.5/§5.8, 03-architecture §3.8/§3.9.
--   - priv.complaint: one private driver report. Never published, never shown in Community.
--   - priv.complaint_media: evidence; each row points at a verified core.media_object in the
--     'evidence-private' bucket that the reporter uploaded with purpose 'complaint_evidence'.
--   - priv.complaint_event: status history; 'reporter' rows are visible to the reporter.
--   - priv.evidence_access: one row per signed download URL issued (audit, spec §5.8).
--   - priv.submit_complaint(...): the only way a commuter creates a report (definer).
--   - priv.my_evidence_download(...): the reporter's own evidence, audited (definer).
--   - priv.review_queue / priv.reviewer_evidence_download / priv.set_complaint_status: the
--     complaint_reviewer role only, and only after a fresh step-up (definer, fail closed).
--
-- Access model:
--   - Forced RLS on every priv table. paranaga_app reads ONLY rows whose reporter_id is the
--     caller (core.current_user_id()); guests (NULL) match nothing.
--   - No policy or grant here names community_moderator, transport_reviewer or admin:
--     a community moderator has zero access to priv (spec §5.3, "grants nothing in priv").
--   - There is no reviewer policy on the tables at all: reviewers go through definer functions
--     that omit reporter_id, refuse the reviewer's own reports and require step-up.
--   - paranaga_app has no INSERT/UPDATE/DELETE on any priv table; writes are definer-only.
--   - Admin break-glass access (reason + notify + audit) is NOT built here; admins get nothing.
--
-- Also fixes a gap the evidence flow depends on: forced RLS on core.media_object had no policy
-- for paranaga_definer, so definer functions (B4 slot/verify/promote, B6 and this file's evidence
-- checks) could neither create, see nor update media rows. The policies below are definer-only and
-- limited to the columns and transitions those functions need.

grant usage on schema priv to paranaga_app, paranaga_definer;
grant create on schema priv to paranaga_definer;

-- ---------------------------------------------------------------- tables
create table priv.complaint (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  public_ref          text not null unique
                      check (public_ref ~ '^PN-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{2}$'),
  reporter_id         text not null,
  client_request_id   uuid not null,
  category            text not null check (category in (
    'overcharging', 'reckless_driving', 'discount_refused', 'harassment', 'improper_loading', 'other')),
  description         text not null check (char_length(description) between 10 and 2000),
  incident_at         timestamptz not null,
  incident_location   extensions.geography(Point, 4326),
  location_accuracy_m numeric check (location_accuracy_m is null or location_accuracy_m between 0 and 5000),
  location_source     text not null default 'none' check (location_source in ('gps', 'manual', 'none')),
  location_text       text check (location_text is null or char_length(location_text) between 1 and 200),
  operator_text       text check (operator_text is null or char_length(operator_text) between 1 and 120),
  plate_text          text check (plate_text is null or char_length(plate_text) between 1 and 16),
  body_number_text    text check (body_number_text is null or char_length(body_number_text) between 1 and 16),
  status              text not null default 'submitted' check (status in (
    'submitted', 'under_review', 'needs_information', 'closed', 'withdrawn')),
  outcome_code        text check (outcome_code is null or outcome_code in (
    'info_provided_to_reporter', 'insufficient_detail', 'duplicate', 'outside_scope', 'reporter_withdrew')),
  queue               text not null default 'queue_normal' check (queue in (
    'queue_normal', 'queue_priority', 'queue_check_completeness')),
  legal_hold          boolean not null default false,
  retention_until     timestamptz,
  submitted_at        timestamptz not null default now(),
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (reporter_id, client_request_id),
  check ((location_source = 'gps') = (incident_location is not null)),
  check (location_source <> 'none' or location_text is null)
);
create index complaint_reporter_idx on priv.complaint (reporter_id, created_at desc);
create index complaint_queue_idx on priv.complaint (queue, submitted_at)
  where status in ('submitted', 'under_review', 'needs_information');

create table priv.complaint_media (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  complaint_id       uuid not null references priv.complaint (id) on delete cascade,
  media_object_id    uuid not null unique references core.media_object (id),
  capture_kind       text not null check (capture_kind in ('in_app_camera', 'file_upload')),
  captured_at_client timestamptz,
  received_at_server timestamptz not null default now(),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  gps_accuracy_m     numeric check (gps_accuracy_m is null or gps_accuracy_m between 0 and 5000),
  original_key       text not null,
  redacted_key       text
);
create index complaint_media_complaint_idx on priv.complaint_media (complaint_id);

create table priv.complaint_event (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  complaint_id uuid not null references priv.complaint (id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_role   text not null check (actor_role in ('reporter', 'complaint_reviewer', 'system')),
  -- The reviewer's id is kept for accountability but is not visible to the reporter (column grant).
  actor_id     text,
  visibility   text not null default 'reporter' check (visibility in ('reporter', 'reviewer_only')),
  outcome_code text,
  note         text check (note is null or char_length(note) <= 1000),
  at           timestamptz not null default now()
);
create index complaint_event_idx on priv.complaint_event (complaint_id, at);

create table priv.evidence_access (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  complaint_id    uuid not null references priv.complaint (id) on delete cascade,
  media_object_id uuid not null references core.media_object (id),
  accessor_id     text not null,
  accessor_role   text not null check (accessor_role in ('reporter', 'complaint_reviewer')),
  purpose         text not null check (purpose in ('reporter_download', 'complaint_review')),
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  request_id      text,
  check (expires_at > issued_at and expires_at <= issued_at + interval '60 seconds')
);
create index evidence_access_accessor_idx on priv.evidence_access (accessor_id, issued_at desc);
create index evidence_access_media_idx on priv.evidence_access (media_object_id);

-- ---------------------------------------------------------------- grants
-- paranaga_app: SELECT on the reporter-facing columns only. No queue, legal hold, retention,
-- storage keys, hashes, reviewer ids or access log. No writes at all.
grant select (id, public_ref, reporter_id, category, description, incident_at, location_accuracy_m,
              location_source, location_text, operator_text, plate_text, body_number_text, status,
              outcome_code, submitted_at, closed_at, created_at, updated_at)
  on priv.complaint to paranaga_app;
grant select (id, complaint_id, media_object_id, capture_kind, captured_at_client, received_at_server)
  on priv.complaint_media to paranaga_app;
grant select (id, complaint_id, from_status, to_status, actor_role, visibility, outcome_code, note, at)
  on priv.complaint_event to paranaga_app;
-- priv.evidence_access: no grant to paranaga_app.

grant select, insert, update on priv.complaint to paranaga_definer;
grant select, insert on priv.complaint_media, priv.complaint_event, priv.evidence_access to paranaga_definer;

-- ---------------------------------------------------------------- RLS
alter table priv.complaint        enable row level security;
alter table priv.complaint        force row level security;
alter table priv.complaint_media  enable row level security;
alter table priv.complaint_media  force row level security;
alter table priv.complaint_event  enable row level security;
alter table priv.complaint_event  force row level security;
alter table priv.evidence_access  enable row level security;
alter table priv.evidence_access  force row level security;

create policy complaint_owner_read on priv.complaint for select to paranaga_app
  using (reporter_id = (select core.current_user_id()));
create policy complaint_media_owner_read on priv.complaint_media for select to paranaga_app
  using (exists (
    select 1 from priv.complaint c
     where c.id = complaint_id and c.reporter_id = (select core.current_user_id())));
create policy complaint_event_owner_read on priv.complaint_event for select to paranaga_app
  using (visibility = 'reporter' and exists (
    select 1 from priv.complaint c
     where c.id = complaint_id and c.reporter_id = (select core.current_user_id())));
-- evidence_access: no paranaga_app policy (deny all).

create policy complaint_definer on priv.complaint for all to paranaga_definer using (true) with check (true);
create policy complaint_media_definer on priv.complaint_media for all to paranaga_definer using (true) with check (true);
create policy complaint_event_definer on priv.complaint_event for all to paranaga_definer using (true) with check (true);
create policy evidence_access_definer on priv.evidence_access for all to paranaga_definer using (true) with check (true);

-- core.media_object for definer functions (see header): create the caller's own slot (B4
-- core.create_media_slot), read, and promote/reject a slot only.
grant select, insert on core.media_object to paranaga_definer;
grant update (bucket, object_key, sha256, bytes, mime, status, verified_at) on core.media_object to paranaga_definer;
create policy media_definer_slot on core.media_object for insert to paranaga_definer
  with check (owner_id = core.current_user_id() and status = 'slot'
              and sha256 is null and bytes is null and verified_at is null);
create policy media_definer_read on core.media_object for select to paranaga_definer using (true);
create policy media_definer_promote on core.media_object for update to paranaga_definer
  using (status = 'slot')
  with check (status in ('verified', 'rejected'));

-- ---------------------------------------------------------------- step-up gate
-- Step-up = a fresh OTP within 15 minutes (spec §5.4). The server sets the transaction-local
-- setting app.step_up_at ONLY after verifying that OTP. TODO(step-up): the OTP flow is not built
-- yet, so nothing sets it and every reviewer function below fails closed.
create or replace function priv.require_step_up() returns void
  language plpgsql stable
  set search_path = pg_catalog, pg_temp
as $$
declare
  v_raw text := nullif(current_setting('app.step_up_at', true), '');
  v_at timestamptz;
begin
  if v_raw is null then
    raise exception 'step-up required' using errcode = '42501';
  end if;
  begin
    v_at := v_raw::timestamptz;
  exception when others then
    raise exception 'step-up required' using errcode = '42501';
  end;
  if v_at < now() - interval '15 minutes' or v_at > now() + interval '1 minute' then
    raise exception 'step-up required' using errcode = '42501';
  end if;
end;
$$;
alter function priv.require_step_up() owner to paranaga_definer;
revoke execute on function priv.require_step_up() from public;

-- ---------------------------------------------------------------- submit (reporter)
-- p_evidence: jsonb array of {"mediaId": uuid, "captureKind": text, "capturedAt": timestamptz?}.
-- p_public_ref is generated by the server (src/domain/complaints/reference.ts); a clash raises
-- unique_violation and the server retries with a new one.
create or replace function priv.submit_complaint(
  p_client_request_id uuid,
  p_public_ref text,
  p_category text,
  p_description text,
  p_incident_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric,
  p_location_text text,
  p_operator text,
  p_plate text,
  p_body_number text,
  p_queue text,
  p_evidence jsonb
) returns table (
  id uuid,
  public_ref text,
  category text,
  status text,
  submitted_at timestamptz
)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, extensions, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_row priv.complaint%rowtype;
  v_ids uuid[];
  v_count integer;
  v_good integer;
  v_gps boolean := p_lat is not null and p_lng is not null;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotent retry: the same request id returns the report already stored.
  select * into v_row from priv.complaint c
   where c.reporter_id = v_user_id and c.client_request_id = p_client_request_id;
  if found then
    return query select v_row.id, v_row.public_ref, v_row.category, v_row.status, v_row.submitted_at;
    return;
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'invalid evidence' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_evidence);
  if v_count > 3 then
    raise exception 'invalid evidence' using errcode = '22023';
  end if;
  if v_count > 0 then
    select array_agg((e ->> 'mediaId')::uuid) into v_ids from jsonb_array_elements(p_evidence) e;
    if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception 'invalid evidence' using errcode = '22023';
    end if;
    -- Only the caller's own verified complaint uploads, in the private bucket, not used before.
    select count(*) into v_good from core.media_object m
     where m.id = any (v_ids)
       and m.owner_id = v_user_id
       and m.purpose = 'complaint_evidence'
       and m.status = 'verified'
       and m.bucket = 'evidence-private'
       and m.sha256 is not null
       and not exists (select 1 from priv.complaint_media cm where cm.media_object_id = m.id);
    if v_good <> v_count then
      raise exception 'invalid evidence' using errcode = '22023';
    end if;
  end if;

  insert into priv.complaint (
    public_ref, reporter_id, client_request_id, category, description, incident_at,
    incident_location, location_accuracy_m, location_source, location_text,
    operator_text, plate_text, body_number_text, status, queue
  ) values (
    p_public_ref, v_user_id, p_client_request_id, p_category, p_description, p_incident_at,
    case when v_gps then extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography end,
    case when v_gps then p_accuracy_m end,
    case when v_gps then 'gps' when p_location_text is not null then 'manual' else 'none' end,
    p_location_text, p_operator, p_plate, p_body_number, 'submitted', p_queue
  ) returning * into v_row;

  if v_count > 0 then
    insert into priv.complaint_media (
      complaint_id, media_object_id, capture_kind, captured_at_client, sha256, original_key)
    select v_row.id, m.id, e ->> 'captureKind', (e ->> 'capturedAt')::timestamptz, m.sha256, m.object_key
      from jsonb_array_elements(p_evidence) e
      join core.media_object m on m.id = (e ->> 'mediaId')::uuid;
  end if;

  insert into priv.complaint_event (complaint_id, from_status, to_status, actor_role, actor_id, visibility)
  values (v_row.id, null, 'submitted', 'reporter', v_user_id, 'reporter');

  -- Audit without any report text (spec §5.9: no free text or personal data from priv).
  perform core.audit('complaint.submit', 'complaint', v_row.id::text, jsonb_build_object('evidence', v_count));

  return query select v_row.id, v_row.public_ref, v_row.category, v_row.status, v_row.submitted_at;
end;
$$;
alter function priv.submit_complaint(uuid, text, text, text, timestamptz, double precision, double precision, numeric, text, text, text, text, text, jsonb) owner to paranaga_definer;
revoke execute on function priv.submit_complaint(uuid, text, text, text, timestamptz, double precision, double precision, numeric, text, text, text, text, text, jsonb) from public;
grant execute on function priv.submit_complaint(uuid, text, text, text, timestamptz, double precision, double precision, numeric, text, text, text, text, text, jsonb) to paranaga_app;

-- ---------------------------------------------------------------- reporter's own evidence
-- Returns the storage location of one evidence item of the caller's own report and records the
-- issuance; no row when it is not the caller's (the API answers 404 either way, no existence leak).
-- TODO(step-up): spec §5.8 also asks for step-up before a reporter downloads an ORIGINAL. Add
-- `perform priv.require_step_up();` here once the OTP flow exists.
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

-- ---------------------------------------------------------------- complaint reviewers
-- Role complaint_reviewer only (admins are not included: break-glass is a separate, later flow),
-- step-up required, never the reviewer's own reports, and reporter_id is never returned.
create or replace function priv.review_queue(p_limit integer default 50)
returns table (
  id uuid,
  public_ref text,
  category text,
  description text,
  incident_at timestamptz,
  location_accuracy_m numeric,
  location_source text,
  location_text text,
  operator_text text,
  plate_text text,
  body_number_text text,
  status text,
  queue text,
  submitted_at timestamptz,
  evidence_count integer
)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
begin
  if core.current_user_id() is null or not core.has_role('complaint_reviewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform priv.require_step_up();
  perform core.audit('complaint.queue.read', 'complaint', null, null);
  return query
  select c.id, c.public_ref, c.category, c.description, c.incident_at, c.location_accuracy_m,
         c.location_source, c.location_text, c.operator_text, c.plate_text, c.body_number_text,
         c.status, c.queue, c.submitted_at,
         (select count(*)::integer from priv.complaint_media cm where cm.complaint_id = c.id)
    from priv.complaint c
   where c.status in ('submitted', 'under_review', 'needs_information')
     and c.reporter_id <> core.current_user_id()
   order by (c.queue = 'queue_priority') desc, c.submitted_at
   limit least(greatest(p_limit, 1), 100);
end;
$$;
alter function priv.review_queue(integer) owner to paranaga_definer;
revoke execute on function priv.review_queue(integer) from public;
grant execute on function priv.review_queue(integer) to paranaga_app;

create or replace function priv.reviewer_evidence_download(p_complaint_id uuid, p_evidence_id uuid)
returns table (bucket text, object_key text, mime text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_media uuid;
  v_reporter text;
begin
  if v_user_id is null or not core.has_role('complaint_reviewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform priv.require_step_up();
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
  return query
  select m.bucket, m.object_key, m.mime from core.media_object m
   where m.id = v_media and m.status = 'verified' and m.bucket = 'evidence-private';
end;
$$;
alter function priv.reviewer_evidence_download(uuid, uuid) owner to paranaga_definer;
revoke execute on function priv.reviewer_evidence_download(uuid, uuid) from public;
grant execute on function priv.reviewer_evidence_download(uuid, uuid) to paranaga_app;

create or replace function priv.set_complaint_status(
  p_id uuid,
  p_to text,
  p_outcome_code text default null,
  p_note text default null,
  p_visibility text default 'reporter'
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_from text;
  v_reporter text;
begin
  if v_actor is null or not core.has_role('complaint_reviewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform priv.require_step_up();
  if p_visibility not in ('reporter', 'reviewer_only') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  select c.status, c.reporter_id into v_from, v_reporter from priv.complaint c where c.id = p_id for update;
  if not found then
    return false;
  end if;
  if v_reporter = v_actor then
    raise exception 'forbidden: own report' using errcode = '42501';
  end if;
  -- Mirrors src/domain/complaints/status.ts. 'withdrawn' is the reporter's own action (B9).
  if not ((v_from, p_to) in (
    ('submitted', 'under_review'), ('submitted', 'closed'),
    ('under_review', 'needs_information'), ('under_review', 'closed'),
    ('needs_information', 'under_review'), ('needs_information', 'closed'))) then
    raise exception 'invalid transition % to %', v_from, p_to using errcode = '22023';
  end if;
  if (p_to = 'closed') <> (p_outcome_code is not null) then
    raise exception 'an outcome code is required to close, and only to close' using errcode = '22023';
  end if;
  update priv.complaint c
     set status = p_to,
         outcome_code = coalesce(p_outcome_code, c.outcome_code),
         closed_at = case when p_to = 'closed' then now() else c.closed_at end,
         retention_until = case when p_to = 'closed' then now() + interval '365 days' else c.retention_until end,
         updated_at = now()
   where c.id = p_id;
  insert into priv.complaint_event (complaint_id, from_status, to_status, actor_role, actor_id, visibility, outcome_code, note)
  values (p_id, v_from, p_to, 'complaint_reviewer', v_actor, p_visibility, p_outcome_code, p_note);
  perform core.audit('complaint.status', 'complaint', p_id::text, jsonb_build_object('from', v_from, 'to', p_to));
  return true;
end;
$$;
alter function priv.set_complaint_status(uuid, text, text, text, text) owner to paranaga_definer;
revoke execute on function priv.set_complaint_status(uuid, text, text, text, text) from public;
grant execute on function priv.set_complaint_status(uuid, text, text, text, text) to paranaga_app;

revoke create on schema priv from paranaga_definer;
