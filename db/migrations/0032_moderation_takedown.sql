-- 0032_moderation_takedown.sql
-- Owner-approved rule (docs/ERD.md C2, §4.6): a moderator can unpublish published content (a post,
-- a comment, a photo) with a reason; the author sees it and can appeal; the reports on it close as
-- 'actioned'. Reports that need nothing close as 'dismissed'. Also ERD C3, C4, part of C5, I1, I2.
-- Runs in one transaction (scripts/migrate.ts). No dependency on 0031.
--
-- 1. taken_down_at (nullable timestamptz) on community.post_version, comment and post_photo, with
--    a CHECK that only a 'rejected' row carries it. It is what tells the author "a moderator took
--    this down" apart from "never published"; the reason and the moderator stay staff-only in
--    community.moderation_decision. No rewrite: three nullable columns on small tables.
-- 2. community.content_target locks the post row before its version or photo, the order
--    community.edit_post and add_post_photos already use (C3: no more deadlock between an author's
--    edit and a moderator's decision).
-- 3. community.apply_content_outcome: rejecting the LIVE item is a take-down. It stamps
--    taken_down_at, clears post.published_version_id (a post version) or the public copy columns
--    (a photo; CHECK post_photo_public requires that). Publishing clears taken_down_at. Nothing
--    else changes for pending content, so community.admin_moderate and admin_resolve_appeal keep
--    their behaviour, and an overturned appeal restores a taken-down item through the same code
--    path as before (a photo is copied again from its private original, which is never removed).
-- 4. community.admin_take_down(type, id, reason_code, note, seen_until): NEW. Moderator or admin (same check
--    as admin_moderate), never your own content, the reason list of a rejection, "other" needs a
--    note. The item must be published right now: 55000 with a plain message when it was already
--    taken down, when a newer version went live, or when it is still waiting. Records a
--    moderation_decision (outcome 'rejected'), closes the open reports on the same post or comment
--    as 'actioned' in the same transaction, audits 'community.take_down' (ids and codes only).
--    seen_until is the newest report the moderator's page showed (admin_report_queue 'lastAt', to
--    the microsecond): a newer open report refuses the call (55000, reload) and only reports up to
--    it are closed, so nobody closes a report they never read. Null closes none.
--    It is a decision about published content, not an answer to Jev: is_override stays false and
--    nothing is audited as 'community.override'; Jev's stored answer is copied to the decision as
--    before. For a photo it returns the public copy (bucket, key) the row no longer points to, so
--    the server can delete that object AFTER the commit; no bucket object is touched here.
-- 5. community.submit_appeal: one appeal per DECISION (was: one per item, ever). A take-down is a
--    new decision, so its author can appeal it even when an earlier rejection of the same item was
--    appealed and overturned. A decision made on an appeal still cannot be appealed. The unique
--    index appeal_target_uq becomes the plain index appeal_target_idx; appeal.decision_id stays
--    unique.
-- 6. community.resolve_report(id, status, seen_until, content_id) REPLACES resolve_report(id,
--    status), which is dropped: no app version before this migration calls it (there was no route).
--    Closes the open reports on the same target together and audits 'community.report_resolve'.
--    seen_until as in 4; content_id is the live content the page showed (the published post
--    version, the comment, null when it was gone): 55000 when it is another one now, so a dismissal
--    never covers an edit the moderator did not read. 'actioned' is accepted only when the content
--    is no longer public (a take-down closes its reports itself; this is for a report that arrived
--    during one). Still refused on your own content.
-- 7. community.admin_report_queue(limit): NEW. Open reports grouped by target with the reported
--    content, the reasons with counts, up to five reporter notes, and the post's public photos.
--    Never a reporter's identity; never reports on the caller's own content.
-- 8. community.toggle_reaction locks the post or comment before counting (C4) and both toggles
--    insert with ON CONFLICT DO NOTHING (C5: a double tap answers instead of failing on 23505).
-- 9. Indexes: reaction_target_idx (I1, the helpful recount) and content_report_open_target_idx
--    (I2: open reports per target in the queues and when closing them).
-- 10. community.report_content: same signature. A rider whose earlier report on the item was closed
--    can report it again (it was restored on appeal, or it got worse): the closed row is reopened
--    with the new reason and note. An open report still answers false, as before.
-- 11. community.moderation_decision.created_at and appeal.created_at default to clock_timestamp()
--    (was now(), the START of the transaction). Both are written under the content row lock, so
--    their order now follows the order of the commits: "the newest decision" in submit_appeal and
--    "an appeal made since the take-down" in the thread cannot be decided by which request began
--    first. Catalog change only.
--
-- lock_timeout 5 s: the ALTERs, the index builds and DROP INDEX wait for running statements; this
-- fails the migration (nothing applied, run it again) instead of queueing every request behind it.
--
-- Order: MIGRATE FIRST, then deploy the code. The app running before this migration keeps working
-- after it: no signature it calls changes (it never called resolve_report), the new columns are
-- ignored, and it cannot create a take-down. The new code does NOT work before the migration: it
-- reads taken_down_at and calls admin_take_down and admin_report_queue (42703 / 42883 until they
-- exist).
--
-- Rolling back the CODE only (the previous app on this schema): that app reads an appeal's state
-- with a scalar subquery without LIMIT (src/server/community/read.ts, appealCol). An item with two
-- appeals makes it fail (21000) and the author cannot open that thread. No such item can exist
-- between this migration and the deploy of the new code (a second appeal needs a take-down, which
-- only the new code can make); it can after the new code has run. Check before a code rollback:
--   select target_type, target_id from community.appeal group by 1, 2 having count(*) > 1;
-- No rows: safe. Rows: fix forward, or ship the previous app with `order by a.created_at desc
-- limit 1` in appealCol. Nothing in the database can hide the older appeal from that query without
-- changing what the author is allowed to read.
--
-- Manual rollback of the schema (owner connection; first deploy the previous app version, see above):
--   1. Every taken-down item needs a decision first, because the old functions leave a rejected
--      item as it is: `select count(*) from community.post_version where taken_down_at is not null`
--      (same for comment and post_photo). Rows may stay rejected; only the column goes.
--   2. begin;
--      grant create on schema community to paranaga_definer;
--      drop function community.admin_take_down(text, uuid, text, text, timestamptz);
--      drop function community.admin_report_queue(integer);
--      drop function community.resolve_report(uuid, text, timestamptz, uuid);
--      -- run again, in this order: content_target, apply_content_outcome and submit_appeal from
--      -- 0025; resolve_report from 0020; report_content, toggle_reaction and toggle_bookmark from
--      -- 0017 (each block: create or replace, owner, revoke, grant).
--      alter table community.moderation_decision alter column created_at set default now();
--      alter table community.appeal alter column created_at set default now();
--      drop index community.reaction_target_idx, community.content_report_open_target_idx, community.appeal_target_idx;
--      -- only when no item has two appeals:
--      create unique index appeal_target_uq on community.appeal (target_type, target_id);
--      alter table community.post_version drop column taken_down_at;
--      alter table community.comment drop column taken_down_at;
--      alter table community.post_photo drop column taken_down_at;
--      revoke create on schema community from paranaga_definer;
--      -- scripts/migrate.ts skips a file that has a row here; without this it never runs again:
--      delete from public.schema_migrations where name = '0032_moderation_takedown.sql';
--      commit;

set local lock_timeout = '5s';

grant create on schema community to paranaga_definer;

-- ================================================================ 1. taken_down_at
alter table community.post_version
  add column taken_down_at timestamptz,
  add constraint post_version_taken_down check (taken_down_at is null or moderation_status = 'rejected');
alter table community.comment
  add column taken_down_at timestamptz,
  add constraint comment_taken_down check (taken_down_at is null or moderation_status = 'rejected');
alter table community.post_photo
  add column taken_down_at timestamptz,
  add constraint post_photo_taken_down check (taken_down_at is null or moderation_status = 'rejected');
-- post_version and comment already give the definer role UPDATE on the whole table (0017);
-- post_photo lists its columns (0025).
grant update (taken_down_at) on community.post_photo to paranaga_definer;

-- ================================================================ 11. commit-order timestamps
alter table community.moderation_decision alter column created_at set default clock_timestamp();
alter table community.appeal alter column created_at set default clock_timestamp();

-- ================================================================ 9. indexes (I1, I2)
create index reaction_target_idx on community.reaction (target_type, target_id);
create index content_report_open_target_idx on community.content_report (target_type, target_id) where status = 'open';

-- ================================================================ 2. lock order (C3)
-- The author and current state of a moderation target (locked), or no values when it is gone.
-- A post version or photo: the post row first, then the item, as edit_post and add_post_photos do.
create or replace function community.content_target(p_type text, p_id uuid, out o_author text, out o_status text, out o_post uuid)
  language plpgsql volatile
  set search_path = pg_catalog, community, pg_temp
as $$
begin
  if p_type = 'comment' then
    select c.author_id, c.moderation_status, c.post_id into o_author, o_status, o_post
      from community.comment c where c.id = p_id and c.deleted_at is null for update;
    return;
  elsif p_type = 'post_version' then
    select v.post_id into o_post from community.post_version v where v.id = p_id;
  elsif p_type = 'photo' then
    select ph.post_id into o_post from community.post_photo ph where ph.id = p_id;
  else
    raise exception 'unknown content type' using errcode = '22023';
  end if;
  perform 1 from community.post p where p.id = o_post and p.deleted_at is null for update;
  if not found then
    o_post := null;
    return;
  end if;
  if p_type = 'post_version' then
    select v.author_id, v.moderation_status into o_author, o_status
      from community.post_version v where v.id = p_id for update;
  else
    select ph.author_id, ph.moderation_status into o_author, o_status
      from community.post_photo ph where ph.id = p_id for update;
  end if;
end;
$$;
alter function community.content_target(text, uuid) owner to paranaga_definer;
revoke execute on function community.content_target(text, uuid) from public;

-- ================================================================ 3. outcomes
-- Applies an outcome to a target already locked by content_target. A post version is published
-- only while no newer version is live or waiting (that edit is reviewed on its own). A newer
-- version that was rejected or superseded does not count: the appeal of a take-down can still be
-- overturned after the author's later edit was turned down. Rejecting the
-- live item takes it down: the post loses its live version, a photo its public copy columns.
-- For a photo, publishing records the public copy (bucket + key the server copies to) and returns
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
                  where n.post_id = v_post and n.n > (select v.n from community.post_version v where v.id = p_id)
                    and n.moderation_status in ('pending', 'human_review', 'published')) then
        raise exception 'the author has edited this post since; review the newer version' using errcode = '55000';
      end if;
      update community.post_version set moderation_status = 'superseded' where post_id = v_post and moderation_status = 'published';
    end if;
    update community.post_version
       set taken_down_at = case when p_outcome = 'rejected' and moderation_status = 'published' then now() end,
           moderation_status = p_outcome, moderation_reason = left(p_reason, 60), decided_at = now()
     where id = p_id;
    if p_outcome = 'published' then
      update community.post set published_version_id = p_id, updated_at = now() where id = v_post;
    else
      update community.post set published_version_id = null, updated_at = now() where id = v_post and published_version_id = p_id;
    end if;
    return null;
  elsif p_type = 'comment' then
    update community.comment
       set taken_down_at = case when p_outcome = 'rejected' and moderation_status = 'published' then now() end,
           moderation_status = p_outcome, moderation_reason = left(p_reason, 60), decided_at = now()
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
       set moderation_status = 'published', public_bucket = p_public_bucket, public_key = v_media.object_key,
           taken_down_at = null, decided_at = now()
     where id = p_id;
    return jsonb_build_object('sourceBucket', v_media.bucket, 'key', v_media.object_key, 'mime', v_media.mime,
                              'publicBucket', p_public_bucket);
  end if;
  update community.post_photo
     set taken_down_at = case when moderation_status = 'published' then now() end,
         moderation_status = 'rejected', public_bucket = null, public_key = null, decided_at = now()
   where id = p_id;
  return null;
end;
$$;
alter function community.apply_content_outcome(text, uuid, text, text, text) owner to paranaga_definer;
revoke execute on function community.apply_content_outcome(text, uuid, text, text, text) from public;

-- ================================================================ 4. take-down
-- Reason codes mirrored in src/domain/admin/moderation.ts (REJECT_REASONS).
create or replace function community.admin_take_down(p_target_type text, p_target_id uuid, p_reason_code text, p_note text,
                                                     p_seen_until timestamptz)
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
  v_removed jsonb;
  v_decision uuid;
  v_reports integer;
  -- Reports name the post or the comment: a post version or a photo closes the reports on its post.
  v_rtype text := case when p_target_type = 'comment' then 'comment' else 'post' end;
  v_rid uuid;
begin
  if p_reason_code is null or p_reason_code not in (
       'spam', 'harassment', 'threat', 'personal_info', 'driver_allegation', 'off_topic', 'misleading', 'unsafe_photo', 'other') then
    raise exception 'choose a reason for taking this down' using errcode = '22023';
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
  if t.o_status = 'rejected' then
    raise exception 'this item is already unpublished; reload' using errcode = '55000';
  elsif t.o_status = 'superseded' then
    raise exception 'a newer version of this post is live now; reload' using errcode = '55000';
  elsif t.o_status <> 'published' then
    raise exception 'this item is not published; decide it in the review queue' using errcode = '55000';
  end if;
  v_rid := case when p_target_type = 'comment' then p_target_id else t.o_post end;
  if exists (select 1 from community.content_report r
              where r.status = 'open' and r.target_type = v_rtype and r.target_id = v_rid and r.created_at > p_seen_until) then
    raise exception 'a new report came in on this item; reload and read it first' using errcode = '55000';
  end if;
  if p_target_type = 'photo' then
    select jsonb_build_object('bucket', ph.public_bucket, 'key', ph.public_key) into v_removed
      from community.post_photo ph where ph.id = p_target_id;
  end if;
  select * into j from community.jev_evidence e where e.target_type = p_target_type and e.target_id = p_target_id;
  perform community.apply_content_outcome(p_target_type, p_target_id, 'rejected', p_reason_code, null);
  insert into community.moderation_decision (target_type, target_id, author_id, outcome, decided_by, decider_role,
                                             reason_code, note, jev_recommendation, jev_confidence, is_override)
  values (p_target_type, p_target_id, t.o_author, 'rejected', v_user, v_role, p_reason_code, v_note,
          j.recommendation, j.confidence, false)
  returning id into v_decision;
  -- Only what the moderator read: a report filed since the check above stays open.
  update community.content_report r
     set status = 'actioned', resolved_by = v_user, resolved_at = now()
   where r.status = 'open' and r.target_type = v_rtype and r.target_id = v_rid and r.created_at <= p_seen_until;
  get diagnostics v_reports = row_count;
  perform core.audit('community.take_down', 'community.' || p_target_type, p_target_id::text,
    jsonb_build_object('decision_id', v_decision, 'reason_code', p_reason_code, 'post_id', t.o_post,
                       'reports_closed', v_reports, 'jev_recommendation', j.recommendation, 'jev_confidence', j.confidence));
  return jsonb_build_object('decisionId', v_decision, 'isOverride', false, 'reportsClosed', v_reports, 'removed', v_removed);
end;
$$;
alter function community.admin_take_down(text, uuid, text, text, timestamptz) owner to paranaga_definer;
revoke execute on function community.admin_take_down(text, uuid, text, text, timestamptz) from public;
grant execute on function community.admin_take_down(text, uuid, text, text, timestamptz) to paranaga_app;

-- ================================================================ 5. appeals: one per decision
drop index community.appeal_target_uq;
create index appeal_target_idx on community.appeal (target_type, target_id, created_at desc);

-- One appeal per decision, by the author of rejected content. A Jev auto-reject has no decision
-- row yet: it is recorded here as the policy's decision (decided_by 'policy'). The newest decision
-- is the one appealed; once it carries an appeal (as the appealed decision or as the answer to an
-- appeal) it is final. content_target holds the row lock, so two requests cannot both pass.
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
  elsif v_decision.appeal_id is not null then
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

-- ================================================================ 6. reports: resolve
-- Closes the open reports on the same target as p_id that the moderator's page showed (created up
-- to p_seen_until). 'dismissed': nothing was needed. 'actioned': only for content that is no
-- longer public (admin_take_down closes its reports itself; this covers a report that was filed
-- while the take-down ran). 55000 when a newer report came in, or when the live content is not
-- p_content_id any more (an approved edit, a take-down, a delete). False when the report does not
-- exist or was already closed.
drop function community.resolve_report(uuid, text);
create or replace function community.resolve_report(p_id uuid, p_status text, p_seen_until timestamptz, p_content_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_actor text := community.assert_moderator();
  v_type text;
  v_target uuid;
  v_author text;
  v_live uuid;
  v_count integer;
begin
  if p_status is null or p_status not in ('actioned', 'dismissed') or p_seen_until is null then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select r.target_type, r.target_id into v_type, v_target
    from community.content_report r where r.id = p_id and r.status = 'open';
  if not found then
    return false;
  end if;
  -- The content row is locked, so a take-down or an approved edit of it cannot run in between.
  -- v_live: what the public sees now, as admin_report_queue names it ('contentId').
  if v_type = 'post' then
    select p.author_id, case when p.deleted_at is null then p.published_version_id end into v_author, v_live
      from community.post p where p.id = v_target for update;
  else
    select c.author_id, case when c.deleted_at is null and c.moderation_status = 'published' then c.id end into v_author, v_live
      from community.comment c where c.id = v_target for update;
  end if;
  if v_author = v_actor then
    raise exception 'you cannot moderate your own content' using errcode = '42501';
  end if;
  if v_live is distinct from p_content_id then
    raise exception 'this content changed since you loaded the page; reload' using errcode = '55000';
  end if;
  if p_status = 'actioned' and v_live is not null then
    raise exception 'this content is still public; take it down, or dismiss the reports' using errcode = '55000';
  end if;
  if exists (select 1 from community.content_report r
              where r.target_type = v_type and r.target_id = v_target and r.status = 'open' and r.created_at > p_seen_until) then
    raise exception 'a new report came in on this item; reload and read it first' using errcode = '55000';
  end if;
  update community.content_report r
     set status = p_status, resolved_by = v_actor, resolved_at = now()
   where r.target_type = v_type and r.target_id = v_target and r.status = 'open' and r.created_at <= p_seen_until;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform core.audit('community.report_resolve', 'community.' || v_type, v_target::text,
      jsonb_build_object('status', p_status, 'reports_closed', v_count));
  end if;
  return v_count > 0;
end;
$$;
alter function community.resolve_report(uuid, text, timestamptz, uuid) owner to paranaga_definer;
revoke execute on function community.resolve_report(uuid, text, timestamptz, uuid) from public;
grant execute on function community.resolve_report(uuid, text, timestamptz, uuid) to paranaga_app;

-- ================================================================ 10. reports: report again
-- Report content: one row per reporter and target, never your own, only content that is public.
-- A closed report is reopened as a new one (reason, note, time); an open one answers false.
-- created_at is the clock, not the start of the transaction: it is what seen_until is compared to.
create or replace function community.report_content(p_target_type text, p_target_id uuid, p_reason text, p_note text)
returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_author text;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target_type = 'post' then
    select p.author_id into v_author from community.post p
     where p.id = p_target_id and p.deleted_at is null and p.published_version_id is not null;
  elsif p_target_type = 'comment' then
    select c.author_id into v_author from community.comment c
     where c.id = p_target_id and c.deleted_at is null and c.moderation_status = 'published';
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_user then
    raise exception 'own content' using errcode = '22023';
  end if;
  insert into community.content_report as r (reporter_id, target_type, target_id, reason, note, created_at)
  values (v_user, p_target_type, p_target_id, p_reason, p_note, clock_timestamp())
  on conflict (reporter_id, target_type, target_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = excluded.created_at,
        status = 'open', resolved_by = null, resolved_at = null
    where r.status <> 'open';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.report_content(text, uuid, text, text) owner to paranaga_definer;
revoke execute on function community.report_content(text, uuid, text, text) from public;
grant execute on function community.report_content(text, uuid, text, text) to paranaga_app;

-- ================================================================ 7. reports: queue
-- Open reports grouped by what they are about, oldest first. No reporter id leaves this function.
-- state: 'published' (can be taken down), 'taken_down' or 'deleted' (only closing is left).
create or replace function community.admin_report_queue(p_limit integer default 100) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := community.assert_moderator();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  return coalesce((
    select jsonb_agg(q.j order by q.first_at)
      from (
        select g.first_at, jsonb_build_object(
                 'reportId', (select r.id from community.content_report r
                               where r.target_type = g.target_type and r.target_id = g.target_id and r.status = 'open'
                               order by r.created_at, r.id limit 1),
                 'targetType', g.target_type, 'targetId', g.target_id, 'postId', t.post_id, 'state', t.state,
                 'count', g.n, 'reasons', g.reasons, 'firstAt', g.first_at, 'lastAt', g.last_at,
                 'notes', coalesce((select jsonb_agg(n.note)
                                      from (select r.note from community.content_report r
                                             where r.target_type = g.target_type and r.target_id = g.target_id
                                               and r.status = 'open' and r.note is not null
                                             order by r.created_at desc limit 5) n), '[]'::jsonb),
                 'contentKind', case when g.target_type = 'post' then 'post_version' else 'comment' end,
                 'contentId', t.content_id, 'title', t.title, 'body', t.body,
                 'authorHandle', community.handle(t.author_id),
                 'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'mediaId', ph.media_object_id) order by ph.position)
                                       from community.post_photo ph
                                      where g.target_type = 'post' and t.state = 'published'
                                        and ph.post_id = t.post_id and ph.moderation_status = 'published'), '[]'::jsonb)) as j
          from (
            select x.target_type, x.target_id, sum(x.n)::int as n, min(x.first_at) as first_at, max(x.last_at) as last_at,
                   jsonb_object_agg(x.reason, x.n) as reasons
              from (select r.target_type, r.target_id, r.reason, count(*)::int as n,
                           min(r.created_at) as first_at, max(r.created_at) as last_at
                      from community.content_report r
                     where r.status = 'open'
                     group by r.target_type, r.target_id, r.reason) x
             group by x.target_type, x.target_id) g
          join lateral (
            select p.id as post_id, p.author_id,
                   case when p.deleted_at is not null then 'deleted'
                        when p.published_version_id is null then 'taken_down' else 'published' end as state,
                   v.id as content_id, v.title, v.body
              from community.post p
              left join community.post_version v on v.id = p.published_version_id and p.deleted_at is null
             where g.target_type = 'post' and p.id = g.target_id
            union all
            select c.post_id, c.author_id,
                   case when c.deleted_at is not null then 'deleted'
                        when c.moderation_status <> 'published' then 'taken_down' else 'published' end,
                   case when c.deleted_at is null and c.moderation_status = 'published' then c.id end, null,
                   case when c.deleted_at is null and c.moderation_status = 'published' then c.body end
              from community.comment c
             where g.target_type = 'comment' and c.id = g.target_id) t on t.author_id <> v_user
         order by g.first_at
         limit v_limit) q), '[]'::jsonb);
end;
$$;
alter function community.admin_report_queue(integer) owner to paranaga_definer;
revoke execute on function community.admin_report_queue(integer) from public;
grant execute on function community.admin_report_queue(integer) to paranaga_app;

-- ================================================================ 8. toggles (C4, C5)
-- Helpful reaction: one per user and target, toggled. Only published, live content, never your
-- own. The post or comment row is locked first, so two riders tapping at once count one after the
-- other (the recount then sees both reactions).
create or replace function community.toggle_reaction(p_target_type text, p_target_id uuid)
returns table (active boolean, helpful_count integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
  v_author text;
  v_count integer;
  v_active boolean;
  v_had boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Read before the lock: a double tap or an overlapping retry means the same change once (C5),
  -- not on and off again.
  v_had := exists (select 1 from community.reaction r
                    where r.user_id = v_user and r.target_type = p_target_type and r.target_id = p_target_id);
  if p_target_type = 'post' then
    select p.author_id into v_author from community.post p
     where p.id = p_target_id and p.deleted_at is null and p.published_version_id is not null
       for no key update;
  elsif p_target_type = 'comment' then
    select c.author_id into v_author from community.comment c
     where c.id = p_target_id and c.deleted_at is null and c.moderation_status = 'published'
       for no key update;
  else
    raise exception 'invalid target' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_user then
    raise exception 'own content' using errcode = '22023';
  end if;

  if v_had then
    delete from community.reaction r where r.user_id = v_user and r.target_type = p_target_type and r.target_id = p_target_id;
    v_active := false;
  else
    insert into community.reaction (user_id, target_type, target_id) values (v_user, p_target_type, p_target_id)
    on conflict (user_id, target_type, target_id) do nothing;
    v_active := true;
  end if;

  if p_target_type = 'post' then
    update community.post p set helpful_count = (select count(*) from community.reaction r
                                                  where r.target_type = 'post' and r.target_id = p_target_id)
     where p.id = p_target_id returning p.helpful_count into v_count;
  else
    update community.comment c set helpful_count = (select count(*) from community.reaction r
                                                     where r.target_type = 'comment' and r.target_id = p_target_id)
     where c.id = p_target_id returning c.helpful_count into v_count;
  end if;
  return query select v_active, v_count;
end;
$$;
alter function community.toggle_reaction(text, uuid) owner to paranaga_definer;
revoke execute on function community.toggle_reaction(text, uuid) from public;
grant execute on function community.toggle_reaction(text, uuid) to paranaga_app;

create or replace function community.toggle_bookmark(p_post_id uuid) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from community.bookmark b where b.user_id = v_user and b.post_id = p_post_id;
  if found then
    return false;
  end if;
  if not exists (select 1 from community.post p
                  where p.id = p_post_id and p.deleted_at is null and p.published_version_id is not null) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into community.bookmark (user_id, post_id) values (v_user, p_post_id)
  on conflict (user_id, post_id) do nothing;
  return true;
end;
$$;
alter function community.toggle_bookmark(uuid) owner to paranaga_definer;
revoke execute on function community.toggle_bookmark(uuid) from public;
grant execute on function community.toggle_bookmark(uuid) to paranaga_app;

revoke create on schema community from paranaga_definer;
