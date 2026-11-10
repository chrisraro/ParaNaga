-- 0030_lifecycle_guards.sql
-- Three lifecycle guards on reviewer state machines. No table is created, altered or rewritten;
-- only function grants and two function bodies change. Runs in one transaction (scripts/migrate.ts).
--
-- 1. Legacy reviewer functions lose their app grant (kept, not dropped):
--      community.set_correction_status(uuid, text, text, text)   0016
--      community.set_content_status(text, uuid, text, text)      0017
--    Nothing in src/ calls them. The live paths are community.admin_review_correction and
--    community.admin_moderate (0025), which lock the row, check the status the page showed,
--    record the decision and audit it; the legacy ones do none of the last three.
--
-- 2. priv.set_complaint_status gains an optional last parameter p_expected_status (default
--    null). When it is given and differs from the report's status, read under the row lock the
--    function already takes, the call is refused with SQLSTATE 55000 and the same message as
--    community.admin_review_correction (0025), which the server already maps to 409.
--    A defaulted parameter added with CREATE OR REPLACE would be a second overload and make the
--    existing 2- to 5-argument calls ambiguous, so the 0018 signature is dropped and the function
--    is created again in this transaction with the same body, owner, SECURITY DEFINER,
--    search_path and grants (0026 did not re-create it).
--
-- 3. community.incorporate_corrections() (0025 trigger function on transit.revision; same name,
--    owner, search_path; the trigger itself is untouched). Publishing a draft is unchanged. New:
--    when a SUPERSEDED revision is published again (a rollback, or going forward again):
--      - a correction that is 'incorporated' but whose change is not in the revision now live
--        goes back to 'accepted' (incorporated_revision_id null, exactly the state it had before
--        its draft was published) with a correction_event incorporated -> accepted, actor_role
--        'publication', reason_code 'publication_rolled_back';
--      - a correction put back that way becomes 'incorporated' again when a revision that has
--        its change is published again (event accepted -> incorporated, as in 0025).
--    "Has its change" is decided generously, so a rollback never un-incorporates by mistake:
--    the correction's revision is the published revision or one of its ancestors
--    (transit.revision.parent_revision_id, set by the admin draft and by every importer), OR the
--    recorded draft version is a member of the published revision.
--    Not covered (left as before): publishing a DRAFT never puts a correction back, so a draft
--    cut from a rolled-back state and published over a restored revision leaves that revision's
--    corrections 'incorporated'.
--
-- Backward compatibility: the running app works before and after this migration with no code
-- change. src/server/admin/complaint-handlers.ts passes five arguments, which resolve to the new
-- function with p_expected_status null (no check, as today). A later, separate code change will
-- pass the status the page showed.
--
-- Manual rollback (owner connection):
--   begin;
--   grant execute on function community.set_correction_status(uuid, text, text, text) to paranaga_app;
--   grant execute on function community.set_content_status(text, uuid, text, text) to paranaga_app;
--   commit;
--   Parts 2 and 3 are supersets of the old behaviour and can stay. To restore them exactly:
--   `grant create on schema priv, community to paranaga_definer;`, then
--   `drop function priv.set_complaint_status(uuid, text, text, text, text, text);` and run the
--   priv.set_complaint_status block of 0018 (create, owner, revoke, grant) and the
--   community.incorporate_corrections block of 0025 (create or replace, owner, revoke), then
--   `revoke create on schema priv, community from paranaga_definer;`.

grant create on schema community to paranaga_definer;
grant create on schema priv to paranaga_definer;

-- ================================================================ 1. legacy reviewer functions
revoke execute on function community.set_correction_status(uuid, text, text, text) from public;
revoke execute on function community.set_correction_status(uuid, text, text, text) from paranaga_app;
revoke execute on function community.set_content_status(text, uuid, text, text) from public;
revoke execute on function community.set_content_status(text, uuid, text, text) from paranaga_app;

-- ================================================================ 2. complaint status: expected status
drop function if exists priv.set_complaint_status(uuid, text, text, text, text);

-- p_expected_status is the status the page showed (55000 when it changed); null skips the check.
create or replace function priv.set_complaint_status(
  p_id uuid,
  p_to text,
  p_outcome_code text default null,
  p_note text default null,
  p_visibility text default 'reporter',
  p_expected_status text default null
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
  if p_expected_status is not null and v_from is distinct from p_expected_status then
    raise exception 'this report changed since the page was loaded; reload and try again' using errcode = '55000';
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
alter function priv.set_complaint_status(uuid, text, text, text, text, text) owner to paranaga_definer;
revoke execute on function priv.set_complaint_status(uuid, text, text, text, text, text) from public;
grant execute on function priv.set_complaint_status(uuid, text, text, text, text, text) to paranaga_app;

-- ================================================================ 3. corrections follow a rollback
-- Publication of a draft incorporates its accepted draft changes (0025, unchanged). Publishing a
-- superseded revision again re-derives 'incorporated' for the corrections that went through a
-- publication: see the header. Text comparisons on draft_change, never a cast: this runs inside
-- every rollback and must not fail on a malformed value.
create or replace function community.incorporate_corrections() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_line uuid[];
begin
  if new.status = 'published' and old.status is distinct from 'published' and old.status <> 'superseded' then
    with done as (
      update community.correction c
         set status = 'incorporated', incorporated_revision_id = new.id, updated_at = now()
       where c.status = 'accepted' and c.draft_revision_id = new.id and c.draft_change ->> 'kind' = 'draft_version'
      returning c.id)
    insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role)
    select d.id, 'accepted', 'incorporated', core.current_user_id(), 'publication' from done d;
  elsif new.status = 'published' and old.status = 'superseded' then
    -- The published revision and its ancestors (UNION drops repeats, so a loop cannot run away).
    with recursive line as (
      select r.id, r.parent_revision_id from transit.revision r where r.id = new.id
      union
      select p.id, p.parent_revision_id from line l join transit.revision p on p.id = l.parent_revision_id)
    select array_agg(l.id) into v_line from line l;

    -- No longer live: back to 'accepted', as it was before its draft was published.
    with done as (
      update community.correction c
         set status = 'accepted', incorporated_revision_id = null, updated_at = now()
       where c.status = 'incorporated'
         and c.incorporated_revision_id is not null
         and not (c.incorporated_revision_id = any (v_line))
         and not exists (
           select 1 from transit.revision_member m
            where m.revision_id = new.id
              and m.entity_kind = c.draft_change ->> 'entityKind'
              and m.version_id::text = c.draft_change ->> 'versionId')
      returning c.id)
    insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role, reason_code)
    select d.id, 'incorporated', 'accepted', core.current_user_id(), 'publication', 'publication_rolled_back' from done d;

    -- Live again: only corrections whose draft was released before (never an open draft's).
    with done as (
      update community.correction c
         set status = 'incorporated',
             incorporated_revision_id = case when c.draft_revision_id = any (v_line) then c.draft_revision_id else new.id end,
             updated_at = now()
       where c.status = 'accepted' and c.incorporated_revision_id is null
         and c.draft_change ->> 'kind' = 'draft_version'
         and exists (select 1 from transit.revision d
                      where d.id = c.draft_revision_id and d.status in ('published', 'superseded'))
         and (c.draft_revision_id = any (v_line)
              or exists (
                select 1 from transit.revision_member m
                 where m.revision_id = new.id
                   and m.entity_kind = c.draft_change ->> 'entityKind'
                   and m.version_id::text = c.draft_change ->> 'versionId'))
      returning c.id)
    insert into community.correction_event (correction_id, from_status, to_status, actor_id, actor_role)
    select d.id, 'accepted', 'incorporated', core.current_user_id(), 'publication' from done d;
  end if;
  return null;
end;
$$;
alter function community.incorporate_corrections() owner to paranaga_definer;
revoke execute on function community.incorporate_corrections() from public;

revoke create on schema priv from paranaga_definer;
revoke create on schema community from paranaga_definer;
