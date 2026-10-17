-- 0019_mynaga_handoff.sql
-- Increment B, Task B9: MyNaga handoff (S20, F-D5). Spec: 04-data-model §4.8 (priv.external_handoff),
-- 02-features F-D5, 05-security §5.3.
--   - priv.external_handoff: what the REPORTER says they did in the official MyNaga app, one row per
--     driver report. It is self-reported: ParaNaga sends nothing to MyNaga or City Hall and cannot
--     confirm receipt, and this table is never treated as ParaNaga's own status.
--   - priv.set_mynaga_handoff(...): the only way to write it (definer, owner only).
--
-- Access model (same as 0018):
--   - Forced RLS. paranaga_app reads ONLY the row of a report whose reporter_id is the caller
--     (core.current_user_id()); guests (NULL) match nothing. No INSERT/UPDATE/DELETE grant.
--   - No policy or grant names community_moderator, transport_reviewer, complaint_reviewer or
--     admin, and no reviewer function in 0018 reads this table: the reference is never visible to
--     anyone but the reporter.
--   - The reference is never written to the audit log and never leaves the database except back to
--     its owner.
-- Not applied by this branch: apply it with the other migrations at release time.

grant create on schema priv to paranaga_definer;

create table priv.external_handoff (
  complaint_id            uuid primary key references priv.complaint (id) on delete cascade,
  target                  text not null default 'mynaga' check (target = 'mynaga'),
  submitted_externally_at timestamptz,
  self_reported_reference text check (self_reported_reference is null or char_length(self_reported_reference) between 1 and 64),
  updated_at              timestamptz not null default now(),
  -- A reference only makes sense once the reporter said they submitted.
  check (self_reported_reference is null or submitted_externally_at is not null)
);

grant select (complaint_id, target, submitted_externally_at, self_reported_reference, updated_at)
  on priv.external_handoff to paranaga_app;
grant select, insert, update on priv.external_handoff to paranaga_definer;

alter table priv.external_handoff enable row level security;
alter table priv.external_handoff force row level security;

create policy external_handoff_owner_read on priv.external_handoff for select to paranaga_app
  using (exists (
    select 1 from priv.complaint c
     where c.id = complaint_id and c.reporter_id = (select core.current_user_id())));
create policy external_handoff_definer on priv.external_handoff for all to paranaga_definer
  using (true) with check (true);

-- p_submitted true: "I submitted it in MyNaga", with an optional reference (trimmed, 1 to 64
-- characters, no control characters). p_submitted false: take it back (the reference is cleared).
-- Returns no row when the report is not the caller's (the API answers 404 either way).
create or replace function priv.set_mynaga_handoff(
  p_complaint_id uuid,
  p_submitted boolean,
  p_reference text default null
) returns table (
  submitted boolean,
  submitted_at timestamptz,
  reference text
)
  language plpgsql volatile security definer
  set search_path = pg_catalog, priv, core, pg_temp
as $$
declare
  v_user_id text := core.current_user_id();
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_row priv.external_handoff%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_submitted is null then
    raise exception 'invalid handoff' using errcode = '22023';
  end if;
  if not exists (select 1 from priv.complaint c where c.id = p_complaint_id and c.reporter_id = v_user_id) then
    return;
  end if;
  if not p_submitted then
    v_ref := null;
  end if;
  if v_ref is not null and (char_length(v_ref) > 64 or v_ref ~ '[[:cntrl:]]') then
    raise exception 'invalid reference' using errcode = '22023';
  end if;

  insert into priv.external_handoff as h (complaint_id, submitted_externally_at, self_reported_reference, updated_at)
  values (p_complaint_id, case when p_submitted then now() end, v_ref, now())
  on conflict (complaint_id) do update
     set submitted_externally_at = case
           when p_submitted then coalesce(h.submitted_externally_at, now())
           else null end,
         self_reported_reference = excluded.self_reported_reference,
         updated_at = now()
  returning * into v_row;

  -- Audit without the reference or any report text (spec §5.9).
  perform core.audit('complaint.handoff', 'complaint', p_complaint_id::text, jsonb_build_object('submitted', p_submitted));

  return query select (v_row.submitted_externally_at is not null), v_row.submitted_externally_at, v_row.self_reported_reference;
end;
$$;
alter function priv.set_mynaga_handoff(uuid, boolean, text) owner to paranaga_definer;
revoke execute on function priv.set_mynaga_handoff(uuid, boolean, text) from public;
grant execute on function priv.set_mynaga_handoff(uuid, boolean, text) to paranaga_app;

revoke create on schema priv from paranaga_definer;
