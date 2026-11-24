-- 0031_stale_draft_guard.sql
-- Audit finding C1 (docs/ERD.md §3.1, §5): a draft is a FULL snapshot of the revision it was made
-- from (transit.revision.parent_revision_id). transit.admin_publish_revision checked the pointer
-- the page showed and the membership hash, but never that the draft's parent is still the
-- published revision. So: an admin opens draft D from A; an import publishes B (or someone rolls
-- back to an older revision); the admin reloads, validates and publishes D; everything B changed
-- disappears without a word. No table is created, altered or rewritten; three function
-- bodies change. Runs in one transaction (scripts/migrate.ts).
--
-- 1. transit.admin_publish_revision (latest definition: 0027; same signature, owner, SECURITY
--    DEFINER, search_path and grants). New, in mode 'publish' only, under the publish lock and the
--    pointer row lock the function already takes: refused with SQLSTATE 55000 when the draft's
--    parent_revision_id IS DISTINCT FROM the published revision. The server already maps 55000 to
--    409 with the message (src/server/admin/handlers.ts adminProblem).
--      - parent = published revision          -> allowed (every draft of transit.admin_create_draft
--                                                that nothing was published over);
--      - parent NULL and nothing published    -> allowed (a first publication);
--      - parent NULL and a revision published -> refused: nothing shows the draft holds what is
--                                                live. No admin path makes such a draft.
--    The check sits before the validation checks, so a stale draft is refused at once and not
--    after a validation that cannot help. Mode 'rollback' is unchanged: re-publishing an earlier
--    revision is a deliberate choice of a named revision and is not a draft. There is no override.
--    The importers do not use this function (they call transit.publish_revision on a draft they
--    cut from the pointer under the same lock in the same transaction), and now refuse to publish
--    while a draft made from the published revision is open (scripts/lib/sql-rows.ts).
--
-- 2. transit.admin_create_draft (0023; same signature, owner, SECURITY DEFINER, search_path and
--    grants). It refused while ANY draft was open, and nothing can discard a draft. With (1) alone
--    a stale draft would be a dead end: it cannot be published and it blocks its replacement. Now
--    only a draft made from the published revision blocks a new one. A stale draft stays in the
--    list as a draft that cannot be published. It also
--    takes the publish lock, so a draft cannot be born stale while a publication commits.
--
-- 3. transit.admin_open_draft (0027; helper of every edit: stop edits, corrections, reconciliation,
--    map import). It took the newest draft whatever its parent, so work could be accepted into a
--    draft that can never be published, with no way to redo it. Now: the newest draft made from
--    the published revision; none of those but a stale one open -> 55000, create a new draft.
--    Known limit: work accepted into a draft before a rollback stays in that draft.
--
-- Backward compatibility: the running app works before and after this migration with no code
-- change. Same signatures and result shapes; the new refusal is one more 55000 message, shown as
-- any other. A draft that is open when this is applied keeps working if its parent is still the
-- published revision.
--
-- Manual rollback (owner connection): `grant create on schema transit to paranaga_definer;`, run
-- the transit.admin_open_draft and transit.admin_publish_revision blocks of 0027 and the
-- transit.admin_create_draft block of 0023 (create or replace, owner, revoke, grant), then
-- `revoke create on schema transit from paranaga_definer;`. No data needs to be restored,
-- but stale drafts left open then block 0023's create and can be published again: check them first.

grant create on schema transit to paranaga_definer;

-- ---------------------------------------------------------------- publish / rollback (C8, F-E11)
create or replace function transit.admin_publish_revision(p_revision uuid, p_expected_published uuid, p_mode text)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, ops, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  v_rev transit.revision%rowtype;
  v_current uuid;
  v_report jsonb;
begin
  perform priv.require_step_up();
  if p_mode is null or p_mode not in ('publish', 'rollback') then
    raise exception 'mode must be publish or rollback' using errcode = '22023';
  end if;

  -- Same lock as transit.publish_revision (re-entrant within this transaction).
  perform pg_advisory_xact_lock(hashtext('transit.publish_revision'));
  select pp.revision_id into v_current from transit.published_pointer pp where pp.singleton for update;
  if v_current is distinct from p_expected_published then
    raise exception 'the published revision changed since this page was loaded; reload and try again' using errcode = '55000';
  end if;

  select * into v_rev from transit.revision r where r.id = p_revision for update;
  if not found then
    raise exception 'unknown revision' using errcode = '22023';
  end if;
  if p_mode = 'publish' and v_rev.status not in ('draft', 'validating') then
    raise exception 'only a draft revision can be published' using errcode = '55000';
  end if;
  if p_mode = 'rollback' and v_rev.status <> 'superseded' then
    raise exception 'a rollback targets an earlier published revision' using errcode = '55000';
  end if;

  -- C1: a draft is a full snapshot of its parent. If the parent is not the published revision any
  -- more, publishing the draft would drop everything published since. NULL parent: only when
  -- nothing is published (IS DISTINCT FROM treats two NULLs as equal).
  if p_mode = 'publish' and v_rev.parent_revision_id is distinct from v_current then
    raise exception 'this draft was made from an older revision and cannot be published; create a new draft from the published revision' using errcode = '55000';
  end if;

  v_report := v_rev.validation_report;
  if v_report is null or (v_report ->> 'ok') is distinct from 'true' then
    raise exception 'validate the revision first; publication needs a validation without errors' using errcode = '55000';
  end if;
  if (v_report ->> 'membershipHash') is distinct from transit.revision_membership_hash(p_revision) then
    raise exception 'the revision changed since it was validated; validate again' using errcode = '55000';
  end if;
  if (v_report ->> 'validatedAt')::timestamptz < now() - interval '30 minutes' then
    raise exception 'the validation is more than 30 minutes old; validate again' using errcode = '55000';
  end if;

  -- Two-person rule (spec 05 §5.3): the publisher differs from the revision's last editor (the
  -- creator when nobody edited the draft).
  if exists (select 1 from ops.feature_flag f where f.key = 'publish_requires_second_reviewer' and f.enabled)
     and coalesce(v_rev.last_edited_by, v_rev.created_by) = v_user then
    raise exception 'a second reviewer must publish this revision' using errcode = '42501';
  end if;

  -- Re-runs every hard check, supersedes, publishes, moves the pointer and audits.
  perform transit.publish_revision(p_revision);
  return jsonb_build_object('revisionId', p_revision, 'previousRevisionId', v_current, 'mode', p_mode);
end;
$$;
alter function transit.admin_publish_revision(uuid, uuid, text) owner to paranaga_definer;
revoke execute on function transit.admin_publish_revision(uuid, uuid, text) from public;
grant execute on function transit.admin_publish_revision(uuid, uuid, text) to paranaga_app;

-- ---------------------------------------------------------------- new draft (C8)
-- A draft that starts as an exact copy of the published revision's membership. Edits (N5b) add new
-- versions and repoint this membership; published rows are never edited in place.
create or replace function transit.admin_create_draft() returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  v_pub transit.revision%rowtype;
  v_new uuid;
  v_label text;
begin
  perform pg_advisory_xact_lock(hashtext('transit.admin_create_draft'));
  -- Taken second, here only: a publication in progress finishes before its result is copied.
  perform pg_advisory_xact_lock(hashtext('transit.publish_revision'));
  select r.* into v_pub
    from transit.published_pointer pp join transit.revision r on r.id = pp.revision_id
   where pp.singleton;
  if not found then
    raise exception 'no revision is published, so there is nothing to copy' using errcode = '55000';
  end if;
  -- One open draft at a time. A draft made from an older revision does not count: it can never be
  -- published (transit.admin_publish_revision), so it must not block its replacement.
  if exists (select 1 from transit.revision r
              where r.status in ('draft', 'validating') and r.parent_revision_id = v_pub.id) then
    raise exception 'a draft revision is already open; publish or finish it first' using errcode = '55000';
  end if;
  v_label := 'draft-' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD-HH24MISS');
  insert into transit.revision (label, kind, status, created_by, parent_revision_id)
  values (v_label, v_pub.kind, 'draft', v_user, v_pub.id)
  returning id into v_new;
  insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id)
  select v_new, m.entity_kind, m.entity_id, m.version_id
    from transit.revision_member m where m.revision_id = v_pub.id;
  perform core.audit('revision.draft_create', 'transit.revision', v_new::text,
    jsonb_build_object('label', v_label, 'parent_revision_id', v_pub.id));
  return v_new;
end;
$$;
alter function transit.admin_create_draft() owner to paranaga_definer;
revoke execute on function transit.admin_create_draft() from public;
grant execute on function transit.admin_create_draft() to paranaga_app;

-- ---------------------------------------------------------------- the open draft (helper)
-- The newest draft made from the published revision, locked (FOR UPDATE: edits serialize with each
-- other and with publication), with the caller recorded as its last editor.
create or replace function transit.admin_open_draft() returns uuid
  language plpgsql volatile
  set search_path = pg_catalog, transit, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_draft uuid;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select r.id into v_draft from transit.revision r
   where r.status = 'draft'
     and r.parent_revision_id is not distinct from (select pp.revision_id from transit.published_pointer pp where pp.singleton)
   order by r.seq desc limit 1 for update of r;
  if v_draft is null then
    if exists (select 1 from transit.revision r where r.status = 'draft') then
      raise exception 'the open draft was made from an older revision; create a new draft under Revisions first' using errcode = '55000';
    end if;
    raise exception 'no draft revision is open; create one under Revisions first' using errcode = '55000';
  end if;
  update transit.revision set last_edited_by = v_user where id = v_draft;
  return v_draft;
end;
$$;
alter function transit.admin_open_draft() owner to paranaga_definer;
revoke execute on function transit.admin_open_draft() from public;

revoke create on schema transit from paranaga_definer;
