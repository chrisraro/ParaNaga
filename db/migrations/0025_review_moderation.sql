-- 0025_review_moderation.sql
-- N6 (docs/spec/07-delivery.md §7.11): admin console C9 (corrections review) and C10 (community
-- moderation, photos, appeals, overrides). Additive only. The app (paranaga_app) reaches all of it
-- through the SECURITY DEFINER functions below; each checks the caller's role in the database
-- (core.has_role, which already honours suspensions), whatever the server checked before, and
-- every state change writes a core.audit row.
--
-- C9 corrections (transport_reviewer or admin; never the reporter's own report):
--   community.correction gains draft_revision_id, draft_change, reviewed_by, reviewed_at.
--   community.admin_corrections(scope, limit)  the queue with evidence (photo ids, location,
--       events), similar reports on the same entity, the stop in the open draft (stop reports) and
--       the published fare rules with their evidence and open conflicts (fare reports).
--   community.admin_review_correction(...)     start review, request information, reject,
--       duplicate, accept. Templated reason codes (the reporter sees the code, localized, on My
--       reports; the reviewer's note never leaves the console). Accept needs the open DRAFT
--       revision and records either a stop version that is a member of that draft and in no
--       released revision (an edit made through 0024's functions) or a recorded proposal with a
--       note (and, for fares, the fare rule version it is about). Nothing published changes (AC-13).
--   community.incorporate_corrections()        trigger on transit.revision: when a draft is
--       published, its accepted draft changes become 'incorporated' (the only path there).
--
-- C10 moderation (community_moderator or admin; never your own content):
--   community.jev_evidence      Jev's typed answer per post version / comment (recommendation and
--                               confidence, or why it was unavailable). Written by the server
--                               right after the content (community.record_jev_evidence).
--   community.moderation_decision  every decision: by 'policy' (a Jev auto-reject, created when it
--                               is appealed) or a person; is_override when a person goes against
--                               Jev's recommendation (a note is required, checked by the table).
--   community.appeal            one per decision (unique decision_id); the resolver must differ
--                               from the original decider (CHECK constraint, and the function).
--   community.post_photo        photos of a post (at most 3), pending until a moderator approves;
--                               approval records the copy in the public bucket. The server copies
--                               the stripped private object to STORAGE_BUCKET_PUBLIC inside the
--                               same transaction; it is the only path to public.
--   Functions: community.record_jev_evidence, community.add_post_photos, community.submit_appeal
--   (commuters, own content only), community.admin_moderation_queue, community.admin_moderate,
--   community.admin_resolve_appeal (moderators), core.admin_review_media (reviewers read a
--   private photo they are reviewing; audited).
--
-- Helpers (invoker rights, owned by paranaga_definer, not callable by the app):
--   community.assert_correction_reviewer, community.assert_moderator, community.content_target,
--   community.apply_content_outcome.
--
-- Grants AND row-level-security policies for paranaga_definer on every table these functions
-- touch that it could not reach yet: the four new tables (select/insert/update as written), and
-- community.correction / correction_event / post / post_version / comment / content_report,
-- core.media_object, transit.* reads, transit.evidence(_link) already have them (0016, 0017,
-- 0018, 0001, 0024).

grant create on schema community to paranaga_definer;
grant create on schema core to paranaga_definer;

-- ================================================================ C9: corrections review
alter table community.correction
  add column draft_revision_id uuid references transit.revision (id),
  add column draft_change      jsonb check (draft_change is null or jsonb_typeof(draft_change) = 'object'),
  add column reviewed_by       text,
  add column reviewed_at       timestamptz;
create index correction_draft_idx on community.correction (draft_revision_id) where draft_revision_id is not null;
create index correction_duplicate_idx on community.correction (duplicate_of) where duplicate_of is not null;

-- Raises 42501 'forbidden' unless the caller is a transport reviewer or an admin; returns the user.
create or replace function community.assert_correction_reviewer() returns text
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null or not (core.has_role('transport_reviewer') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
alter function community.assert_correction_reviewer() owner to paranaga_definer;
revoke execute on function community.assert_correction_reviewer() from public;

create or replace function community.admin_corrections(p_scope text default 'open', p_limit integer default 100)
returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, community, transit, core, extensions, pg_temp
as $$
declare
  v_user text := community.assert_correction_reviewer();
  v_draft uuid;
  v_pub uuid;
begin
  if p_scope is null or p_scope not in ('open', 'closed') then
    raise exception 'scope must be open or closed' using errcode = '22023';
  end if;
  select r.id into v_draft from transit.revision r where r.status = 'draft' order by r.seq desc limit 1;
  select pp.revision_id into v_pub from transit.published_pointer pp where pp.singleton;
  return jsonb_build_object(
    'draft', (select jsonb_build_object('id', r.id, 'label', r.label) from transit.revision r where r.id = v_draft),
    'corrections', coalesce((
      select jsonb_agg(x.j order by x.ord)
        from (
          select case when p_scope = 'open' then extract(epoch from c.submitted_at)
                      else -extract(epoch from c.updated_at) end as ord, jsonb_build_object(
            'id', c.id, 'kind', c.kind, 'entityType', c.entity_type, 'entityId', c.entity_id,
            'entityLabel', c.entity_label, 'entityRevisionId', c.entity_revision_id,
            'description', c.description, 'status', c.status, 'submittedAt', c.submitted_at,
            'updatedAt', c.updated_at, 'moderationReason', c.moderation_reason,
            'reviewerNote', c.reviewer_note, 'duplicateOf', c.duplicate_of,
            'draftRevisionId', c.draft_revision_id, 'draftChange', c.draft_change,
            'incorporatedRevisionId', c.incorporated_revision_id, 'reviewedAt', c.reviewed_at,
            'location', case when c.location is null then null else jsonb_build_object(
              'lat', extensions.ST_Y(c.location::extensions.geometry), 'lng', extensions.ST_X(c.location::extensions.geometry),
              'accuracyM', c.location_accuracy_m) end,
            'media', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'mime', m.mime) order by m.created_at)
                from core.media_object m
               where m.id = any (c.media_ids) and m.status = 'verified' and m.purpose = 'correction_evidence'), '[]'::jsonb),
            'events', coalesce((
              select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'at', e.at,
                       'actorRole', e.actor_role, 'reasonCode', e.reason_code, 'note', e.note) order by e.at)
                from community.correction_event e where e.correction_id = c.id), '[]'::jsonb),
            'similar', coalesce((
              select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'status', o.status, 'submittedAt', o.submitted_at)
                               order by o.submitted_at)
                from (select o.* from community.correction o
                       where o.entity_type = c.entity_type and o.entity_id = c.entity_id and o.id <> c.id
                         and o.status <> 'draft'
                       order by o.submitted_at limit 5) o), '[]'::jsonb),
            'stop', case when c.entity_type = 'stop'
                          and c.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (
              select jsonb_build_object('stopPointId', sp.id, 'name', coalesce(v.name, sp.name), 'versionId', v.id,
                       'status', v.status, 'inDraft', coalesce(m.revision_id = v_draft, false),
                       'changedInDraft', coalesce(m.revision_id = v_draft, false) and not transit.in_released_revision(v.id),
                       'lat', extensions.ST_Y(v.geog::extensions.geometry), 'lng', extensions.ST_X(v.geog::extensions.geometry))
                from transit.stop_point sp
                join transit.revision_member m on m.entity_kind = 'stop_point' and m.entity_id = sp.id
                                              and m.revision_id = coalesce(v_draft, v_pub)
                join transit.stop_point_version v on v.id = m.version_id
               where sp.id = c.entity_id::uuid) end,
            'fares', case when c.entity_type = 'fare' or c.kind = 'fare_mismatch' then coalesce((
              select jsonb_agg(jsonb_build_object(
                       'fareRuleId', fr.id, 'code', fr.code, 'modeCode', fr.mode_code, 'versionId', fv.id,
                       'baseCentavos', fv.base_centavos, 'status', fv.status, 'effectiveFrom', fv.effective_from,
                       'sourceCodes', to_jsonb(fv.source_codes),
                       'evidence', coalesce((
                         select jsonb_agg(jsonb_build_object('claim', l.claim, 'kind', ev.kind, 'sourceCode', ev.source_code))
                           from transit.evidence_link l join transit.evidence ev on ev.id = l.evidence_id
                          where l.fare_rule_version_id = fv.id), '[]'::jsonb),
                       'openConflicts', (select count(*) from transit.fare_conflict fc
                                          where fc.fare_rule_id = fr.id and fc.status = 'open'))
                     order by fr.code)
                from transit.revision_member fm
                join transit.fare_rule fr on fr.id = fm.entity_id
                join transit.fare_rule_version fv on fv.id = fm.version_id
               where fm.revision_id = v_pub and fm.entity_kind = 'fare_rule'
                 and (c.entity_type not in ('fare', 'route')
                      or lower(fr.mode_code) = (select rt.mode from transit.route rt where rt.public_code = c.entity_id))
            ), '[]'::jsonb) end
          ) as j
            from community.correction c
           where c.author_id <> v_user
             and ((p_scope = 'open' and c.status in ('submitted', 'under_review', 'needs_evidence'))
                  or (p_scope = 'closed' and c.status in ('accepted', 'rejected', 'duplicate', 'incorporated', 'superseded')))
           order by 1
           limit least(greatest(coalesce(p_limit, 100), 1), 200)
        ) x), '[]'::jsonb));
end;
$$;
alter function community.admin_corrections(text, integer) owner to paranaga_definer;
revoke execute on function community.admin_corrections(text, integer) from public;
grant execute on function community.admin_corrections(text, integer) to paranaga_app;

-- One reviewer action. p_expected_status is the status the page showed (55000 when it changed).
-- Reason codes (mirrored in src/domain/admin/corrections.ts):
--   request_info: need_photo, need_location, need_details, need_time
--   reject:       already_correct, not_verifiable, out_of_scope, not_transport
create or replace function community.admin_review_correction(
  p_id uuid, p_expected_status text, p_action text, p_reason_code text, p_note text,
  p_duplicate_of uuid, p_draft_version_id uuid, p_fare_rule_version_id uuid)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, transit, core, pg_temp
as $$
declare
  v_user text := community.assert_correction_reviewer();
  v_role text := case when core.has_role('transport_reviewer') then 'transport_reviewer' else 'admin' end;
  c community.correction%rowtype;
  v_to text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_draft uuid;
  v_change jsonb;
  v_member record;
begin
  if p_action is null or p_action not in ('start_review', 'request_info', 'reject', 'duplicate', 'accept') then
    raise exception 'action must be start_review, request_info, reject, duplicate or accept' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'the note is longer than 1000 characters' using errcode = '22023';
  end if;
  select * into c from community.correction where id = p_id for update;
  if not found then
    raise exception 'unknown correction' using errcode = '22023';
  end if;
  if c.author_id = v_user then
    raise exception 'you cannot review your own report' using errcode = '42501';
  end if;
  if c.status is distinct from p_expected_status then
    raise exception 'this report changed since the page was loaded; reload and try again' using errcode = '55000';
  end if;

  v_to := case p_action when 'start_review' then 'under_review' when 'request_info' then 'needs_evidence'
                        when 'reject' then 'rejected' when 'duplicate' then 'duplicate' else 'accepted' end;
  if not ((c.status, v_to) in (
    ('submitted', 'under_review'), ('needs_evidence', 'under_review'),
    ('submitted', 'needs_evidence'), ('under_review', 'needs_evidence'),
    ('submitted', 'rejected'), ('under_review', 'rejected'), ('needs_evidence', 'rejected'),
    ('submitted', 'duplicate'), ('under_review', 'duplicate'), ('needs_evidence', 'duplicate'),
    ('under_review', 'accepted'))) then
    raise exception 'a % report cannot be moved to %', c.status, v_to using errcode = '55000';
  end if;

  if p_action = 'request_info' and (p_reason_code is null or p_reason_code not in ('need_photo', 'need_location', 'need_details', 'need_time')) then
    raise exception 'choose what information is needed' using errcode = '22023';
  end if;
  if p_action = 'reject' and (p_reason_code is null or p_reason_code not in ('already_correct', 'not_verifiable', 'out_of_scope', 'not_transport')) then
    raise exception 'choose a reason for rejecting' using errcode = '22023';
  end if;
  if p_action in ('start_review', 'duplicate', 'accept') and p_reason_code is not null then
    raise exception 'this action takes no reason code' using errcode = '22023';
  end if;
  if p_action = 'duplicate' then
    if p_duplicate_of is null or p_duplicate_of = c.id
       or not exists (select 1 from community.correction o where o.id = p_duplicate_of and o.status <> 'draft') then
      raise exception 'choose the report this one duplicates' using errcode = '22023';
    end if;
  elsif p_duplicate_of is not null then
    raise exception 'only a duplicate names another report' using errcode = '22023';
  end if;
  if p_action <> 'accept' and (p_draft_version_id is not null or p_fare_rule_version_id is not null) then
    raise exception 'only an accepted report records a change' using errcode = '22023';
  end if;

  if p_action = 'accept' then
    -- The change goes into the open draft only, never into a published revision.
    v_draft := transit.admin_open_draft();
    if p_draft_version_id is not null then
      select m.entity_kind, m.entity_id into v_member
        from transit.revision_member m where m.revision_id = v_draft and m.version_id = p_draft_version_id;
      if not found then
        raise exception 'that version is not in the open draft' using errcode = '22023';
      end if;
      if transit.in_released_revision(p_draft_version_id) then
        raise exception 'that version is already published; make the change in the draft first' using errcode = '22023';
      end if;
      if c.entity_type = 'stop' and (v_member.entity_kind <> 'stop_point' or v_member.entity_id::text <> c.entity_id) then
        raise exception 'that version belongs to another stop' using errcode = '22023';
      end if;
      v_change := jsonb_build_object('kind', 'draft_version', 'entityKind', v_member.entity_kind,
                                     'entityId', v_member.entity_id, 'versionId', p_draft_version_id);
    else
      if v_note is null then
        raise exception 'describe the change to make (a proposal needs a note)' using errcode = '22023';
      end if;
      v_change := jsonb_build_object('kind', 'proposal');
    end if;
    if p_fare_rule_version_id is not null then
      if not exists (select 1 from transit.fare_rule_version fv where fv.id = p_fare_rule_version_id) then
        raise exception 'unknown fare rule version' using errcode = '22023';
      end if;
      v_change := v_change || jsonb_build_object('fareRuleVersionId', p_fare_rule_version_id);
    end if;
  end if;

  update community.correction
     set status = v_to,
         reviewer_note = coalesce(v_note, reviewer_note),
         duplicate_of = coalesce(p_duplicate_of, duplicate_of),
         draft_revision_id = coalesce(v_draft, draft_revision_id),
         draft_change = coalesce(v_change, draft_change),
         reviewed_by = v_user, reviewed_at = now(), updated_at = now()
   where id = p_id;
  insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role, reason_code, note)
  values (p_id, c.status, v_to, v_user, v_role, p_reason_code, v_note);
  perform core.audit('correction.review', 'community.correction', p_id::text,
    jsonb_build_object('action', p_action, 'from', c.status, 'to', v_to, 'reason_code', p_reason_code,
                       'duplicate_of', p_duplicate_of, 'draft_revision_id', v_draft, 'draft_change', v_change));
  return jsonb_build_object('id', p_id, 'status', v_to, 'draftRevisionId', v_draft, 'draftChange', v_change);
end;
$$;
alter function community.admin_review_correction(uuid, text, text, text, text, uuid, uuid, uuid) owner to paranaga_definer;
revoke execute on function community.admin_review_correction(uuid, text, text, text, text, uuid, uuid, uuid) from public;
grant execute on function community.admin_review_correction(uuid, text, text, text, text, uuid, uuid, uuid) to paranaga_app;

-- Publication of a draft incorporates its accepted draft changes (AC-13: accepted is not live;
-- only a validated publication makes it so). Proposals stay 'accepted' until someone makes the
-- change in a later draft.
create or replace function community.incorporate_corrections() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and old.status <> 'superseded' then
    with done as (
      update community.correction c
         set status = 'incorporated', incorporated_revision_id = new.id, updated_at = now()
       where c.status = 'accepted' and c.draft_revision_id = new.id and c.draft_change ->> 'kind' = 'draft_version'
      returning c.id)
    insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role)
    select d.id, 'accepted', 'incorporated', core.current_user_id(), 'publication' from done d;
  end if;
  return null;
end;
$$;
create trigger revision_incorporates_corrections
  after update of status on transit.revision
  for each row execute function community.incorporate_corrections();
alter function community.incorporate_corrections() owner to paranaga_definer;
revoke execute on function community.incorporate_corrections() from public;

-- ================================================================ C10: moderation tables
create table community.jev_evidence (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  target_type        text not null check (target_type in ('post_version', 'comment')),
  target_id          uuid not null,
  recommendation     text check (recommendation in ('publish', 'reject', 'human_review')),
  confidence         numeric check (confidence between 0 and 1),
  unavailable_reason text check (unavailable_reason is null or unavailable_reason ~ '^[a-z_]{1,40}$'),
  policy_version     text check (policy_version is null or char_length(policy_version) <= 60),
  model              text check (model is null or char_length(model) <= 80),
  created_at         timestamptz not null default now(),
  unique (target_type, target_id),
  check ((recommendation is null) = (confidence is null)),
  check (num_nonnulls(recommendation, unavailable_reason) = 1)
);

create table community.moderation_decision (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  target_type        text not null check (target_type in ('post_version', 'comment', 'photo')),
  target_id          uuid not null,
  author_id          text not null,
  outcome            text not null check (outcome in ('published', 'rejected')),
  decided_by         text not null,
  decider_role       text not null check (decider_role in ('policy', 'community_moderator', 'admin')),
  reason_code        text not null check (reason_code ~ '^[a-z_]{1,60}$'),
  note               text check (note is null or char_length(note) <= 1000),
  jev_recommendation text check (jev_recommendation in ('publish', 'reject', 'human_review')),
  jev_confidence     numeric check (jev_confidence between 0 and 1),
  is_override        boolean not null default false,
  appeal_id          uuid,
  created_at         timestamptz not null default now(),
  -- Overriding Jev needs a written reason (outline C10).
  constraint decision_override_note check (not is_override or btrim(coalesce(note, '')) <> ''),
  constraint decision_policy check ((decider_role = 'policy') = (decided_by = 'policy')),
  -- Nobody moderates their own content.
  constraint decision_not_own check (decided_by <> author_id)
);
create index moderation_decision_target_idx on community.moderation_decision (target_type, target_id, created_at desc);
create index moderation_decision_decider_idx on community.moderation_decision (decided_by, created_at desc);

create table community.appeal (
  id                     uuid primary key default pg_catalog.gen_random_uuid(),
  decision_id            uuid not null unique references community.moderation_decision (id),
  -- The appealed item, copied from the decision so the author can see their appeal's state
  -- without any access to moderation decisions.
  target_type            text not null check (target_type in ('post_version', 'comment', 'photo')),
  target_id              uuid not null,
  author_id              text not null,
  note                   text not null check (char_length(btrim(note)) between 10 and 1000),
  original_decider       text not null,
  status                 text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  resolved_by            text,
  resolved_at            timestamptz,
  resolution_decision_id uuid references community.moderation_decision (id),
  created_at             timestamptz not null default now(),
  -- Appeals go to a DIFFERENT moderator than the one who decided, and never to the author.
  constraint appeal_other_moderator check (resolved_by is null or (resolved_by <> original_decider and resolved_by <> author_id)),
  constraint appeal_resolved check ((status = 'open') = (resolved_by is null and resolved_at is null and resolution_decision_id is null))
);
create index appeal_open_idx on community.appeal (created_at) where status = 'open';
create index appeal_author_idx on community.appeal (author_id);
-- One appeal per item, ever (the decision on an appeal is final).
create unique index appeal_target_uq on community.appeal (target_type, target_id);
create index appeal_resolution_idx on community.appeal (resolution_decision_id);
alter table community.moderation_decision
  add constraint moderation_decision_appeal_fk foreign key (appeal_id) references community.appeal (id);
create index moderation_decision_appeal_idx on community.moderation_decision (appeal_id) where appeal_id is not null;

create table community.post_photo (
  id                uuid primary key default pg_catalog.gen_random_uuid(),
  post_id           uuid not null references community.post (id) on delete cascade,
  media_object_id   uuid not null unique references core.media_object (id),
  author_id         text not null,
  position          smallint not null check (position between 1 and 3),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'published', 'rejected')),
  public_bucket     text,
  public_key        text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (post_id, position),
  constraint post_photo_public check ((moderation_status = 'published') = (public_bucket is not null and public_key is not null))
);
create index post_photo_pending_idx on community.post_photo (created_at) where moderation_status = 'pending';

alter table community.jev_evidence enable row level security;
alter table community.jev_evidence force row level security;
alter table community.moderation_decision enable row level security;
alter table community.moderation_decision force row level security;
alter table community.appeal enable row level security;
alter table community.appeal force row level security;
alter table community.post_photo enable row level security;
alter table community.post_photo force row level security;

-- Jev evidence and decisions are staff-only (no app grant). The app reads photos: published ones
-- of a post it may read, and the caller's own. Appeals: the author reads their own.
grant select on community.post_photo, community.appeal to paranaga_app;
create policy post_photo_read on community.post_photo for select to paranaga_app
  using (author_id = (select core.current_user_id())
         or (moderation_status = 'published' and exists (select 1 from community.post p where p.id = post_id)));
create policy appeal_own_read on community.appeal for select to paranaga_app
  using (author_id = (select core.current_user_id()));

grant select, insert on community.jev_evidence to paranaga_definer;
create policy definer_read on community.jev_evidence for select to paranaga_definer using (true);
create policy definer_insert on community.jev_evidence for insert to paranaga_definer with check (true);
grant select, insert on community.moderation_decision to paranaga_definer;
grant update (appeal_id) on community.moderation_decision to paranaga_definer;
create policy definer_read on community.moderation_decision for select to paranaga_definer using (true);
create policy definer_insert on community.moderation_decision for insert to paranaga_definer with check (true);
create policy definer_link_appeal on community.moderation_decision for update to paranaga_definer
  using (appeal_id is null) with check (appeal_id is not null);
grant select, insert on community.appeal to paranaga_definer;
grant update (status, resolved_by, resolved_at, resolution_decision_id) on community.appeal to paranaga_definer;
create policy definer_read on community.appeal for select to paranaga_definer using (true);
create policy definer_insert on community.appeal for insert to paranaga_definer with check (status = 'open');
create policy definer_resolve on community.appeal for update to paranaga_definer
  using (status = 'open') with check (status in ('upheld', 'overturned'));
grant select, insert on community.post_photo to paranaga_definer;
grant update (moderation_status, public_bucket, public_key, decided_at) on community.post_photo to paranaga_definer;
create policy definer_read on community.post_photo for select to paranaga_definer using (true);
create policy definer_insert on community.post_photo for insert to paranaga_definer with check (moderation_status = 'pending');
create policy definer_decide on community.post_photo for update to paranaga_definer using (true) with check (true);

-- ================================================================ C10: helpers
create or replace function community.assert_moderator() returns text
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
alter function community.assert_moderator() owner to paranaga_definer;
revoke execute on function community.assert_moderator() from public;

-- The author and current state of a moderation target (locked), or no row.
create or replace function community.content_target(p_type text, p_id uuid, out o_author text, out o_status text, out o_post uuid)
  language plpgsql volatile
  set search_path = pg_catalog, community, pg_temp
as $$
begin
  if p_type = 'post_version' then
    select v.author_id, v.moderation_status, v.post_id into o_author, o_status, o_post
      from community.post_version v join community.post p on p.id = v.post_id and p.deleted_at is null
     where v.id = p_id for update of v;
  elsif p_type = 'comment' then
    select c.author_id, c.moderation_status, c.post_id into o_author, o_status, o_post
      from community.comment c where c.id = p_id and c.deleted_at is null for update;
  elsif p_type = 'photo' then
    select ph.author_id, ph.moderation_status, ph.post_id into o_author, o_status, o_post
      from community.post_photo ph join community.post p on p.id = ph.post_id and p.deleted_at is null
     where ph.id = p_id for update of ph;
  else
    raise exception 'unknown content type' using errcode = '22023';
  end if;
end;
$$;
alter function community.content_target(text, uuid) owner to paranaga_definer;
revoke execute on function community.content_target(text, uuid) from public;

-- Applies an outcome to a target already locked by content_target. A post version is published
-- only while it is the newest unsuperseded version (an edit since then is reviewed on its own).
-- For a photo, publishing records the public copy (bucket + key the server copies to); returns
-- the private source for the server to copy from.
create or replace function community.apply_content_outcome(p_type text, p_id uuid, p_outcome text, p_reason text, p_public_bucket text)
returns jsonb
  language plpgsql volatile
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_post uuid;
  v_media core.media_object%rowtype;
begin
  if p_type = 'post_version' then
    select v.post_id into v_post from community.post_version v where v.id = p_id;
    if p_outcome = 'published' then
      if exists (select 1 from community.post_version n
                  where n.post_id = v_post and n.n > (select v.n from community.post_version v where v.id = p_id)) then
        raise exception 'the author has edited this post since; review the newer version' using errcode = '55000';
      end if;
      update community.post_version set moderation_status = 'superseded' where post_id = v_post and moderation_status = 'published';
    end if;
    update community.post_version set moderation_status = p_outcome, moderation_reason = left(p_reason, 60), decided_at = now()
     where id = p_id;
    if p_outcome = 'published' then
      update community.post set published_version_id = p_id, updated_at = now() where id = v_post;
    end if;
    return null;
  elsif p_type = 'comment' then
    update community.comment set moderation_status = p_outcome, moderation_reason = left(p_reason, 60), decided_at = now()
     where id = p_id;
    return null;
  end if;
  -- photo
  select m.* into v_media from core.media_object m join community.post_photo ph on ph.media_object_id = m.id where ph.id = p_id;
  if p_outcome = 'published' then
    if p_public_bucket is null or p_public_bucket !~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' or p_public_bucket = v_media.bucket then
      raise exception 'approving a photo needs the public bucket' using errcode = '22023';
    end if;
    if v_media.status <> 'verified' or v_media.purpose <> 'community_photo' then
      raise exception 'the photo is not a verified community photo' using errcode = '55000';
    end if;
    update community.post_photo
       set moderation_status = 'published', public_bucket = p_public_bucket, public_key = v_media.object_key, decided_at = now()
     where id = p_id;
    return jsonb_build_object('sourceBucket', v_media.bucket, 'key', v_media.object_key, 'mime', v_media.mime,
                              'publicBucket', p_public_bucket);
  end if;
  update community.post_photo set moderation_status = 'rejected', decided_at = now() where id = p_id;
  return null;
end;
$$;
alter function community.apply_content_outcome(text, uuid, text, text, text) owner to paranaga_definer;
revoke execute on function community.apply_content_outcome(text, uuid, text, text, text) from public;

-- ================================================================ C10: commuter-side writes
-- The server records Jev's typed answer right after it stored the content, in the same request.
-- Only for the caller's own, just-submitted content; one row per target (a retry is a no-op).
create or replace function community.record_jev_evidence(
  p_target_type text, p_target_id uuid, p_recommendation text, p_confidence numeric,
  p_unavailable_reason text, p_policy_version text, p_model text)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_ok boolean;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target_type = 'post_version' then
    select true into v_ok from community.post_version v
     where v.id = p_target_id and v.author_id = v_user and v.submitted_at > now() - interval '10 minutes';
  elsif p_target_type = 'comment' then
    select true into v_ok from community.comment c
     where c.id = p_target_id and c.author_id = v_user and c.created_at > now() - interval '10 minutes';
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_ok is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into community.jev_evidence (target_type, target_id, recommendation, confidence, unavailable_reason, policy_version, model)
  values (p_target_type, p_target_id, p_recommendation, p_confidence, p_unavailable_reason, left(p_policy_version, 60), left(p_model, 80))
  on conflict (target_type, target_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.record_jev_evidence(text, uuid, text, numeric, text, text, text) owner to paranaga_definer;
revoke execute on function community.record_jev_evidence(text, uuid, text, numeric, text, text, text) from public;
grant execute on function community.record_jev_evidence(text, uuid, text, numeric, text, text, text) to paranaga_app;

-- Photos for the caller's own post: verified community_photo uploads of the caller, at most 3 per
-- post. They wait for a moderator; nothing is public until approval copies them.
create or replace function community.add_post_photos(p_post_id uuid, p_media_ids uuid[]) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_have integer;
  v_good integer;
  v_id uuid;
  v_pos smallint;
  v_added integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from community.post p where p.id = p_post_id and p.author_id = v_user and p.deleted_at is null for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_media_ids is null or cardinality(p_media_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_media_ids) <> (select count(distinct x) from unnest(p_media_ids) x) then
    raise exception 'invalid media' using errcode = '22023';
  end if;
  select count(*) into v_good from core.media_object m
   where m.id = any (p_media_ids) and m.owner_id = v_user and m.purpose = 'community_photo' and m.status = 'verified'
     and not exists (select 1 from community.post_photo ph where ph.media_object_id = m.id and ph.post_id <> p_post_id);
  if v_good <> cardinality(p_media_ids) then
    raise exception 'invalid media' using errcode = '22023';
  end if;
  foreach v_id in array p_media_ids loop
    continue when exists (select 1 from community.post_photo ph where ph.media_object_id = v_id);
    select count(*) into v_have from community.post_photo ph where ph.post_id = p_post_id;
    if v_have >= 3 then
      raise exception 'a post has at most 3 photos' using errcode = '22023';
    end if;
    select min(s.n)::smallint into v_pos from generate_series(1, 3) s(n)
     where not exists (select 1 from community.post_photo ph where ph.post_id = p_post_id and ph.position = s.n);
    insert into community.post_photo (post_id, media_object_id, author_id, position)
    values (p_post_id, v_id, v_user, v_pos);
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;
alter function community.add_post_photos(uuid, uuid[]) owner to paranaga_definer;
revoke execute on function community.add_post_photos(uuid, uuid[]) from public;
grant execute on function community.add_post_photos(uuid, uuid[]) to paranaga_app;

-- One appeal per decision, by the author of rejected content. A Jev auto-reject has no decision
-- row yet: it is recorded here as the policy's decision (decided_by 'policy').
create or replace function community.submit_appeal(p_target_type text, p_target_id uuid, p_note text) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  t record;
  v_reason text;
  v_decision community.moderation_decision%rowtype;
  v_appeal uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'invalid note' using errcode = '22023';
  end if;
  select * into t from community.content_target(p_target_type, p_target_id);
  if t.o_author is distinct from v_user then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if t.o_status <> 'rejected' then
    raise exception 'only a rejected item can be appealed' using errcode = '22023';
  end if;
  select d.* into v_decision from community.moderation_decision d
   where d.target_type = p_target_type and d.target_id = p_target_id
   order by d.created_at desc limit 1;
  if not found then
    if p_target_type = 'post_version' then
      select v.moderation_reason into v_reason from community.post_version v where v.id = p_target_id;
    elsif p_target_type = 'comment' then
      select c.moderation_reason into v_reason from community.comment c where c.id = p_target_id;
    end if;
    insert into community.moderation_decision (target_type, target_id, author_id, outcome, decided_by, decider_role,
                                               reason_code, jev_recommendation, jev_confidence)
    select p_target_type, p_target_id, v_user, 'rejected', 'policy', 'policy',
           case when coalesce(v_reason, '') ~ '^[a-z_]{1,60}$' then v_reason else 'policy_reject' end,
           j.recommendation, j.confidence
      from (select 1) one
      left join community.jev_evidence j on j.target_type = p_target_type and j.target_id = p_target_id
    returning * into v_decision;
  elsif v_decision.outcome <> 'rejected' then
    raise exception 'only a rejected item can be appealed' using errcode = '22023';
  end if;
  -- One appeal per item: the decision on an appeal cannot be appealed again.
  if exists (select 1 from community.appeal a where a.target_type = p_target_type and a.target_id = p_target_id) then
    raise exception 'this decision was already appealed' using errcode = '23505';
  end if;
  insert into community.appeal (decision_id, target_type, target_id, author_id, note, original_decider)
  values (v_decision.id, p_target_type, p_target_id, v_user, btrim(p_note), v_decision.decided_by)
  returning id into v_appeal;
  update community.moderation_decision set appeal_id = v_appeal where id = v_decision.id;
  perform core.audit('community.appeal', 'community.appeal', v_appeal::text,
    jsonb_build_object('decision_id', v_decision.id, 'target_type', p_target_type, 'target_id', p_target_id));
  return v_appeal;
end;
$$;
alter function community.submit_appeal(text, uuid, text) owner to paranaga_definer;
revoke execute on function community.submit_appeal(text, uuid, text) from public;
grant execute on function community.submit_appeal(text, uuid, text) to paranaga_app;

-- ================================================================ C10: moderator functions
create or replace function community.admin_moderation_queue(p_limit integer default 100) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := community.assert_moderator();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(q.j order by q.at)
        from (
          select * from (
            select v.submitted_at as at, jsonb_build_object(
                     'kind', 'post_version', 'id', v.id, 'postId', v.post_id, 'status', v.moderation_status,
                     'submittedAt', v.submitted_at, 'title', v.title, 'body', v.body, 'tags', to_jsonb(v.tags),
                     'topic', p.topic, 'authorHandle', community.handle(v.author_id), 'reason', v.moderation_reason,
                     'isEdit', v.n > 1,
                     'liveTitle', (select lv.title from community.post_version lv where lv.id = p.published_version_id),
                     'jev', (select jsonb_build_object('recommendation', j.recommendation, 'confidence', j.confidence,
                                                       'unavailableReason', j.unavailable_reason, 'policyVersion', j.policy_version)
                               from community.jev_evidence j where j.target_type = 'post_version' and j.target_id = v.id),
                     'openReports', (select count(*) from community.content_report r
                                      where r.target_type = 'post' and r.target_id = p.id and r.status = 'open')) as j
              from community.post_version v
              join community.post p on p.id = v.post_id and p.deleted_at is null
             where v.moderation_status in ('pending', 'human_review') and v.author_id <> v_user
            union all
            select c.created_at, jsonb_build_object(
                     'kind', 'comment', 'id', c.id, 'postId', c.post_id, 'status', c.moderation_status,
                     'submittedAt', c.created_at, 'title', null, 'body', c.body, 'tags', '[]'::jsonb,
                     'topic', null, 'authorHandle', community.handle(c.author_id), 'reason', c.moderation_reason,
                     'isEdit', false, 'liveTitle', null,
                     'jev', (select jsonb_build_object('recommendation', j.recommendation, 'confidence', j.confidence,
                                                       'unavailableReason', j.unavailable_reason, 'policyVersion', j.policy_version)
                               from community.jev_evidence j where j.target_type = 'comment' and j.target_id = c.id),
                     'openReports', (select count(*) from community.content_report r
                                      where r.target_type = 'comment' and r.target_id = c.id and r.status = 'open'))
              from community.comment c
             where c.moderation_status in ('pending', 'human_review') and c.deleted_at is null and c.author_id <> v_user
            union all
            select ph.created_at, jsonb_build_object(
                     'kind', 'photo', 'id', ph.id, 'postId', ph.post_id, 'status', ph.moderation_status,
                     'submittedAt', ph.created_at,
                     'title', (select pv.title from community.post_version pv
                                where pv.post_id = ph.post_id and pv.moderation_status <> 'superseded' order by pv.n desc limit 1),
                     'body', null, 'tags', '[]'::jsonb, 'topic', null, 'authorHandle', community.handle(ph.author_id),
                     'reason', null, 'isEdit', false, 'liveTitle', null, 'jev', null, 'openReports', 0,
                     'mediaId', ph.media_object_id)
              from community.post_photo ph
              join community.post p on p.id = ph.post_id and p.deleted_at is null
             where ph.moderation_status = 'pending' and ph.author_id <> v_user
          ) u order by 1 limit v_limit
        ) q), '[]'::jsonb),
    -- Appeals are routed away from the person who made the decision, and never to the author.
    'appeals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'decisionId', d.id, 'targetType', d.target_type, 'targetId', d.target_id,
               'reasonCode', d.reason_code, 'decidedAt', d.created_at,
               'decidedBy', case when d.decided_by = 'policy' then 'policy' else 'moderator' end,
               'jevRecommendation', d.jev_recommendation, 'jevConfidence', d.jev_confidence,
               'note', a.note, 'createdAt', a.created_at,
               'excerpt', case d.target_type
                 when 'post_version' then (select left(v.title || ': ' || v.body, 300) from community.post_version v where v.id = d.target_id)
                 when 'comment' then (select left(c.body, 300) from community.comment c where c.id = d.target_id)
                 else null end,
               'mediaId', (select ph.media_object_id from community.post_photo ph where d.target_type = 'photo' and ph.id = d.target_id))
             order by a.created_at)
        from community.appeal a join community.moderation_decision d on d.id = a.decision_id
       where a.status = 'open' and a.original_decider <> v_user and a.author_id <> v_user), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'targetType', d.target_type, 'targetId', d.target_id, 'outcome', d.outcome,
               'reasonCode', d.reason_code, 'deciderRole', d.decider_role, 'isOverride', d.is_override,
               'mine', d.decided_by = v_user, 'appealed', d.appeal_id is not null, 'at', d.created_at)
             order by d.created_at desc)
        from (select * from community.moderation_decision order by created_at desc limit 50) d), '[]'::jsonb));
end;
$$;
alter function community.admin_moderation_queue(integer) owner to paranaga_definer;
revoke execute on function community.admin_moderation_queue(integer) from public;
grant execute on function community.admin_moderation_queue(integer) to paranaga_app;

-- A moderator's decision on pending content (reason codes mirrored in src/domain/admin/moderation.ts).
-- Returns the decision id, whether it overrode Jev, and for an approved photo the copy to make.
create or replace function community.admin_moderate(
  p_target_type text, p_target_id uuid, p_outcome text, p_reason_code text, p_note text, p_public_bucket text)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := community.assert_moderator();
  v_role text := case when core.has_role('community_moderator') then 'community_moderator' else 'admin' end;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  t record;
  j community.jev_evidence%rowtype;
  v_override boolean;
  v_decision uuid;
  v_copy jsonb;
begin
  if p_outcome is null or p_outcome not in ('published', 'rejected') then
    raise exception 'outcome must be published or rejected' using errcode = '22023';
  end if;
  if (p_outcome = 'published' and p_reason_code is distinct from 'meets_guidelines')
     or (p_outcome = 'rejected' and (p_reason_code is null or p_reason_code not in (
           'spam', 'harassment', 'threat', 'personal_info', 'driver_allegation', 'off_topic', 'misleading', 'unsafe_photo', 'other'))) then
    raise exception 'choose a reason that fits the decision' using errcode = '22023';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'the reason "other" needs a note' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'the note is longer than 1000 characters' using errcode = '22023';
  end if;
  select * into t from community.content_target(p_target_type, p_target_id);
  if t.o_author is null then
    raise exception 'unknown item' using errcode = '22023';
  end if;
  if t.o_author = v_user then
    raise exception 'you cannot moderate your own content' using errcode = '42501';
  end if;
  if t.o_status not in ('pending', 'human_review') then
    raise exception 'this item was already decided; reload' using errcode = '55000';
  end if;
  select * into j from community.jev_evidence e where e.target_type = p_target_type and e.target_id = p_target_id;
  v_override := (j.recommendation = 'publish' and p_outcome = 'rejected') or (j.recommendation = 'reject' and p_outcome = 'published');
  if v_override and v_note is null then
    raise exception 'going against Jev''s recommendation needs a note' using errcode = '22023';
  end if;
  v_copy := community.apply_content_outcome(p_target_type, p_target_id, p_outcome, p_reason_code, p_public_bucket);
  insert into community.moderation_decision (target_type, target_id, author_id, outcome, decided_by, decider_role,
                                             reason_code, note, jev_recommendation, jev_confidence, is_override)
  values (p_target_type, p_target_id, t.o_author, p_outcome, v_user, v_role, p_reason_code, v_note,
          j.recommendation, j.confidence, coalesce(v_override, false))
  returning id into v_decision;
  perform core.audit(case when coalesce(v_override, false) then 'community.override' else 'community.moderate' end,
    'community.' || p_target_type, p_target_id::text,
    jsonb_build_object('decision_id', v_decision, 'outcome', p_outcome, 'reason_code', p_reason_code,
                       'jev_recommendation', j.recommendation, 'jev_confidence', j.confidence, 'is_override', coalesce(v_override, false)));
  return jsonb_build_object('decisionId', v_decision, 'isOverride', coalesce(v_override, false), 'copy', v_copy);
end;
$$;
alter function community.admin_moderate(text, uuid, text, text, text, text) owner to paranaga_definer;
revoke execute on function community.admin_moderate(text, uuid, text, text, text, text) from public;
grant execute on function community.admin_moderate(text, uuid, text, text, text, text) to paranaga_app;

-- Resolve an appeal: upheld (stays rejected) or overturned (published). Never by the original
-- decider or the author (the appeal table's CHECK repeats this). Overturning a policy (Jev)
-- decision is an override and is audited as one. A note is always required (decision history).
create or replace function community.admin_resolve_appeal(p_appeal_id uuid, p_outcome text, p_note text, p_public_bucket text)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := community.assert_moderator();
  v_role text := case when core.has_role('community_moderator') then 'community_moderator' else 'admin' end;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  a community.appeal%rowtype;
  d community.moderation_decision%rowtype;
  t record;
  v_override boolean;
  v_decision uuid;
  v_copy jsonb;
begin
  if p_outcome is null or p_outcome not in ('upheld', 'overturned') then
    raise exception 'outcome must be upheld or overturned' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'write a note of up to 1000 characters for the decision history' using errcode = '22023';
  end if;
  select * into a from community.appeal where id = p_appeal_id for update;
  if not found then
    if exists (select 1 from community.appeal x where x.id = p_appeal_id) then
      raise exception 'this appeal was already resolved; reload' using errcode = '55000';
    end if;
    raise exception 'unknown appeal' using errcode = '22023';
  end if;
  if a.status <> 'open' then
    raise exception 'this appeal was already resolved; reload' using errcode = '55000';
  end if;
  if a.original_decider = v_user then
    raise exception 'a different moderator must decide this appeal' using errcode = '42501';
  end if;
  if a.author_id = v_user then
    raise exception 'you cannot decide an appeal about your own content' using errcode = '42501';
  end if;
  select * into d from community.moderation_decision where id = a.decision_id;
  select * into t from community.content_target(d.target_type, d.target_id);
  if t.o_author is null then
    raise exception 'the item no longer exists' using errcode = '55000';
  end if;
  if p_outcome = 'overturned' then
    if t.o_status <> 'rejected' then
      raise exception 'the item is no longer rejected; reload' using errcode = '55000';
    end if;
    v_copy := community.apply_content_outcome(d.target_type, d.target_id, 'published', 'appeal_overturned', p_public_bucket);
  end if;
  v_override := p_outcome = 'overturned' and d.decided_by = 'policy';
  insert into community.moderation_decision (target_type, target_id, author_id, outcome, decided_by, decider_role,
                                             reason_code, note, jev_recommendation, jev_confidence, is_override, appeal_id)
  values (d.target_type, d.target_id, d.author_id, case when p_outcome = 'overturned' then 'published' else 'rejected' end,
          v_user, v_role, case when p_outcome = 'overturned' then 'appeal_overturned' else 'appeal_upheld' end, v_note,
          d.jev_recommendation, d.jev_confidence, v_override, a.id)
  returning id into v_decision;
  update community.appeal set status = p_outcome, resolved_by = v_user, resolved_at = now(), resolution_decision_id = v_decision
   where id = a.id;
  perform core.audit(case when v_override then 'community.override' else 'community.appeal_resolve' end,
    'community.appeal', a.id::text,
    jsonb_build_object('decision_id', v_decision, 'appealed_decision_id', d.id, 'outcome', p_outcome,
                       'target_type', d.target_type, 'target_id', d.target_id, 'is_override', v_override,
                       'original_decider', case when d.decided_by = 'policy' then 'policy' else 'moderator' end));
  return jsonb_build_object('decisionId', v_decision, 'isOverride', v_override, 'copy', v_copy);
end;
$$;
alter function community.admin_resolve_appeal(uuid, text, text, text) owner to paranaga_definer;
revoke execute on function community.admin_resolve_appeal(uuid, text, text, text) from public;
grant execute on function community.admin_resolve_appeal(uuid, text, text, text) to paranaga_app;

-- ================================================================ reviewers read a private photo
-- A reviewer sees a private photo only while reviewing what it belongs to: correction evidence
-- (transport reviewer or admin; not their own report), a community photo (moderator or admin; not
-- their own), a stop photo attached as evidence (transport staff). Every read is audited. The
-- server streams the bytes from the private bucket; nothing here makes a photo public.
create or replace function core.admin_review_media(p_media_id uuid) returns table (bucket text, object_key text, mime text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, community, transit, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  m core.media_object%rowtype;
  v_ok boolean := false;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into m from core.media_object mo where mo.id = p_media_id and mo.status = 'verified';
  if found then
    if m.purpose = 'correction_evidence' then
      v_ok := (core.has_role('transport_reviewer') or core.has_role('admin'))
        and exists (select 1 from community.correction c where p_media_id = any (c.media_ids) and c.author_id <> v_user);
    elsif m.purpose = 'community_photo' then
      v_ok := (core.has_role('community_moderator') or core.has_role('admin'))
        and exists (select 1 from community.post_photo ph where ph.media_object_id = p_media_id and ph.author_id <> v_user);
    elsif m.purpose = 'stop_photo' then
      v_ok := (core.has_role('transport_reviewer') or core.has_role('admin'))
        and exists (select 1 from transit.evidence e where e.media_object_id = p_media_id);
    end if;
  end if;
  if not v_ok then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform core.audit('media.review_view', 'core.media_object', p_media_id::text, jsonb_build_object('purpose', m.purpose));
  return query select m.bucket, m.object_key, m.mime;
end;
$$;
alter function core.admin_review_media(uuid) owner to paranaga_definer;
revoke execute on function core.admin_review_media(uuid) from public;
grant execute on function core.admin_review_media(uuid) to paranaga_app;

revoke create on schema core from paranaga_definer;
revoke create on schema community from paranaga_definer;
