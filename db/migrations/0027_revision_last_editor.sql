-- 0027_revision_last_editor.sql
-- Audit fix (database I2; docs/spec/05-security.md §5.3): the optional two-person publish rule
-- (ops.feature_flag publish_requires_second_reviewer) compared the publisher with the draft's
-- CREATOR, so a second reviewer could make every edit and then publish it alone. The spec asks
-- for the revision's LAST EDITOR. Additive only:
--   - transit.revision.last_edited_by (text, null until the first edit). Only the definer may
--     write it (column grant); the existing definer_publish policy (0001) covers the update, so
--     row-level security is unchanged.
--   - transit.admin_open_draft() (0024 helper, same signature, owner and grants): every draft
--     edit reaches the open draft through it (0024 stop actions via admin_draft_stop, the
--     reconciliation and the import commit; 0025 correction review), so it records the caller as
--     the last editor, under the same FOR UPDATE lock. No user in the request: refused.
--   - transit.admin_publish_revision (0023, same signature, owner and grants): with the flag on,
--     refuses when the publisher is coalesce(last_edited_by, created_by): the last editor, or the
--     creator of a draft nobody edited. Everything else is unchanged.
-- Drafts written by the offline import role (paranaga_import) do not go through these functions;
-- their last_edited_by stays as it was, and the rule falls back to the creator as before.

grant create on schema transit to paranaga_definer;

alter table transit.revision add column last_edited_by text;
grant update (last_edited_by) on transit.revision to paranaga_definer;

-- ---------------------------------------------------------------- the open draft (helper)
-- The one open draft, locked (FOR UPDATE: edits serialize with each other and with publication),
-- with the caller recorded as its last editor.
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
  select r.id into v_draft from transit.revision r where r.status = 'draft' order by r.seq desc limit 1 for update;
  if v_draft is null then
    raise exception 'no draft revision is open; create one under Revisions first' using errcode = '55000';
  end if;
  update transit.revision set last_edited_by = v_user where id = v_draft;
  return v_draft;
end;
$$;
alter function transit.admin_open_draft() owner to paranaga_definer;
revoke execute on function transit.admin_open_draft() from public;

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

revoke create on schema transit from paranaga_definer;
