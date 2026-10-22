-- 0023_admin_revisions.sql
-- N5a (docs/spec/07-delivery.md §7.11): admin console C1 (dashboard) and C8 (revisions + publication).
-- Additive only. The app (paranaga_app) reaches the admin data through these SECURITY DEFINER
-- functions alone; each one checks the caller's role in the database (admin or transport_reviewer,
-- core.has_role, which already honours suspensions), whatever the server checked before:
--   - transit.admin_dashboard(): read-only counts (published revision, drafts, candidate stops,
--     open corrections, last import batch).
--   - transit.admin_revisions(limit): the revision list with member counts and the last validation.
--   - transit.admin_create_draft(): a new draft revision that copies the published revision's
--     membership (the base every later edit works on). One open draft at a time. Audited.
--   - transit.admin_validation_facts(revision): what publication validation needs (members with
--     their synthetic flag, stop and terminal coordinates, variants, stop order, shapes), plus a
--     DRY RUN of transit.publish_revision inside a subtransaction that is always rolled back, so
--     the report carries the database's own structural checks. Nothing it does survives.
--   - transit.admin_record_validation(revision, membership hash, report): stores the server's
--     report on the revision, bound to a hash of the membership it was computed on. Audited.
--   - transit.admin_publish_revision(revision, expected published, mode): publish ('publish', a
--     draft) or roll back ('rollback', a superseded revision). Requires a fresh step-up
--     (priv.require_step_up, N3), a recorded validation without errors on the CURRENT membership
--     and under 30 minutes old, the pointer the caller saw (no double publish on a retry or a stale
--     page), and the optional two-person rule (ops.feature_flag publish_requires_second_reviewer).
--     Then calls transit.publish_revision (0010), which re-runs every hard check, moves the
--     pointer and writes the revision.publish / revision.rollback audit row, in the same
--     transaction.
--   - transit.admin_coverage(revision): the barangay coverage audit rows of a revision.
-- Grants AND row-level-security policies are given to paranaga_definer for every table these
-- functions touch that it could not reach yet (0014 forgot them once; 0021 fixed that):
--   ingest.batch (schema usage + select), ops.feature_flag (select), transit.revision (insert of
--   a draft, update of validation_report), transit.revision_member (insert into a draft only).
-- Everything else they read already has a definer grant and a definer_read policy (0001, 0003,
-- 0006, 0007, 0010, 0016), and core.audit_event has audit_insert_definer (0000).

grant create on schema transit to paranaga_definer;

-- ---------------------------------------------------------------- definer reach
grant usage on schema ingest to paranaga_definer;
grant select on ingest.batch to paranaga_definer;
create policy batch_definer_read on ingest.batch for select to paranaga_definer using (true);

grant select on ops.feature_flag to paranaga_definer;
create policy feature_flag_definer_read on ops.feature_flag for select to paranaga_definer using (true);

-- transit.revision already has select (0001) and the definer_publish policy (for all).
grant insert (label, kind, status, created_by, parent_revision_id) on transit.revision to paranaga_definer;
grant update (validation_report) on transit.revision to paranaga_definer;

-- transit.revision_member: select + definer_read exist (0001); a draft's membership is the only write.
grant insert on transit.revision_member to paranaga_definer;
create policy definer_insert_draft on transit.revision_member for insert to paranaga_definer
  with check (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'));

-- ---------------------------------------------------------------- helpers (not callable by the app)
-- Raises 42501 'forbidden' unless the request's user is an admin or a transport reviewer; returns
-- the user id. Invoker rights: only the definer functions below call it.
create or replace function transit.admin_assert_staff() returns text
  language plpgsql stable
  set search_path = pg_catalog, core, pg_temp
as $$
declare
  v_user text := core.current_user_id();
begin
  if v_user is null or not (core.has_role('admin') or core.has_role('transport_reviewer')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
alter function transit.admin_assert_staff() owner to paranaga_definer;
revoke execute on function transit.admin_assert_staff() from public;

-- sha256 over the revision's membership (kind, entity, version), in a fixed order.
create or replace function transit.revision_membership_hash(p_revision uuid) returns text
  language sql stable
  set search_path = pg_catalog, transit, pg_temp
as $$
  select encode(sha256(convert_to(coalesce(string_agg(m.entity_kind || ':' || m.entity_id || ':' || m.version_id, ','
           order by m.entity_kind, m.entity_id), ''), 'UTF8')), 'hex')
    from transit.revision_member m
   where m.revision_id = p_revision
$$;
alter function transit.revision_membership_hash(uuid) owner to paranaga_definer;
revoke execute on function transit.revision_membership_hash(uuid) from public;

-- ---------------------------------------------------------------- dashboard (C1)
create or replace function transit.admin_dashboard() returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, transit, core, community, ingest, pg_temp
as $$
declare
  v_pub uuid;
begin
  perform transit.admin_assert_staff();
  select pp.revision_id into v_pub from transit.published_pointer pp where pp.singleton;
  return jsonb_build_object(
    'published', (
      select jsonb_build_object('id', r.id, 'seq', r.seq, 'label', r.label, 'kind', r.kind, 'publishedAt', r.published_at)
        from transit.revision r where r.id = v_pub),
    'drafts', (select count(*) from transit.revision r where r.status in ('draft', 'validating')),
    'latestDraft', (
      select jsonb_build_object('id', r.id, 'label', r.label, 'createdAt', r.created_at,
               'validationOk', r.validation_report -> 'ok', 'validatedAt', r.validation_report -> 'validatedAt',
               'validationCurrent', (r.validation_report ->> 'membershipHash') = transit.revision_membership_hash(r.id))
        from transit.revision r where r.status in ('draft', 'validating')
       order by r.seq desc limit 1),
    'stopsTotal', (
      select count(*) from transit.revision_member m
       where m.revision_id = v_pub and m.entity_kind = 'stop_point'),
    'stopCandidates', (
      select count(*) from transit.revision_member m
        join transit.stop_point_version v on v.id = m.version_id
       where m.revision_id = v_pub and m.entity_kind = 'stop_point' and v.status in ('candidate', 'documentary')),
    'openCorrections', (
      select count(*) from community.correction c where c.status in ('submitted', 'under_review', 'needs_evidence')),
    'lastImport', (
      select jsonb_build_object('snapshotVersion', b.snapshot_version, 'mode', b.mode, 'status', b.status,
               'startedAt', b.started_at, 'finishedAt', b.finished_at)
        from ingest.batch b order by b.started_at desc limit 1));
end;
$$;
alter function transit.admin_dashboard() owner to paranaga_definer;
revoke execute on function transit.admin_dashboard() from public;
grant execute on function transit.admin_dashboard() to paranaga_app;

-- ---------------------------------------------------------------- revisions (C8)
create or replace function transit.admin_revisions(p_limit integer default 50)
returns table (
  id uuid, seq bigint, label text, kind text, status text, created_at timestamptz, published_at timestamptz,
  parent_revision_id uuid, is_synthetic boolean, member_count bigint, is_published boolean,
  validation_ok boolean, validated_at text, validation_errors integer, validation_warnings integer,
  validation_current boolean
)
  language plpgsql stable security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
begin
  perform transit.admin_assert_staff();
  return query
  select r.id, r.seq, r.label, r.kind, r.status, r.created_at, r.published_at, r.parent_revision_id, r.is_synthetic,
         (select count(*) from transit.revision_member m where m.revision_id = r.id),
         exists (select 1 from transit.published_pointer pp where pp.singleton and pp.revision_id = r.id),
         (r.validation_report ->> 'ok')::boolean,
         r.validation_report ->> 'validatedAt',
         (r.validation_report ->> 'errorCount')::integer,
         (r.validation_report ->> 'warningCount')::integer,
         case when r.validation_report is null then null
              else (r.validation_report ->> 'membershipHash') = transit.revision_membership_hash(r.id) end
    from transit.revision r
   order by r.seq desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
alter function transit.admin_revisions(integer) owner to paranaga_definer;
revoke execute on function transit.admin_revisions(integer) from public;
grant execute on function transit.admin_revisions(integer) to paranaga_app;

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
  if exists (select 1 from transit.revision r where r.status in ('draft', 'validating')) then
    raise exception 'a draft revision is already open; publish or finish it first' using errcode = '55000';
  end if;
  select r.* into v_pub
    from transit.published_pointer pp join transit.revision r on r.id = pp.revision_id
   where pp.singleton;
  if not found then
    raise exception 'no revision is published, so there is nothing to copy' using errcode = '55000';
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

-- ---------------------------------------------------------------- validation (C8, F-E11)
create or replace function transit.admin_validation_facts(p_revision uuid) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_rev transit.revision%rowtype;
  v_check jsonb;
begin
  perform transit.admin_assert_staff();
  select * into v_rev from transit.revision r where r.id = p_revision;
  if not found then
    raise exception 'unknown revision' using errcode = '22023';
  end if;

  -- Dry run: transit.publish_revision's own checks, rolled back whatever happens (the inner block
  -- is a subtransaction; the sentinel exception undoes a run that passed).
  begin
    perform transit.publish_revision(p_revision);
    raise exception 'paranaga:dry-run' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'paranaga:dry-run' then
        v_check := jsonb_build_object('ok', true);
      else
        v_check := jsonb_build_object('ok', false, 'code', sqlstate, 'message', left(sqlerrm, 500));
      end if;
    when sqlstate '23514' or sqlstate '22023' then
      v_check := jsonb_build_object('ok', false, 'code', sqlstate, 'message', left(sqlerrm, 500));
  end;

  return jsonb_build_object(
    'revision', jsonb_build_object('id', v_rev.id, 'label', v_rev.label, 'kind', v_rev.kind,
                  'status', v_rev.status, 'isSynthetic', v_rev.is_synthetic),
    'membershipHash', transit.revision_membership_hash(p_revision),
    'dbCheck', v_check,
    -- Every member with a readable code and its synthetic flag (stable row OR version row);
    -- null when the member's row is missing. Same cases as transit.publish_revision (0010).
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'code', x.code, 'isSynthetic', x.syn) order by x.kind, x.code)
        from (
          select m.entity_kind as kind,
                 coalesce(case m.entity_kind
                   when 'route' then (select r.public_code from transit.route r where r.id = m.entity_id)
                   when 'variant' then (
                     select r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end
                       from transit.variant v join transit.route r on r.id = v.route_id where v.id = m.entity_id)
                   when 'stop_point' then (
                     select coalesce(spv.source_layer || ' ' || spv.source_code_raw, sp.name)
                       from transit.stop_point_version spv join transit.stop_point sp on sp.id = spv.stop_point_id
                      where spv.id = m.version_id)
                   when 'fare_rule' then (select f.code from transit.fare_rule f where f.id = m.entity_id)
                   when 'terminal' then (select t.code from transit.terminal t where t.id = m.entity_id)
                   when 'barangay' then (select b.name from transit.barangay b where b.id = m.entity_id)
                   when 'route_note' then (select n.note_code from transit.route_note n where n.id = m.entity_id)
                 end, m.entity_id::text) as code,
                 (case m.entity_kind
                   when 'variant' then (
                     select v.is_synthetic or vv.is_synthetic
                       from transit.variant_version vv join transit.variant v on v.id = vv.variant_id
                      where vv.id = m.version_id and vv.variant_id = m.entity_id)
                   when 'stop_point' then (
                     select sp.is_synthetic or spv.is_synthetic
                       from transit.stop_point_version spv join transit.stop_point sp on sp.id = spv.stop_point_id
                      where spv.id = m.version_id and spv.stop_point_id = m.entity_id)
                   when 'place' then (
                     select p.is_synthetic or pv.is_synthetic
                       from transit.place_version pv join transit.place p on p.id = pv.place_id
                      where pv.id = m.version_id and pv.place_id = m.entity_id)
                   when 'fare_rule' then (
                     select fr.is_synthetic or frv.is_synthetic
                       from transit.fare_rule_version frv join transit.fare_rule fr on fr.id = frv.fare_rule_id
                      where frv.id = m.version_id and frv.fare_rule_id = m.entity_id)
                   when 'terminal' then (
                     case when m.version_id = m.entity_id then (
                       select t.is_synthetic from transit.terminal t where t.id = m.entity_id)
                     else (
                       select t.is_synthetic or tv.is_synthetic
                         from transit.terminal_version tv join transit.terminal t on t.id = tv.terminal_id
                        where tv.id = m.version_id and tv.terminal_id = m.entity_id) end)
                   when 'regional_service' then (
                     select rs.is_synthetic or rsv.is_synthetic
                       from transit.regional_service_version rsv join transit.regional_service rs on rs.id = rsv.regional_service_id
                      where rsv.id = m.version_id and rsv.regional_service_id = m.entity_id)
                   when 'shape' then (
                     select s.is_synthetic or sv.is_synthetic
                       from transit.shape_version sv join transit.shape s on s.id = sv.shape_id
                      where sv.id = m.version_id and sv.shape_id = m.entity_id)
                   when 'walk_graph' then (
                     select g.is_synthetic or gv.is_synthetic
                       from transit.walk_graph_version gv join transit.walk_graph g on g.id = gv.walk_graph_id
                      where gv.id = m.version_id and gv.walk_graph_id = m.entity_id)
                   when 'eta_param' then (
                     select p.is_synthetic or pv.is_synthetic
                       from transit.eta_param_version pv join transit.eta_param p on p.id = pv.eta_param_id
                      where pv.id = m.version_id and pv.eta_param_id = m.entity_id)
                   else case when m.version_id <> m.entity_id then null else (case m.entity_kind
                     when 'route' then (select t.is_synthetic from transit.route t where t.id = m.entity_id)
                     when 'route_alias' then (select t.is_synthetic from transit.route_alias t where t.id = m.entity_id)
                     when 'fare_observation' then (select t.is_synthetic from transit.fare_observation t where t.id = m.entity_id)
                     when 'fare_conflict' then (select t.is_synthetic from transit.fare_conflict t where t.id = m.entity_id)
                     when 'barangay' then (select t.is_synthetic from transit.barangay t where t.id = m.entity_id)
                     when 'coverage_audit' then (select t.is_synthetic from transit.coverage_audit t where t.id = m.entity_id)
                     when 'feeder_lead' then (select t.is_synthetic from transit.feeder_lead t where t.id = m.entity_id)
                     when 'provider_presence' then (select t.is_synthetic from transit.provider_presence t where t.id = m.entity_id)
                     when 'rail_status' then (select t.is_synthetic from transit.rail_status t where t.id = m.entity_id)
                     when 'designated_stop_candidate' then (select t.is_synthetic from transit.designated_stop_candidate t where t.id = m.entity_id)
                     when 'external_destination_category' then (select t.is_synthetic from transit.external_destination_category t where t.id = m.entity_id)
                     when 'dataset_note' then (select t.is_synthetic from transit.dataset_note t where t.id = m.entity_id)
                     when 'route_vehicle_class' then (select t.is_synthetic from transit.route_vehicle_class t where t.id = m.entity_id)
                     when 'route_cooperative' then (select t.is_synthetic from transit.route_cooperative t where t.id = m.entity_id)
                     when 'route_operating_status' then (select t.is_synthetic from transit.route_operating_status t where t.id = m.entity_id)
                     when 'route_fare_observation' then (select t.is_synthetic from transit.route_fare_observation t where t.id = m.entity_id)
                     when 'route_note' then (select t.is_synthetic from transit.route_note t where t.id = m.entity_id)
                   end) end
                 end) as syn
            from transit.revision_member m
           where m.revision_id = p_revision) x), '[]'::jsonb),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object('stopPointId', spv.stop_point_id, 'layer', spv.source_layer,
               'code', spv.source_code_raw, 'name', sp.name,
               'lat', extensions.ST_Y(spv.geog::extensions.geometry), 'lng', extensions.ST_X(spv.geog::extensions.geometry)))
        from transit.revision_member m
        join transit.stop_point_version spv on spv.id = m.version_id
        join transit.stop_point sp on sp.id = spv.stop_point_id
       where m.revision_id = p_revision and m.entity_kind = 'stop_point'), '[]'::jsonb),
    'terminals', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code,
               'lat', extensions.ST_Y(g.geog::extensions.geometry), 'lng', extensions.ST_X(g.geog::extensions.geometry)))
        from transit.revision_member m
        join transit.terminal t on t.id = m.entity_id
        left join transit.terminal_version tv on tv.id = m.version_id and tv.terminal_id = t.id
        cross join lateral (select coalesce(tv.geog, t.geog) as geog) g
       where m.revision_id = p_revision and m.entity_kind = 'terminal' and g.geog is not null), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'kind', v.kind, 'trialStatus', vv.trial_status, 'effectiveFrom', vv.effective_from,
               'trialDurationDays', vv.trial_duration_days, 'evidenceLevel', vv.evidence_level,
               'hasFareEvidence', (
                 exists (select 1 from transit.revision_member fm join transit.route_fare_observation o on o.id = fm.entity_id
                          where fm.revision_id = p_revision and fm.entity_kind = 'route_fare_observation' and o.route_id = r.id)
                 or exists (select 1 from transit.revision_member fm join transit.fare_rule f on f.id = fm.entity_id
                             where fm.revision_id = p_revision and fm.entity_kind = 'fare_rule'
                               and r.mode_code is not null and f.mode_code = r.mode_code))))
        from transit.revision_member m
        join transit.variant v on v.id = m.entity_id
        join transit.variant_version vv on vv.id = m.version_id and vv.variant_id = v.id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'variant'), '[]'::jsonb),
    'routeStops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variantRef', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'seq', rs.seq, 'distAlongM', rs.dist_along_m) order by rs.variant_version_id, rs.seq)
        from transit.revision_member m
        join transit.route_stop rs on rs.variant_version_id = m.version_id
        join transit.variant v on v.id = m.entity_id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'variant' and rs.dist_along_m is not null), '[]'::jsonb),
    'shapes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'variantRef', r.public_code || ' ' || v.direction || case when v.kind <> 'permanent' then ' (' || v.kind || ')' else '' end,
               'traceStatus', sv.trace_status, 'untracedReason', sv.untraced_reason,
               'measures', coalesce((select jsonb_agg(jsonb_build_object('seq', e.value -> 'seq', 'measureM', e.value -> 'measureM'))
                                       from jsonb_array_elements(coalesce(sv.stop_measures, '[]'::jsonb)) e), '[]'::jsonb)))
        from transit.revision_member m
        join transit.shape s on s.id = m.entity_id
        join transit.shape_version sv on sv.id = m.version_id and sv.shape_id = s.id
        join transit.variant v on v.id = s.variant_id
        join transit.route r on r.id = v.route_id
       where m.revision_id = p_revision and m.entity_kind = 'shape'), '[]'::jsonb));
end;
$$;
alter function transit.admin_validation_facts(uuid) owner to paranaga_definer;
revoke execute on function transit.admin_validation_facts(uuid) from public;
grant execute on function transit.admin_validation_facts(uuid) to paranaga_app;

-- The server's report (src/domain/admin/validation.ts), stored with the membership hash it was
-- computed on. A hash that no longer matches means the membership changed in between: refused.
create or replace function transit.admin_record_validation(p_revision uuid, p_membership_hash text, p_report jsonb)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  v_report jsonb;
begin
  if jsonb_typeof(p_report) is distinct from 'object'
     or jsonb_typeof(p_report -> 'ok') is distinct from 'boolean'
     or jsonb_typeof(p_report -> 'errorCount') is distinct from 'number'
     or jsonb_typeof(p_report -> 'warningCount') is distinct from 'number'
     or octet_length(p_report::text) > 262144 then
    raise exception 'invalid validation report' using errcode = '22023';
  end if;
  perform 1 from transit.revision r where r.id = p_revision for update;
  if not found then
    raise exception 'unknown revision' using errcode = '22023';
  end if;
  if p_membership_hash is distinct from transit.revision_membership_hash(p_revision) then
    raise exception 'the revision changed while it was being validated; validate again' using errcode = '55000';
  end if;
  v_report := p_report || jsonb_build_object('membershipHash', p_membership_hash, 'validatedAt', now(), 'validatedBy', v_user);
  update transit.revision r set validation_report = v_report where r.id = p_revision;
  perform core.audit('revision.validate', 'transit.revision', p_revision::text,
    jsonb_build_object('ok', p_report -> 'ok', 'errors', p_report -> 'errorCount', 'warnings', p_report -> 'warningCount'));
  return v_report;
end;
$$;
alter function transit.admin_record_validation(uuid, text, jsonb) owner to paranaga_definer;
revoke execute on function transit.admin_record_validation(uuid, text, jsonb) from public;
grant execute on function transit.admin_record_validation(uuid, text, jsonb) to paranaga_app;

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

  -- Two-person rule (spec 05 §5.3): the publisher differs from the revision's author.
  if exists (select 1 from ops.feature_flag f where f.key = 'publish_requires_second_reviewer' and f.enabled)
     and v_rev.created_by = v_user then
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

-- ---------------------------------------------------------------- coverage audit (C8, A13)
-- What the import holds per barangay today: survey status and the dimensions on file (one, so far).
create or replace function transit.admin_coverage(p_revision uuid)
returns table (barangay text, survey_status text, dimensions jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
begin
  perform transit.admin_assert_staff();
  return query
  select b.name, b.survey_status, coalesce(a.dimensions, '{}'::jsonb)
    from transit.revision_member bm
    join transit.barangay b on b.id = bm.entity_id
    left join transit.coverage_audit a on a.barangay_id = b.id
     and exists (select 1 from transit.revision_member am
                  where am.revision_id = p_revision and am.entity_kind = 'coverage_audit' and am.entity_id = a.id)
   where bm.revision_id = p_revision and bm.entity_kind = 'barangay'
   order by b.name;
end;
$$;
alter function transit.admin_coverage(uuid) owner to paranaga_definer;
revoke execute on function transit.admin_coverage(uuid) from public;
grant execute on function transit.admin_coverage(uuid) to paranaga_app;

revoke create on schema transit from paranaga_definer;
