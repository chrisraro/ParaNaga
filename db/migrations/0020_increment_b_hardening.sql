-- 0020_increment_b_hardening.sql
-- Increment B, Task B10 (final review). Fixes found while reviewing 0016-0019; those files are
-- left untouched so their checksums stay stable on any branch that already applied them.
--   1. 0016 and 0017 granted CREATE on schema community to paranaga_definer (needed for
--      ALTER FUNCTION … OWNER TO) but never revoked it, unlike 0000/0012/0014/0015/0018/0019.
--      The definer role must not be able to create objects at runtime.
--   2. Nobody moderates their own content (0017 header, spec §5.3): content_review_queue and
--      set_content_status already refuse the moderator's own posts and comments, but
--      report_queue and resolve_report did not, so a moderator could dismiss reports filed
--      against their own post or comment. Both now skip/refuse reports whose target the caller
--      authored. Signatures, owners and grants are unchanged (CREATE OR REPLACE keeps them).

grant create on schema community to paranaga_definer;

create or replace function community.report_queue(p_limit integer default 50)
returns table (id uuid, target_type text, target_id uuid, reason text, note text, created_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
begin
  if core.current_user_id() is null
     or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at
    from community.content_report r
   where r.status = 'open'
     and not exists (select 1 from community.post p
                      where r.target_type = 'post' and p.id = r.target_id
                        and p.author_id = core.current_user_id())
     and not exists (select 1 from community.comment c
                      where r.target_type = 'comment' and c.id = r.target_id
                        and c.author_id = core.current_user_id())
   order by r.created_at
   limit least(greatest(p_limit, 1), 200);
end;
$$;
alter function community.report_queue(integer) owner to paranaga_definer;
revoke execute on function community.report_queue(integer) from public;
grant execute on function community.report_queue(integer) to paranaga_app;

create or replace function community.resolve_report(p_id uuid, p_status text) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, community, core, pg_temp
as $$
declare
  v_actor text := core.current_user_id();
  v_type text;
  v_target uuid;
  v_author text;
  v_count integer;
begin
  if v_actor is null
     or not (core.has_role('community_moderator') or core.has_role('admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select r.target_type, r.target_id into v_type, v_target
    from community.content_report r where r.id = p_id for update;
  if not found then
    return false;
  end if;
  if v_type = 'post' then
    select p.author_id into v_author from community.post p where p.id = v_target;
  else
    select c.author_id into v_author from community.comment c where c.id = v_target;
  end if;
  if v_author = v_actor then
    raise exception 'forbidden: own content' using errcode = '42501';
  end if;
  update community.content_report r
     set status = p_status, resolved_by = v_actor, resolved_at = now()
   where r.id = p_id and r.status = 'open';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
alter function community.resolve_report(uuid, text) owner to paranaga_definer;
revoke execute on function community.resolve_report(uuid, text) from public;
grant execute on function community.resolve_report(uuid, text) to paranaga_app;

revoke create on schema community from paranaga_definer;
