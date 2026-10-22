-- 0024_admin_stops_imports.sql
-- N5b (docs/spec/07-delivery.md §7.11): admin console C3 (candidates, stops and curbs,
-- reconciliation) and C2 (changed-data imports). Additive only. Every write goes into the one open
-- DRAFT revision (transit.admin_create_draft, 0023) as new *_version rows plus a repointed draft
-- membership; released rows are never edited. The app (paranaga_app) reaches all of it through the
-- SECURITY DEFINER functions below, each of which checks the caller's role in the database
-- (transit.admin_assert_staff, 0023), and every state change writes a core.audit row.
--
-- New data:
--   - transit.stop_point_version gains name (NULL = the stable row's name), aliases and edit_note,
--     so a stop's name is versioned like its position; transit.v_published_stops reads
--     coalesce(version name, stable name) (same columns as 0001).
--   - transit.evidence and transit.evidence_link (spec 04 §4.4): one nullable target per link,
--     num_nonnulls = 1, claim/target compatibility, unique (target, evidence, claim), an index on
--     every foreign key. Evidence links to VERSIONS; a new version of a stop carries the links of
--     the one it replaces (a relocation or a moved source pin drops curb_position).
--   - transit.reconciliation_decision: link / keep separate for two stops within 15 m.
--
-- Functions (app-callable, SECURITY DEFINER, staff only, draft only where they write):
--   transit.admin_stops(revision)            the stop members of a revision (default: the open
--                                            draft, else the published one) with pins and evidence.
--   transit.admin_promote_stop(...)          candidate → documentary → installed → field_verified,
--                                            forward only, each step needing evidence of its claim.
--   transit.admin_attach_stop_evidence(...)  evidence (document, photo from an existing upload slot
--                                            in the private bucket, field survey, …) + a link.
--   transit.admin_retire_stop(...)           status retired (refused while a route's stop order uses it).
--   transit.admin_relocate_stop(...)         new coordinates with a reason.
--   transit.admin_edit_stop(...)             name, aliases, curb side / curb point (only with
--                                            curb_position evidence), boarding / alighting.
--   transit.admin_reconciliation()           stops within 15 m of each other with no decision yet,
--                                            each stop's source pins with their distance and label.
--   transit.admin_reconcile(...)             link (one stop kept, the other retired, its pins added
--                                            to the kept stop) or keep separate.
--   ingest.admin_import_batches(limit)       committed and failed import batches with their counts.
--   ingest.admin_import_baseline()           the newest committed My Maps batch and its raw features
--                                            (what a dry run diffs against).
--   ingest.admin_import_commit(plan)         the changed-data importer: a new batch (document, raw
--                                            features, changes, conflicts) and, in the open draft,
--                                            new candidate stops for added pins and new versions
--                                            for moved or relabelled candidate pins. The change
--                                            kind is recomputed here from the stored hashes; with
--                                            nothing added, changed or missing nothing is written.
--   transit.admin_validation_facts(revision) replaced: same keys as 0023, and each stop also carries
--                                            status, curb side, evidence claims, metres moved since
--                                            the parent revision and whether a route's stop order uses it.
-- Every write takes the stop's expected member version (optimistic concurrency, like 0023's
-- expected published pointer) and locks the draft row, so edits serialize with publication.
--
-- Helpers (invoker rights, owned by paranaga_definer, not callable by the app):
--   transit.admin_open_draft, transit.admin_draft_stop, transit.stop_status_rank,
--   transit.admin_copy_stop_version, transit.admin_repoint_stop (repoints the draft member and,
--   for every member variant whose stop order uses the old version, adds a variant version with
--   the same stop order on the new stop version, and a shape version following it).
--
-- Grants AND row-level-security policies for paranaga_definer on every table these functions
-- touch that it could not reach yet: ingest.source, source_document, raw_feature,
-- raw_feature_lineage, change, conflict (read + insert where written), ingest.batch (insert of a
-- running commit, update of its outcome), transit.stop_point, stop_point_version,
-- stop_point_source, variant_version, route_stop, shape_version (insert of unreleased rows),
-- transit.revision_member (update of version_id in a draft only), and the three new tables.

grant create on schema transit to paranaga_definer;
grant create on schema ingest to paranaga_definer;

-- ---------------------------------------------------------------- versioned stop details
alter table transit.stop_point_version
  add column name      text check (name is null or (btrim(name) <> '' and char_length(name) <= 120)),
  add column aliases   text[] not null default '{}'
                       check (cardinality(aliases) <= 10 and array_position(aliases, null) is null),
  add column edit_note text check (edit_note is null or char_length(edit_note) <= 500);

-- Same columns as 0001; the name now follows the member version.
create or replace view transit.v_published_stops with (security_invoker = true) as
select pp.revision_id, sp.id as stop_point_id, spv.id as stop_point_version_id, coalesce(spv.name, sp.name) as name,
       extensions.ST_X(spv.geog::extensions.geometry) as lon,
       extensions.ST_Y(spv.geog::extensions.geometry) as lat,
       spv.geog, spv.geog_accuracy_m, spv.status, spv.source_layer, spv.source_code_raw, spv.label_raw,
       spv.curb_side, spv.boarding_allowed, spv.alighting_allowed, spv.sign_installed, spv.navigation_approved
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'stop_point'
  join transit.stop_point sp on sp.id = m.entity_id
  join transit.stop_point_version spv on spv.id = m.version_id and spv.stop_point_id = sp.id
 where not sp.is_synthetic and not spv.is_synthetic;

-- ---------------------------------------------------------------- evidence (spec 04 §4.4)
create table transit.evidence (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  kind             text not null check (kind in ('document', 'photo', 'gps_log', 'field_survey', 'operator_statement')),
  source_code      text references ingest.source (code),
  media_object_id  uuid references core.media_object (id),
  observed_at      date,
  observer_user_id text,
  reviewer_user_id text,
  note             text check (note is null or char_length(note) <= 1000),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  is_synthetic     boolean not null default false,
  constraint evidence_photo_has_media check (kind <> 'photo' or media_object_id is not null),
  constraint evidence_has_basis check (num_nonnulls(source_code, media_object_id, note) >= 1)
);
create index evidence_source_idx on transit.evidence (source_code);
create index evidence_media_idx on transit.evidence (media_object_id);

create table transit.evidence_link (
  id                    uuid primary key default pg_catalog.gen_random_uuid(),
  evidence_id           uuid not null references transit.evidence (id),
  claim                 text not null check (claim in (
                          'legal_designation', 'sign_installed', 'operating_observed', 'curb_position',
                          'fare', 'hours', 'shape')),
  stop_point_version_id uuid references transit.stop_point_version (id),
  variant_version_id    uuid references transit.variant_version (id),
  shape_version_id      uuid references transit.shape_version (id),
  fare_rule_version_id  uuid references transit.fare_rule_version (id),
  terminal_id           uuid references transit.terminal (id),
  is_synthetic          boolean not null default false,
  created_at            timestamptz not null default now(),
  constraint evidence_link_one_target check (
    num_nonnulls(stop_point_version_id, variant_version_id, shape_version_id, fare_rule_version_id, terminal_id) = 1),
  constraint evidence_link_claim_target check (
    (stop_point_version_id is null or claim in ('legal_designation', 'sign_installed', 'operating_observed', 'curb_position'))
    and (variant_version_id is null or claim in ('legal_designation', 'operating_observed', 'hours'))
    and (shape_version_id is null or claim = 'shape')
    and (fare_rule_version_id is null or claim in ('fare', 'legal_designation'))
    and (terminal_id is null or claim in ('legal_designation', 'hours', 'curb_position')))
);
create index evidence_link_evidence_idx on transit.evidence_link (evidence_id);
create unique index evidence_link_stop_uq on transit.evidence_link (stop_point_version_id, evidence_id, claim)
  where stop_point_version_id is not null;
create unique index evidence_link_variant_uq on transit.evidence_link (variant_version_id, evidence_id, claim)
  where variant_version_id is not null;
create unique index evidence_link_shape_uq on transit.evidence_link (shape_version_id, evidence_id, claim)
  where shape_version_id is not null;
create unique index evidence_link_fare_uq on transit.evidence_link (fare_rule_version_id, evidence_id, claim)
  where fare_rule_version_id is not null;
create unique index evidence_link_terminal_uq on transit.evidence_link (terminal_id, evidence_id, claim)
  where terminal_id is not null;

-- ---------------------------------------------------------------- reconciliation (A7)
create table transit.reconciliation_decision (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  stop_point_a       uuid not null references transit.stop_point (id),
  stop_point_b       uuid not null references transit.stop_point (id),
  rule               text not null check (rule in ('same_coordinates', 'near')),
  distance_m         numeric not null check (distance_m >= 0),
  decision           text not null check (decision in ('link', 'keep_separate')),
  kept_stop_point_id uuid references transit.stop_point (id),
  note               text check (note is null or char_length(note) <= 500),
  revision_id        uuid not null references transit.revision (id),
  decided_by         text not null,
  decided_at         timestamptz not null default now(),
  is_synthetic       boolean not null default false,
  constraint reconciliation_pair_order check (stop_point_a < stop_point_b),
  constraint reconciliation_kept check (
    (decision = 'link') = (kept_stop_point_id is not null)
    and (kept_stop_point_id is null or kept_stop_point_id in (stop_point_a, stop_point_b))),
  unique (stop_point_a, stop_point_b)
);
create index reconciliation_b_idx on transit.reconciliation_decision (stop_point_b);
create index reconciliation_kept_idx on transit.reconciliation_decision (kept_stop_point_id);
create index reconciliation_revision_idx on transit.reconciliation_decision (revision_id);

alter table transit.evidence enable row level security;
alter table transit.evidence force row level security;
alter table transit.evidence_link enable row level security;
alter table transit.evidence_link force row level security;
alter table transit.reconciliation_decision enable row level security;
alter table transit.reconciliation_decision force row level security;

-- Not public: read and written only through the definer functions below (no paranaga_app grant).
grant select, insert on transit.evidence, transit.evidence_link, transit.reconciliation_decision to paranaga_definer;
create policy definer_read on transit.evidence for select to paranaga_definer using (true);
create policy definer_insert on transit.evidence for insert to paranaga_definer with check (true);
create policy definer_read on transit.evidence_link for select to paranaga_definer using (true);
-- A link only ever targets a row no published or superseded revision uses (a new draft version).
create policy definer_insert on transit.evidence_link for insert to paranaga_definer
  with check (not transit.in_released_revision(coalesce(stop_point_version_id, variant_version_id, shape_version_id,
                                                        fare_rule_version_id, terminal_id)));
create policy definer_read on transit.reconciliation_decision for select to paranaga_definer using (true);
create policy definer_insert on transit.reconciliation_decision for insert to paranaga_definer
  with check (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'));

-- ---------------------------------------------------------------- definer reach
grant execute on function transit.in_released_revision(uuid) to paranaga_definer;

-- ingest: read the provenance; write a new commit batch and its rows (append-only, like the import role).
grant select on ingest.source, ingest.source_document, ingest.raw_feature, ingest.raw_feature_lineage,
  ingest.change, ingest.conflict to paranaga_definer;
do $$
declare
  t text;
begin
  foreach t in array array['ingest.source', 'ingest.source_document', 'ingest.raw_feature',
                           'ingest.raw_feature_lineage', 'ingest.change', 'ingest.conflict']
  loop
    execute format('create policy definer_read on %s for select to paranaga_definer using (true)', t);
  end loop;
end
$$;
grant insert on ingest.source_document, ingest.batch, ingest.raw_feature, ingest.raw_feature_lineage,
  ingest.change, ingest.conflict to paranaga_definer;
do $$
declare
  t text;
begin
  foreach t in array array['ingest.source_document', 'ingest.raw_feature', 'ingest.raw_feature_lineage',
                           'ingest.change', 'ingest.conflict']
  loop
    execute format('create policy definer_insert on %s for insert to paranaga_definer with check (true)', t);
  end loop;
end
$$;
create policy definer_insert on ingest.batch for insert to paranaga_definer
  with check (mode = 'commit' and status = 'running' and finished_at is null);
grant update (status, counts, finished_at) on ingest.batch to paranaga_definer;
create policy definer_finish on ingest.batch for update to paranaga_definer
  using (status = 'running') with check (status in ('committed', 'failed'));

-- transit: new identity and version rows only (select + definer_read exist since 0001/0007).
grant insert on transit.stop_point, transit.stop_point_version, transit.stop_point_source,
  transit.variant_version, transit.route_stop, transit.shape_version to paranaga_definer;
create policy definer_insert on transit.stop_point for insert to paranaga_definer
  with check (not transit.in_released_revision(id));
create policy definer_insert on transit.stop_point_version for insert to paranaga_definer
  with check (not transit.in_released_revision(id));
create policy definer_insert on transit.variant_version for insert to paranaga_definer
  with check (not transit.in_released_revision(id));
create policy definer_insert on transit.shape_version for insert to paranaga_definer
  with check (not transit.in_released_revision(id));
create policy definer_insert on transit.stop_point_source for insert to paranaga_definer
  with check (not transit.in_released_revision(stop_point_version_id));
create policy definer_insert on transit.route_stop for insert to paranaga_definer
  with check (not transit.in_released_revision(variant_version_id));

-- transit.revision_member: 0023 lets the definer insert draft members; repointing a draft member
-- to a new version is the only update (revision_member_guard, 0001, refuses anything but drafts too).
grant update (version_id) on transit.revision_member to paranaga_definer;
create policy definer_update_draft on transit.revision_member for update to paranaga_definer
  using (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'))
  with check (exists (select 1 from transit.revision r where r.id = revision_id and r.status = 'draft'));

-- ---------------------------------------------------------------- helpers (not callable by the app)
-- The one open draft, locked (FOR UPDATE: edits serialize with each other and with publication).
create or replace function transit.admin_open_draft() returns uuid
  language plpgsql volatile
  set search_path = pg_catalog, transit, pg_temp
as $$
declare
  v_draft uuid;
begin
  select r.id into v_draft from transit.revision r where r.status = 'draft' order by r.seq desc limit 1 for update;
  if v_draft is null then
    raise exception 'no draft revision is open; create one under Revisions first' using errcode = '55000';
  end if;
  return v_draft;
end;
$$;
alter function transit.admin_open_draft() owner to paranaga_definer;
revoke execute on function transit.admin_open_draft() from public;

-- The stop's member version in the open draft, locked, checked against the version the caller saw.
create or replace function transit.admin_draft_stop(p_stop uuid, p_expected uuid, out o_draft uuid, out o_version uuid)
  language plpgsql volatile
  set search_path = pg_catalog, transit, pg_temp
as $$
begin
  o_draft := transit.admin_open_draft();
  select m.version_id into o_version
    from transit.revision_member m
   where m.revision_id = o_draft and m.entity_kind = 'stop_point' and m.entity_id = p_stop
     for update;
  if o_version is null then
    raise exception 'unknown stop' using errcode = '22023';
  end if;
  if o_version is distinct from p_expected then
    raise exception 'this stop changed since the page was loaded; reload and try again' using errcode = '55000';
  end if;
end;
$$;
alter function transit.admin_draft_stop(uuid, uuid) owner to paranaga_definer;
revoke execute on function transit.admin_draft_stop(uuid, uuid) from public;

-- Promotion order (spec 04 §4.6); temporary and relocated restart at the bottom, retired is terminal.
create or replace function transit.stop_status_rank(p_status text) returns integer
  language sql immutable
  set search_path = pg_catalog, pg_temp
as $$
  select case p_status
    when 'candidate' then 0 when 'temporary' then 0 when 'relocated' then 0
    when 'documentary' then 1 when 'installed' then 2 when 'field_verified' then 3 when 'published' then 4
    else null end
$$;
alter function transit.stop_status_rank(text) owner to paranaga_definer;
revoke execute on function transit.stop_status_rank(text) from public;

-- A new stop version: a copy of p_from with the patch applied (keys: lat+lng, status, curb_side,
-- boarding_allowed, alighting_allowed, navigation_approved, name, aliases, edit_note, source_layer,
-- source_code_raw, label_raw, content_hash), its source pins (minus those of p_drop_identity) and
-- its evidence links (minus the claims in p_drop_claims). Returns the new version id.
create or replace function transit.admin_copy_stop_version(p_from uuid, p_patch jsonb, p_drop_claims text[], p_drop_identity text)
returns uuid
  language plpgsql volatile
  set search_path = pg_catalog, transit, ingest, pg_temp
as $$
declare
  v transit.stop_point_version%rowtype;
  v_new uuid := pg_catalog.gen_random_uuid();
  v_moved boolean := p_patch ? 'lat';
begin
  select * into v from transit.stop_point_version s where s.id = p_from;
  if not found then
    raise exception 'unknown stop version' using errcode = '22023';
  end if;
  insert into transit.stop_point_version (
    id, stop_point_id, geog, geog_accuracy_m, status, source_layer, source_code_raw, label_raw, curb_side,
    boarding_allowed, alighting_allowed, sign_installed, navigation_approved, content_hash, is_synthetic,
    name, aliases, edit_note)
  values (
    v_new, v.stop_point_id,
    case when v_moved then extensions.ST_SetSRID(extensions.ST_MakePoint((p_patch ->> 'lng')::float8, (p_patch ->> 'lat')::float8), 4326)::extensions.geography
         else v.geog end,
    case when v_moved then null else v.geog_accuracy_m end,
    case when p_patch ? 'status' then p_patch ->> 'status' else v.status end,
    case when p_patch ? 'source_layer' then p_patch ->> 'source_layer' else v.source_layer end,
    case when p_patch ? 'source_code_raw' then p_patch ->> 'source_code_raw' else v.source_code_raw end,
    case when p_patch ? 'label_raw' then p_patch ->> 'label_raw' else v.label_raw end,
    case when p_patch ? 'curb_side' then p_patch ->> 'curb_side' else v.curb_side end,
    case when p_patch ? 'boarding_allowed' then (p_patch ->> 'boarding_allowed')::boolean else v.boarding_allowed end,
    case when p_patch ? 'alighting_allowed' then (p_patch ->> 'alighting_allowed')::boolean else v.alighting_allowed end,
    v.sign_installed,
    case when p_patch ? 'navigation_approved' then (p_patch ->> 'navigation_approved')::boolean else v.navigation_approved end,
    p_patch ->> 'content_hash',
    v.is_synthetic,
    case when p_patch ? 'name' then p_patch ->> 'name' else v.name end,
    case when p_patch ? 'aliases' then array(select jsonb_array_elements_text(p_patch -> 'aliases')) else v.aliases end,
    case when p_patch ? 'edit_note' then p_patch ->> 'edit_note' else v.edit_note end);

  insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id, is_synthetic)
  select s.stop_point_id, v_new, s.raw_feature_id, s.is_synthetic
    from transit.stop_point_source s
    join ingest.raw_feature rf on rf.id = s.raw_feature_id
   where s.stop_point_version_id = p_from
     and (p_drop_identity is null or rf.source_identity <> p_drop_identity);

  insert into transit.evidence_link (evidence_id, claim, stop_point_version_id, is_synthetic)
  select l.evidence_id, l.claim, v_new, l.is_synthetic
    from transit.evidence_link l
   where l.stop_point_version_id = p_from
     and not (l.claim = any (coalesce(p_drop_claims, '{}'::text[])));
  return v_new;
end;
$$;
alter function transit.admin_copy_stop_version(uuid, jsonb, text[], text) owner to paranaga_definer;
revoke execute on function transit.admin_copy_stop_version(uuid, jsonb, text[], text) from public;

-- Repoints the draft's stop member from p_old to p_new. Publication requires every route stop to
-- use the member version of its stop (0001) and every shape to follow its variant's member version
-- (0007), so each member variant whose stop order uses p_old gets a new variant version with the
-- same stop order on p_new, and its member shape a new shape version following it (stop measures
-- renamed; the line itself is unchanged, so a moved stop's measure is stale until re-traced: the
-- stop_moved_far validation rule flags it). Returns the number of variants rewritten.
create or replace function transit.admin_repoint_stop(p_draft uuid, p_stop uuid, p_old uuid, p_new uuid) returns integer
  language plpgsql volatile
  set search_path = pg_catalog, transit, pg_temp
as $$
declare
  r record;
  s record;
  v_vv uuid;
  v_sv uuid;
  v_n integer := 0;
begin
  if p_old = p_new then
    return 0;
  end if;
  update transit.revision_member m set version_id = p_new
   where m.revision_id = p_draft and m.entity_kind = 'stop_point' and m.entity_id = p_stop and m.version_id = p_old;
  if not found then
    raise exception 'this stop changed since the page was loaded; reload and try again' using errcode = '55000';
  end if;

  for r in
    select m.entity_id as variant_id, m.version_id as old_vv
      from transit.revision_member m
     where m.revision_id = p_draft and m.entity_kind = 'variant'
       and exists (select 1 from transit.route_stop rs where rs.variant_version_id = m.version_id and rs.stop_point_version_id = p_old)
  loop
    v_vv := pg_catalog.gen_random_uuid();
    insert into transit.variant_version (
      id, variant_id, headsign, vehicle_class, legal_streets, trial_status, effective_from, trial_duration_days,
      operating_status, evidence_level, is_circular, navigation_approved, source_codes, notes, content_hash,
      is_synthetic, anchors)
    select v_vv, vv.variant_id, vv.headsign, vv.vehicle_class, vv.legal_streets, vv.trial_status, vv.effective_from,
           vv.trial_duration_days, vv.operating_status, vv.evidence_level, vv.is_circular, vv.navigation_approved,
           vv.source_codes, vv.notes, null, vv.is_synthetic, vv.anchors
      from transit.variant_version vv where vv.id = r.old_vv;
    insert into transit.route_stop (
      variant_version_id, stop_point_version_id, seq, dist_along_m, boarding_allowed, alighting_allowed,
      evidence_level, is_synthetic)
    select v_vv, case when rs.stop_point_version_id = p_old then p_new else rs.stop_point_version_id end,
           rs.seq, rs.dist_along_m, rs.boarding_allowed, rs.alighting_allowed, rs.evidence_level, rs.is_synthetic
      from transit.route_stop rs where rs.variant_version_id = r.old_vv;
    update transit.revision_member m set version_id = v_vv
     where m.revision_id = p_draft and m.entity_kind = 'variant' and m.entity_id = r.variant_id;

    for s in
      select sv.*
        from transit.revision_member m
        join transit.shape sh on sh.id = m.entity_id and sh.variant_id = r.variant_id
        join transit.shape_version sv on sv.id = m.version_id and sv.variant_version_id = r.old_vv
       where m.revision_id = p_draft and m.entity_kind = 'shape'
    loop
      v_sv := pg_catalog.gen_random_uuid();
      insert into transit.shape_version (
        id, shape_id, variant_version_id, trace_status, flag_reason, untraced_reason, geog, length_m, evidence_kind,
        approximate, label, stop_measures, off_list_segments, trace_quality, inputs_hash, road_source_code,
        content_hash, is_synthetic)
      values (
        v_sv, s.shape_id, v_vv, s.trace_status, s.flag_reason, s.untraced_reason, s.geog, s.length_m, s.evidence_kind,
        s.approximate, s.label,
        case when s.stop_measures is null then null else coalesce((
          select jsonb_agg(case when e.value ->> 'stopPointVersionId' = p_old::text
                                then jsonb_set(e.value, '{stopPointVersionId}', to_jsonb(p_new::text)) else e.value end
                           order by e.ord)
            from jsonb_array_elements(s.stop_measures) with ordinality as e(value, ord)), '[]'::jsonb) end,
        s.off_list_segments, s.trace_quality, s.inputs_hash, s.road_source_code,
        encode(sha256(convert_to(s.content_hash || ':' || v_vv::text, 'UTF8')), 'hex'), s.is_synthetic);
      update transit.revision_member m set version_id = v_sv
       where m.revision_id = p_draft and m.entity_kind = 'shape' and m.entity_id = s.shape_id;
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
alter function transit.admin_repoint_stop(uuid, uuid, uuid, uuid) owner to paranaga_definer;
revoke execute on function transit.admin_repoint_stop(uuid, uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------- stops (A3, A6)
create or replace function transit.admin_stops(p_revision uuid default null) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, transit, ingest, core, pg_temp
as $$
declare
  v_rev transit.revision%rowtype;
begin
  perform transit.admin_assert_staff();
  if p_revision is null then
    select * into v_rev from transit.revision r where r.status = 'draft' order by r.seq desc limit 1;
    if not found then
      select r.* into v_rev from transit.published_pointer pp join transit.revision r on r.id = pp.revision_id where pp.singleton;
    end if;
  else
    select * into v_rev from transit.revision r where r.id = p_revision;
    if not found then
      raise exception 'unknown revision' using errcode = '22023';
    end if;
  end if;
  if v_rev.id is null then
    return jsonb_build_object('revision', null, 'stops', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'revision', jsonb_build_object('id', v_rev.id, 'label', v_rev.label, 'kind', v_rev.kind, 'status', v_rev.status),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stopPointId', sp.id, 'versionId', spv.id, 'name', coalesce(spv.name, sp.name),
               'aliases', to_jsonb(spv.aliases), 'status', spv.status, 'layer', spv.source_layer,
               'code', spv.source_code_raw, 'labelRaw', spv.label_raw,
               'lat', extensions.ST_Y(spv.geog::extensions.geometry), 'lng', extensions.ST_X(spv.geog::extensions.geometry),
               'curbSide', spv.curb_side, 'boardingAllowed', spv.boarding_allowed, 'alightingAllowed', spv.alighting_allowed,
               'navigationApproved', spv.navigation_approved, 'editNote', spv.edit_note,
               'isSynthetic', sp.is_synthetic or spv.is_synthetic,
               'sequences', coalesce((
                 select jsonb_agg(distinct rt.public_code)
                   from transit.revision_member vm
                   join transit.route_stop rs on rs.variant_version_id = vm.version_id
                   join transit.variant v on v.id = vm.entity_id
                   join transit.route rt on rt.id = v.route_id
                  where vm.revision_id = v_rev.id and vm.entity_kind = 'variant' and rs.stop_point_version_id = spv.id), '[]'::jsonb),
               'pins', coalesce((
                 select jsonb_agg(jsonb_build_object('layer', rf.source_layer, 'code', rf.source_code_raw, 'label', rf.label_raw,
                          'description', rf.description_raw, 'lat', rf.lat, 'lng', rf.lon) order by rf.source_layer, rf.source_code_raw)
                   from transit.stop_point_source s
                   join ingest.raw_feature rf on rf.id = s.raw_feature_id
                  where s.stop_point_version_id = spv.id), '[]'::jsonb),
               'evidence', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'claim', l.claim, 'note', e.note,
                          'observedOn', e.observed_at, 'sourceCode', e.source_code, 'hasMedia', e.media_object_id is not null,
                          'createdAt', e.created_at) order by e.created_at, l.claim)
                   from transit.evidence_link l
                   join transit.evidence e on e.id = l.evidence_id
                  where l.stop_point_version_id = spv.id), '[]'::jsonb)))
        from transit.revision_member m
        join transit.stop_point sp on sp.id = m.entity_id
        join transit.stop_point_version spv on spv.id = m.version_id and spv.stop_point_id = sp.id
       where m.revision_id = v_rev.id and m.entity_kind = 'stop_point'), '[]'::jsonb));
end;
$$;
alter function transit.admin_stops(uuid) owner to paranaga_definer;
revoke execute on function transit.admin_stops(uuid) from public;
grant execute on function transit.admin_stops(uuid) to paranaga_app;

-- Promotion needs evidence of the claimed kind on the stop's current version (spec 06 A3).
create or replace function transit.admin_promote_stop(p_stop uuid, p_expected uuid, p_status text, p_note text)
returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  d record;
  v_cur transit.stop_point_version%rowtype;
  v_need text[];
  v_new uuid;
begin
  if p_status is null or p_status not in ('documentary', 'installed', 'field_verified') then
    raise exception 'status must be documentary, installed or field_verified' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'the note is longer than 500 characters' using errcode = '22023';
  end if;
  select * into d from transit.admin_draft_stop(p_stop, p_expected);
  select * into v_cur from transit.stop_point_version s where s.id = d.o_version;
  if v_cur.status = 'retired' then
    raise exception 'a retired stop cannot be promoted' using errcode = '55000';
  end if;
  if transit.stop_status_rank(v_cur.status) >= transit.stop_status_rank(p_status) then
    raise exception 'the stop is already %; promotion only moves forward', v_cur.status using errcode = '55000';
  end if;
  v_need := case p_status
    when 'documentary' then array['legal_designation']
    when 'installed' then array['sign_installed']
    else array['operating_observed', 'curb_position'] end;
  if not exists (select 1 from transit.evidence_link l where l.stop_point_version_id = v_cur.id and l.claim = any (v_need)) then
    raise exception 'promotion to % needs evidence for % on this stop first', p_status, array_to_string(v_need, ' or ')
      using errcode = '55000';
  end if;
  v_new := transit.admin_copy_stop_version(v_cur.id, jsonb_build_object('status', p_status, 'edit_note', p_note), null, null);
  perform transit.admin_repoint_stop(d.o_draft, p_stop, v_cur.id, v_new);
  perform core.audit('stop.promote', 'transit.stop_point', p_stop::text,
    jsonb_build_object('revision_id', d.o_draft, 'from_version_id', v_cur.id, 'version_id', v_new,
                       'from_status', v_cur.status, 'status', p_status, 'note', p_note));
  return v_new;
end;
$$;
alter function transit.admin_promote_stop(uuid, uuid, text, text) owner to paranaga_definer;
revoke execute on function transit.admin_promote_stop(uuid, uuid, text, text) from public;
grant execute on function transit.admin_promote_stop(uuid, uuid, text, text) to paranaga_app;

-- Evidence: a photo is an existing upload slot (core.media_object, purpose stop_photo) that the
-- caller uploaded and the server verified into the private bucket; documents cite a source code.
create or replace function transit.admin_attach_stop_evidence(
  p_stop uuid, p_expected uuid, p_kind text, p_claim text, p_note text, p_observed_on date, p_source_code text, p_media uuid)
returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, ingest, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  d record;
  v_evidence uuid;
  v_new uuid;
begin
  if p_kind is null or p_kind not in ('document', 'photo', 'gps_log', 'field_survey', 'operator_statement') then
    raise exception 'evidence kind must be document, photo, gps_log, field_survey or operator_statement' using errcode = '22023';
  end if;
  if p_claim is null or p_claim not in ('legal_designation', 'sign_installed', 'operating_observed', 'curb_position') then
    raise exception 'a stop claim is legal_designation, sign_installed, operating_observed or curb_position' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'the note is longer than 1000 characters' using errcode = '22023';
  end if;
  if p_observed_on is not null and p_observed_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'the observation date is in the future' using errcode = '22023';
  end if;
  if p_kind = 'photo' and p_media is null then
    raise exception 'photo evidence needs an uploaded photo' using errcode = '22023';
  end if;
  if num_nonnulls(p_source_code, p_media, nullif(btrim(coalesce(p_note, '')), '')) = 0 then
    raise exception 'evidence needs a source code, a photo or a note' using errcode = '22023';
  end if;
  if p_media is not null and not exists (
    select 1 from core.media_object mo
     where mo.id = p_media and mo.status = 'verified' and mo.purpose = 'stop_photo' and mo.owner_id = v_user) then
    raise exception 'the photo is not a verified stop photo uploaded by you' using errcode = '22023';
  end if;
  if p_source_code is not null and not exists (select 1 from ingest.source s where s.code = p_source_code) then
    raise exception 'unknown source code %', p_source_code using errcode = '22023';
  end if;

  select * into d from transit.admin_draft_stop(p_stop, p_expected);
  insert into transit.evidence (kind, source_code, media_object_id, observed_at, observer_user_id, reviewer_user_id, note, created_by)
  values (p_kind, p_source_code, p_media, p_observed_on,
          case when p_kind in ('photo', 'gps_log', 'field_survey') then v_user end, v_user,
          nullif(btrim(coalesce(p_note, '')), ''), v_user)
  returning id into v_evidence;
  v_new := transit.admin_copy_stop_version(d.o_version, '{}'::jsonb, null, null);
  insert into transit.evidence_link (evidence_id, claim, stop_point_version_id) values (v_evidence, p_claim, v_new);
  perform transit.admin_repoint_stop(d.o_draft, p_stop, d.o_version, v_new);
  perform core.audit('stop.evidence_attach', 'transit.stop_point', p_stop::text,
    jsonb_build_object('revision_id', d.o_draft, 'from_version_id', d.o_version, 'version_id', v_new,
                       'evidence_id', v_evidence, 'kind', p_kind, 'claim', p_claim, 'source_code', p_source_code,
                       'media_object_id', p_media));
  return v_new;
end;
$$;
alter function transit.admin_attach_stop_evidence(uuid, uuid, text, text, text, date, text, uuid) owner to paranaga_definer;
revoke execute on function transit.admin_attach_stop_evidence(uuid, uuid, text, text, text, date, text, uuid) from public;
grant execute on function transit.admin_attach_stop_evidence(uuid, uuid, text, text, text, date, text, uuid) to paranaga_app;

-- Retire: the stop stays a member (status retired, never routed to). Refused while a route's stop
-- order in the draft uses it: changing a stop order is the routes editor's job (C4).
create or replace function transit.admin_retire_stop(p_stop uuid, p_expected uuid, p_reason text) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  d record;
  v_cur transit.stop_point_version%rowtype;
  v_routes text;
  v_new uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  select * into d from transit.admin_draft_stop(p_stop, p_expected);
  select * into v_cur from transit.stop_point_version s where s.id = d.o_version;
  if v_cur.status = 'retired' then
    raise exception 'the stop is already retired' using errcode = '55000';
  end if;
  select string_agg(distinct rt.public_code, ', ') into v_routes
    from transit.revision_member vm
    join transit.route_stop rs on rs.variant_version_id = vm.version_id
    join transit.variant v on v.id = vm.entity_id
    join transit.route rt on rt.id = v.route_id
   where vm.revision_id = d.o_draft and vm.entity_kind = 'variant' and rs.stop_point_version_id = v_cur.id;
  if v_routes is not null then
    raise exception 'the stop is in the stop order of %; change the route''s stops before retiring it', v_routes using errcode = '55000';
  end if;
  v_new := transit.admin_copy_stop_version(v_cur.id,
    jsonb_build_object('status', 'retired', 'navigation_approved', false, 'edit_note', btrim(p_reason)), null, null);
  perform transit.admin_repoint_stop(d.o_draft, p_stop, v_cur.id, v_new);
  perform core.audit('stop.retire', 'transit.stop_point', p_stop::text,
    jsonb_build_object('revision_id', d.o_draft, 'from_version_id', v_cur.id, 'version_id', v_new,
                       'from_status', v_cur.status, 'reason', btrim(p_reason)));
  return v_new;
end;
$$;
alter function transit.admin_retire_stop(uuid, uuid, text) owner to paranaga_definer;
revoke execute on function transit.admin_retire_stop(uuid, uuid, text) from public;
grant execute on function transit.admin_retire_stop(uuid, uuid, text) to paranaga_app;

-- Relocate: new coordinates and a reason. Curb evidence was about the old spot (dropped), the
-- navigation approval too; a published stop drops back to field_verified until it is approved again.
create or replace function transit.admin_relocate_stop(p_stop uuid, p_expected uuid, p_lat double precision, p_lng double precision, p_reason text)
returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  d record;
  v_cur transit.stop_point_version%rowtype;
  v_point extensions.geography;
  v_m numeric;
  v_new uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lng < 123.05 or p_lng > 123.40 or p_lat < 13.45 or p_lat > 13.80 then
    raise exception 'the new position is outside the service area' using errcode = '22023';
  end if;
  select * into d from transit.admin_draft_stop(p_stop, p_expected);
  select * into v_cur from transit.stop_point_version s where s.id = d.o_version;
  if v_cur.status = 'retired' then
    raise exception 'a retired stop cannot be relocated' using errcode = '55000';
  end if;
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;
  v_m := round(extensions.ST_Distance(v_cur.geog, v_point)::numeric, 1);
  if v_m < 0.5 then
    raise exception 'the new position is the same as the current one' using errcode = '22023';
  end if;
  v_new := transit.admin_copy_stop_version(v_cur.id,
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'navigation_approved', false, 'edit_note', btrim(p_reason),
                       'status', case when v_cur.status = 'published' then 'field_verified' else v_cur.status end),
    array['curb_position'], null);
  perform transit.admin_repoint_stop(d.o_draft, p_stop, v_cur.id, v_new);
  perform core.audit('stop.relocate', 'transit.stop_point', p_stop::text,
    jsonb_build_object('revision_id', d.o_draft, 'from_version_id', v_cur.id, 'version_id', v_new,
                       'from', jsonb_build_object('lat', extensions.ST_Y(v_cur.geog::extensions.geometry), 'lng', extensions.ST_X(v_cur.geog::extensions.geometry)),
                       'to', jsonb_build_object('lat', p_lat, 'lng', p_lng), 'moved_m', v_m, 'reason', btrim(p_reason)));
  return v_new;
end;
$$;
alter function transit.admin_relocate_stop(uuid, uuid, double precision, double precision, text) owner to paranaga_definer;
revoke execute on function transit.admin_relocate_stop(uuid, uuid, double precision, double precision, text) from public;
grant execute on function transit.admin_relocate_stop(uuid, uuid, double precision, double precision, text) to paranaga_app;

-- Stop details (A6). Patch keys: name, aliases, curbSide, curbLat + curbLng (a fine adjustment of
-- at most 30 m; farther is a relocation), boardingAllowed, alightingAllowed, note. Curb side and
-- curb point need curb_position evidence on the current version; changing them withdraws the
-- navigation approval (a published stop drops back to field_verified).
create or replace function transit.admin_edit_stop(p_stop uuid, p_expected uuid, p_patch jsonb) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  d record;
  v_cur transit.stop_point_version%rowtype;
  v_stable text;
  v_key text;
  v_out jsonb := '{}'::jsonb;
  v_curb boolean := false;
  v_point extensions.geography;
  v_m numeric;
  v_alias text;
  v_new uuid;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'send the changes as an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'aliases', 'curbSide', 'curbLat', 'curbLng', 'boardingAllowed', 'alightingAllowed', 'note') then
      raise exception 'unknown field %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into d from transit.admin_draft_stop(p_stop, p_expected);
  select * into v_cur from transit.stop_point_version s where s.id = d.o_version;
  select sp.name into v_stable from transit.stop_point sp where sp.id = p_stop;
  if v_cur.status = 'retired' then
    raise exception 'a retired stop cannot be edited' using errcode = '55000';
  end if;

  if p_patch ? 'name' then
    if jsonb_typeof(p_patch -> 'name') <> 'string' or btrim(p_patch ->> 'name') = '' or char_length(p_patch ->> 'name') > 120 then
      raise exception 'the name must be 1 to 120 characters' using errcode = '22023';
    end if;
    if btrim(p_patch ->> 'name') is distinct from coalesce(v_cur.name, v_stable) then
      v_out := v_out || jsonb_build_object('name', btrim(p_patch ->> 'name'));
    end if;
  end if;
  if p_patch ? 'aliases' then
    if jsonb_typeof(p_patch -> 'aliases') <> 'array' or jsonb_array_length(p_patch -> 'aliases') > 10 then
      raise exception 'aliases are a list of at most 10 names' using errcode = '22023';
    end if;
    for v_alias in select jsonb_array_elements_text(p_patch -> 'aliases') loop
      if btrim(v_alias) = '' or char_length(v_alias) > 80 then
        raise exception 'each alias must be 1 to 80 characters' using errcode = '22023';
      end if;
    end loop;
    if array(select btrim(x) from jsonb_array_elements_text(p_patch -> 'aliases') x) is distinct from v_cur.aliases then
      v_out := v_out || jsonb_build_object('aliases',
        coalesce((select jsonb_agg(btrim(x)) from jsonb_array_elements_text(p_patch -> 'aliases') x), '[]'::jsonb));
    end if;
  end if;
  if p_patch ? 'curbSide' then
    if p_patch ->> 'curbSide' is not null and p_patch ->> 'curbSide' not in ('left_of_travel', 'right_of_travel', 'terminal_bay', 'unknown') then
      raise exception 'curb side must be left_of_travel, right_of_travel, terminal_bay or unknown' using errcode = '22023';
    end if;
    if (p_patch ->> 'curbSide') is distinct from v_cur.curb_side then
      v_out := v_out || jsonb_build_object('curb_side', p_patch -> 'curbSide');
      v_curb := true;
    end if;
  end if;
  if p_patch ? 'curbLat' or p_patch ? 'curbLng' then
    if jsonb_typeof(p_patch -> 'curbLat') <> 'number' or jsonb_typeof(p_patch -> 'curbLng') <> 'number' then
      raise exception 'a curb point needs both curbLat and curbLng' using errcode = '22023';
    end if;
    v_point := extensions.ST_SetSRID(extensions.ST_MakePoint((p_patch ->> 'curbLng')::float8, (p_patch ->> 'curbLat')::float8), 4326)::extensions.geography;
    v_m := extensions.ST_Distance(v_cur.geog, v_point)::numeric;
    if v_m > 30 then
      raise exception 'a curb point more than 30 m away is a relocation; use Relocate' using errcode = '22023';
    end if;
    if v_m >= 0.1 then
      v_out := v_out || jsonb_build_object('lat', (p_patch ->> 'curbLat')::float8, 'lng', (p_patch ->> 'curbLng')::float8);
      v_curb := true;
    end if;
  end if;
  foreach v_key in array array['boardingAllowed', 'alightingAllowed'] loop
    if p_patch ? v_key then
      if jsonb_typeof(p_patch -> v_key) not in ('boolean', 'null') then
        raise exception '% must be true, false or null', v_key using errcode = '22023';
      end if;
      if (p_patch ->> v_key)::boolean is distinct from (case v_key when 'boardingAllowed' then v_cur.boarding_allowed else v_cur.alighting_allowed end) then
        v_out := v_out || jsonb_build_object(case v_key when 'boardingAllowed' then 'boarding_allowed' else 'alighting_allowed' end, p_patch -> v_key);
      end if;
    end if;
  end loop;
  if v_out = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  if v_curb then
    if not exists (select 1 from transit.evidence_link l where l.stop_point_version_id = v_cur.id and l.claim = 'curb_position') then
      raise exception 'curb side and curb point need curb position evidence on this stop first' using errcode = '55000';
    end if;
    v_out := v_out || jsonb_build_object('navigation_approved', false,
      'status', case when v_cur.status = 'published' then 'field_verified' else v_cur.status end);
  end if;
  if p_patch ? 'note' then
    if jsonb_typeof(p_patch -> 'note') <> 'string' or char_length(p_patch ->> 'note') > 500 then
      raise exception 'the note is longer than 500 characters' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('edit_note', nullif(btrim(p_patch ->> 'note'), ''));
  end if;
  v_new := transit.admin_copy_stop_version(v_cur.id, v_out, null, null);
  perform transit.admin_repoint_stop(d.o_draft, p_stop, v_cur.id, v_new);
  perform core.audit('stop.edit', 'transit.stop_point', p_stop::text,
    jsonb_build_object('revision_id', d.o_draft, 'from_version_id', v_cur.id, 'version_id', v_new, 'changes', v_out));
  return v_new;
end;
$$;
alter function transit.admin_edit_stop(uuid, uuid, jsonb) owner to paranaga_definer;
revoke execute on function transit.admin_edit_stop(uuid, uuid, jsonb) from public;
grant execute on function transit.admin_edit_stop(uuid, uuid, jsonb) to paranaga_app;

-- ---------------------------------------------------------------- reconciliation (A7)
-- Pairs of non-retired stops within 15 m with no decision yet, and every stop's source pins with
-- their distance (the server flags pins far from their stop or with another label). Never merges.
create or replace function transit.admin_reconciliation() returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, transit, ingest, core, pg_temp
as $$
declare
  v_rev transit.revision%rowtype;
begin
  perform transit.admin_assert_staff();
  select * into v_rev from transit.revision r where r.status = 'draft' order by r.seq desc limit 1;
  if not found then
    select r.* into v_rev from transit.published_pointer pp join transit.revision r on r.id = pp.revision_id where pp.singleton;
  end if;
  if v_rev.id is null then
    return jsonb_build_object('revision', null, 'pairs', '[]'::jsonb, 'pins', '[]'::jsonb, 'decisions', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'revision', jsonb_build_object('id', v_rev.id, 'label', v_rev.label, 'kind', v_rev.kind, 'status', v_rev.status),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'a', jsonb_build_object('stopPointId', a.stop_point_id, 'versionId', a.id, 'name', coalesce(a.name, sa.name),
                      'status', a.status, 'layer', a.source_layer, 'code', a.source_code_raw,
                      'lat', extensions.ST_Y(a.geog::extensions.geometry), 'lng', extensions.ST_X(a.geog::extensions.geometry)),
               'b', jsonb_build_object('stopPointId', b.stop_point_id, 'versionId', b.id, 'name', coalesce(b.name, sb.name),
                      'status', b.status, 'layer', b.source_layer, 'code', b.source_code_raw,
                      'lat', extensions.ST_Y(b.geog::extensions.geometry), 'lng', extensions.ST_X(b.geog::extensions.geometry)),
               'distanceM', round(extensions.ST_Distance(a.geog, b.geog)::numeric, 1))
             order by extensions.ST_Distance(a.geog, b.geog), a.source_code_raw, b.source_code_raw)
        from transit.revision_member ma
        join transit.stop_point_version a on a.id = ma.version_id
        join transit.stop_point sa on sa.id = a.stop_point_id
        join transit.revision_member mb on mb.revision_id = ma.revision_id and mb.entity_kind = 'stop_point' and mb.entity_id > ma.entity_id
        join transit.stop_point_version b on b.id = mb.version_id
        join transit.stop_point sb on sb.id = b.stop_point_id
       where ma.revision_id = v_rev.id and ma.entity_kind = 'stop_point'
         and a.status <> 'retired' and b.status <> 'retired'
         and extensions.ST_DWithin(a.geog, b.geog, 15)
         and not exists (select 1 from transit.reconciliation_decision rd
                          where rd.stop_point_a = ma.entity_id and rd.stop_point_b = mb.entity_id)), '[]'::jsonb),
    'pins', coalesce((
      select jsonb_agg(jsonb_build_object('stopPointId', spv.stop_point_id, 'versionId', spv.id, 'name', coalesce(spv.name, sp.name),
               'status', spv.status, 'pinLayer', rf.source_layer, 'pinCode', rf.source_code_raw, 'pinLabel', rf.label_raw,
               'distanceM', round(extensions.ST_Distance(spv.geog,
                              extensions.ST_SetSRID(extensions.ST_MakePoint(rf.lon::float8, rf.lat::float8), 4326)::extensions.geography)::numeric, 1)))
        from transit.revision_member m
        join transit.stop_point_version spv on spv.id = m.version_id
        join transit.stop_point sp on sp.id = spv.stop_point_id
        join transit.stop_point_source s on s.stop_point_version_id = spv.id
        join ingest.raw_feature rf on rf.id = s.raw_feature_id
       where m.revision_id = v_rev.id and m.entity_kind = 'stop_point' and spv.status <> 'retired'), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(x.d order by x.at desc) from (
        select jsonb_build_object('id', rd.id, 'decision', rd.decision, 'rule', rd.rule, 'distanceM', rd.distance_m,
                 'a', coalesce(va.name, sa.name), 'b', coalesce(vb.name, sb.name),
                 'kept', case when rd.kept_stop_point_id is null then null
                              when rd.kept_stop_point_id = rd.stop_point_a then coalesce(va.name, sa.name) else coalesce(vb.name, sb.name) end,
                 'note', rd.note, 'decidedAt', rd.decided_at) as d, rd.decided_at as at
          from transit.reconciliation_decision rd
          join transit.stop_point sa on sa.id = rd.stop_point_a
          join transit.stop_point sb on sb.id = rd.stop_point_b
          left join transit.revision_member ma on ma.revision_id = v_rev.id and ma.entity_kind = 'stop_point' and ma.entity_id = rd.stop_point_a
          left join transit.stop_point_version va on va.id = ma.version_id
          left join transit.revision_member mb on mb.revision_id = v_rev.id and mb.entity_kind = 'stop_point' and mb.entity_id = rd.stop_point_b
          left join transit.stop_point_version vb on vb.id = mb.version_id
         order by rd.decided_at desc limit 50) x), '[]'::jsonb));
end;
$$;
alter function transit.admin_reconciliation() owner to paranaga_definer;
revoke execute on function transit.admin_reconciliation() from public;
grant execute on function transit.admin_reconciliation() to paranaga_app;

-- Link: p_keep stays; the other stop is retired and its source pins are added to the kept stop's
-- new version (provenance never collapses). Keep separate: the decision only. Either way the pair
-- leaves the list. The stop that would be retired may not be in a route's stop order.
create or replace function transit.admin_reconcile(
  p_a uuid, p_expected_a uuid, p_b uuid, p_expected_b uuid, p_decision text, p_keep uuid, p_note text)
returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  da record;
  db record;
  va transit.stop_point_version%rowtype;
  vb transit.stop_point_version%rowtype;
  v_m numeric;
  v_lo uuid := least(p_a, p_b);
  v_hi uuid := greatest(p_a, p_b);
  v_keep_cur transit.stop_point_version%rowtype;
  v_drop_cur transit.stop_point_version%rowtype;
  v_drop uuid;
  v_routes text;
  v_kept_new uuid;
  v_drop_new uuid;
begin
  if p_decision is null or p_decision not in ('link', 'keep_separate') then
    raise exception 'decision must be link or keep_separate' using errcode = '22023';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'pick two different stops' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'the note is longer than 500 characters' using errcode = '22023';
  end if;
  if p_decision = 'link' and (p_keep is null or p_keep not in (p_a, p_b)) then
    raise exception 'say which of the two stops to keep' using errcode = '22023';
  end if;
  -- Lock in id order (two reviewers reconciling the same pair cannot deadlock).
  if p_a < p_b then
    select * into da from transit.admin_draft_stop(p_a, p_expected_a);
    select * into db from transit.admin_draft_stop(p_b, p_expected_b);
  else
    select * into db from transit.admin_draft_stop(p_b, p_expected_b);
    select * into da from transit.admin_draft_stop(p_a, p_expected_a);
  end if;
  select * into va from transit.stop_point_version s where s.id = da.o_version;
  select * into vb from transit.stop_point_version s where s.id = db.o_version;
  if va.status = 'retired' or vb.status = 'retired' then
    raise exception 'one of the stops is already retired' using errcode = '55000';
  end if;
  v_m := round(extensions.ST_Distance(va.geog, vb.geog)::numeric, 1);
  if v_m > 15 then
    raise exception 'only stops within 15 m of each other are reconciled here' using errcode = '22023';
  end if;
  if exists (select 1 from transit.reconciliation_decision rd where rd.stop_point_a = v_lo and rd.stop_point_b = v_hi) then
    raise exception 'these two stops were already reconciled' using errcode = '55000';
  end if;

  if p_decision = 'link' then
    if p_keep = p_a then v_keep_cur := va; v_drop_cur := vb; v_drop := p_b;
    else v_keep_cur := vb; v_drop_cur := va; v_drop := p_a; end if;
    select string_agg(distinct rt.public_code, ', ') into v_routes
      from transit.revision_member vm
      join transit.route_stop rs on rs.variant_version_id = vm.version_id
      join transit.variant v on v.id = vm.entity_id
      join transit.route rt on rt.id = v.route_id
     where vm.revision_id = da.o_draft and vm.entity_kind = 'variant' and rs.stop_point_version_id = v_drop_cur.id;
    if v_routes is not null then
      raise exception 'the stop to retire is in the stop order of %; keep that one instead', v_routes using errcode = '55000';
    end if;
    v_kept_new := transit.admin_copy_stop_version(v_keep_cur.id, '{}'::jsonb, null, null);
    insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id, is_synthetic)
    select v_keep_cur.stop_point_id, v_kept_new, s.raw_feature_id, s.is_synthetic
      from transit.stop_point_source s
     where s.stop_point_version_id = v_drop_cur.id
       and not exists (select 1 from transit.stop_point_source k where k.stop_point_version_id = v_kept_new and k.raw_feature_id = s.raw_feature_id);
    v_drop_new := transit.admin_copy_stop_version(v_drop_cur.id,
      jsonb_build_object('status', 'retired', 'navigation_approved', false,
                         'edit_note', left('linked to ' || coalesce(v_keep_cur.name, (select sp.name from transit.stop_point sp where sp.id = p_keep)), 500)),
      null, null);
    perform transit.admin_repoint_stop(da.o_draft, p_keep, v_keep_cur.id, v_kept_new);
    perform transit.admin_repoint_stop(da.o_draft, v_drop, v_drop_cur.id, v_drop_new);
  end if;

  insert into transit.reconciliation_decision (stop_point_a, stop_point_b, rule, distance_m, decision, kept_stop_point_id, note, revision_id, decided_by)
  values (v_lo, v_hi, case when v_m = 0 then 'same_coordinates' else 'near' end, v_m, p_decision,
          case when p_decision = 'link' then p_keep end, nullif(btrim(coalesce(p_note, '')), ''), da.o_draft, v_user);
  perform core.audit('stop.reconcile', 'transit.stop_point', v_lo::text || ',' || v_hi::text,
    jsonb_build_object('revision_id', da.o_draft, 'decision', p_decision, 'kept', p_keep, 'distance_m', v_m,
                       'kept_version_id', v_kept_new, 'retired_version_id', v_drop_new, 'note', p_note));
  return jsonb_build_object('decision', p_decision, 'keptVersionId', v_kept_new, 'retiredVersionId', v_drop_new);
end;
$$;
alter function transit.admin_reconcile(uuid, uuid, uuid, uuid, text, uuid, text) owner to paranaga_definer;
revoke execute on function transit.admin_reconcile(uuid, uuid, uuid, uuid, text, uuid, text) from public;
grant execute on function transit.admin_reconcile(uuid, uuid, uuid, uuid, text, uuid, text) to paranaga_app;

-- ---------------------------------------------------------------- imports (C2, A2)
create or replace function ingest.admin_import_batches(p_limit integer default 20) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, ingest, transit, core, pg_temp
as $$
begin
  perform transit.admin_assert_staff();
  return coalesce((
    select jsonb_agg(x.j order by x.started_at desc) from (
      select jsonb_build_object('id', b.id, 'snapshotVersion', b.snapshot_version, 'mode', b.mode, 'status', b.status,
               'startedBy', b.started_by,
               'startedAt', b.started_at, 'finishedAt', b.finished_at,
               'fileName', d.file_name, 'sha256', d.sha256,
               'changes', (select jsonb_build_object(
                             'added', count(*) filter (where c.kind = 'added'), 'changed', count(*) filter (where c.kind = 'changed'),
                             'unchanged', count(*) filter (where c.kind = 'unchanged'), 'missing', count(*) filter (where c.kind = 'missing'))
                             from ingest.change c where c.batch_id = b.id),
               'conflicts', (select count(*) from ingest.conflict k where k.batch_id = b.id)) as j,
             b.started_at
        from ingest.batch b
        left join ingest.source_document d on d.id = b.source_document_id
       where split_part(b.snapshot_version, ':', 1) = 'mymaps'
       order by b.started_at desc
       limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb);
end;
$$;
alter function ingest.admin_import_batches(integer) owner to paranaga_definer;
revoke execute on function ingest.admin_import_batches(integer) from public;
grant execute on function ingest.admin_import_batches(integer) to paranaga_app;

-- The newest committed My Maps batch: what the next import is diffed against.
create or replace function ingest.admin_import_baseline() returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, ingest, transit, core, pg_temp
as $$
declare
  v_batch ingest.batch%rowtype;
begin
  perform transit.admin_assert_staff();
  select * into v_batch from ingest.batch b
   where b.mode = 'commit' and b.status = 'committed' and split_part(b.snapshot_version, ':', 1) = 'mymaps'
   order by b.finished_at desc nulls last, b.started_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'batchId', v_batch.id, 'snapshotVersion', v_batch.snapshot_version, 'mapId', split_part(v_batch.snapshot_version, ':', 2),
    'finishedAt', v_batch.finished_at,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('sourceIdentity', rf.source_identity, 'contentHash', rf.content_hash,
               'layer', rf.source_layer, 'code', rf.source_code_raw, 'label', rf.label_raw, 'lat', rf.lat, 'lng', rf.lon)
             order by rf.source_layer, rf.source_code_raw)
        from ingest.raw_feature rf where rf.batch_id = v_batch.id), '[]'::jsonb));
end;
$$;
alter function ingest.admin_import_baseline() owner to paranaga_definer;
revoke execute on function ingest.admin_import_baseline() from public;
grant execute on function ingest.admin_import_baseline() to paranaga_app;

-- The changed-data importer (C2). p_plan is built by the server from the uploaded file
-- (src/domain/admin/imports.ts, the same parsers as scripts/import-naga.ts): mapId,
-- snapshotVersion, retrievedOn, fileName, sha256, bytes, expectedBaselineBatchId, features[]
-- (raw_feature rows), conflicts[]. The change kinds are recomputed here against the baseline's
-- stored content hashes; the client's diff is never trusted.
--   unchanged everywhere → nothing written, outcome "unchanged" (a rerun is idempotent, AC-1);
--   otherwise one transaction: source document, batch, every raw feature, one change per identity
--   (missing ones included), the conflicts, and in the open draft: a new candidate stop per added
--   identity (with lineage), a new version per changed candidate/documentary stop (repointed with
--   the route stop orders that use it). Reviewed stops (installed and up) are never moved by an
--   import: the change is recorded with action kept_reviewed_stop. Missing pins are recorded only;
--   a reviewer retires the stop under Candidates.
create or replace function ingest.admin_import_commit(p_plan jsonb) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, ingest, transit, core, pg_temp
as $$
declare
  v_user text := transit.admin_assert_staff();
  v_map text := p_plan ->> 'mapId';
  v_snapshot text := p_plan ->> 'snapshotVersion';
  v_base ingest.batch%rowtype;
  v_draft uuid;
  v_batch uuid := pg_catalog.gen_random_uuid();
  v_doc uuid;
  v_total integer;
  v_added integer;
  v_changed integer;
  v_unchanged integer;
  v_missing integer;
  v_actions jsonb := '{}'::jsonb;
  f record;
  v_stop uuid;
  v_cur uuid;
  v_status text;
  v_ver uuid;
  v_counts jsonb;
  v_new_stops integer := 0;
  v_new_versions integer := 0;
  v_kept integer := 0;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan -> 'features') is distinct from 'array'
     or jsonb_typeof(p_plan -> 'conflicts') is distinct from 'array'
     or jsonb_array_length(p_plan -> 'features') = 0 or jsonb_array_length(p_plan -> 'features') > 2000
     or v_map is null or v_map !~ '^[A-Za-z0-9_-]{1,100}$'
     or v_snapshot is distinct from ('mymaps:' || v_map || ':' || (p_plan ->> 'retrievedOn'))
     or (p_plan ->> 'retrievedOn') !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_plan ->> 'sha256') !~ '^[0-9a-f]{64}$'
     or coalesce(char_length(p_plan ->> 'fileName'), 0) not between 1 and 200
     or jsonb_typeof(p_plan -> 'bytes') is distinct from 'number' then
    raise exception 'invalid import plan' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_snapshot));
  perform pg_advisory_xact_lock(hashtext(v_map));

  select * into v_base from ingest.batch b
   where b.mode = 'commit' and b.status = 'committed' and split_part(b.snapshot_version, ':', 1) = 'mymaps'
     and split_part(b.snapshot_version, ':', 2) = v_map
   order by b.finished_at desc nulls last, b.started_at desc limit 1;
  if not found then
    raise exception 'this map has no committed import yet; the first import runs from the command line (pnpm db:import --commit)'
      using errcode = '55000';
  end if;
  if v_base.id is distinct from (p_plan ->> 'expectedBaselineBatchId')::uuid then
    raise exception 'another import was committed since the dry run; run the dry run again' using errcode = '55000';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text, identity_method text, source_layer text,
             label_raw text, coordinates_raw text, lon text, lat text, content_hash text, stop_name text)
     where x.source_identity is null or x.source_identity !~ '^[0-9a-f]{64}$'
        or x.content_hash is null or x.content_hash !~ '^[0-9a-f]{64}$'
        or x.identity_method is distinct from 'layer_code_label'
        or x.source_layer is null or x.label_raw is null or x.coordinates_raw is null
        or x.lon is null or x.lon !~ '^-?\d{1,3}(\.\d{1,8})?$' or x.lat is null or x.lat !~ '^-?\d{1,2}(\.\d{1,8})?$'
        or coalesce(char_length(x.stop_name), 0) not between 1 and 200) then
    raise exception 'invalid import plan: a feature is malformed' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_plan -> 'features') as x(lon text, lat text)
     where x.lon::numeric not between 123.05 and 123.40 or x.lat::numeric not between 13.45 and 13.80) then
    raise exception 'a pin is outside the service area' using errcode = '22023';
  end if;
  select count(*) - count(distinct x.source_identity) into v_total
    from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text);
  if v_total > 0 then
    raise exception 'invalid import plan: duplicate source identities' using errcode = '22023';
  end if;

  -- The change kinds, from the stored hashes (never from the caller).
  select count(*), count(*) filter (where b.id is null),
         count(*) filter (where b.id is not null and b.content_hash <> x.content_hash),
         count(*) filter (where b.content_hash = x.content_hash)
    into v_total, v_added, v_changed, v_unchanged
    from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text, content_hash text)
    left join ingest.raw_feature b on b.batch_id = v_base.id and b.source_identity = x.source_identity;
  select count(*) into v_missing
    from ingest.raw_feature b
   where b.batch_id = v_base.id
     and not exists (select 1 from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text)
                      where x.source_identity = b.source_identity);
  if v_added = 0 and v_changed = 0 and v_missing = 0 then
    return jsonb_build_object('outcome', 'unchanged', 'batchId', v_base.id, 'snapshotVersion', v_base.snapshot_version,
      'revisionId', null,
      'counts', jsonb_build_object('raw_features', v_total, 'added', 0, 'changed', 0, 'unchanged', v_unchanged, 'missing', 0));
  end if;
  if exists (select 1 from ingest.batch b where b.snapshot_version = v_snapshot and b.mode = 'commit'
                                            and b.status in ('running', 'committed')) then
    raise exception 'snapshot % was already imported with other content; give this file its own export date', v_snapshot
      using errcode = '55000';
  end if;
  v_draft := transit.admin_open_draft();

  -- ---------------------------------------------------------------- provenance
  insert into ingest.source_document (source_code, file_name, sha256, bytes, retrieved_on)
  values ('S40', p_plan ->> 'fileName', p_plan ->> 'sha256', (p_plan ->> 'bytes')::bigint, (p_plan ->> 'retrievedOn')::date)
  on conflict (file_name, sha256) do nothing
  returning id into v_doc;
  if v_doc is null then
    select d.id into v_doc from ingest.source_document d where d.file_name = p_plan ->> 'fileName' and d.sha256 = p_plan ->> 'sha256';
  end if;
  insert into ingest.batch (id, source_document_id, snapshot_version, mode, status, started_by)
  values (v_batch, v_doc, v_snapshot, 'commit', 'running', v_user);
  insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw, label_raw,
                                  description_raw, coordinates_raw, lon, lat, properties, content_hash)
  select v_batch, x.source_identity, x.identity_method, x.source_layer, x.source_code_raw, x.label_raw, x.description_raw,
         x.coordinates_raw, x.lon::numeric, x.lat::numeric, coalesce(x.properties, '{}'::jsonb), x.content_hash
    from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text, identity_method text, source_layer text,
           source_code_raw text, label_raw text, description_raw text, coordinates_raw text, lon text, lat text,
           properties jsonb, content_hash text);

  -- ---------------------------------------------------------------- the open draft
  for f in
    select x.source_identity, x.source_layer, x.source_code_raw, x.label_raw, x.lon, x.lat, x.content_hash, x.stop_name,
           rf.id as raw_id
      from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text, source_layer text, source_code_raw text,
             label_raw text, lon text, lat text, content_hash text, stop_name text)
      join ingest.raw_feature rf on rf.batch_id = v_batch and rf.source_identity = x.source_identity
      left join ingest.raw_feature b on b.batch_id = v_base.id and b.source_identity = x.source_identity
     where b.id is null or b.content_hash <> x.content_hash
     order by x.source_layer, x.source_code_raw, x.source_identity
  loop
    v_stop := null;
    v_cur := null;
    v_status := null;
    select l.stop_point_id into v_stop from ingest.raw_feature_lineage l where l.source_identity = f.source_identity;
    if v_stop is null then
      -- A new pin: one candidate stop per raw feature, never merged by name or distance (spec 04 §4.7).
      v_stop := pg_catalog.gen_random_uuid();
      v_ver := pg_catalog.gen_random_uuid();
      insert into transit.stop_point (id, name) values (v_stop, f.stop_name);
      insert into transit.stop_point_version (id, stop_point_id, geog, status, source_layer, source_code_raw, label_raw, content_hash)
      values (v_ver, v_stop,
              extensions.ST_SetSRID(extensions.ST_MakePoint(f.lon::float8, f.lat::float8), 4326)::extensions.geography,
              'candidate', f.source_layer, f.source_code_raw, f.label_raw, f.content_hash);
      insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values (v_stop, v_ver, f.raw_id);
      insert into ingest.raw_feature_lineage (source_identity, stop_point_id) values (f.source_identity, v_stop);
      insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values (v_draft, 'stop_point', v_stop, v_ver);
      v_new_stops := v_new_stops + 1;
      v_actions := v_actions || jsonb_build_object(f.source_identity, 'new_candidate');
    else
      select m.version_id, s.status into v_cur, v_status
        from transit.revision_member m
        join transit.stop_point_version s on s.id = m.version_id
       where m.revision_id = v_draft and m.entity_kind = 'stop_point' and m.entity_id = v_stop
         for update of m;
      if v_cur is null then
        v_actions := v_actions || jsonb_build_object(f.source_identity, 'stop_not_in_draft');
      elsif v_status in ('candidate', 'documentary') then
        -- The same content seen before (a pin moved back): reuse that version.
        select s.id into v_ver from transit.stop_point_version s where s.stop_point_id = v_stop and s.content_hash = f.content_hash;
        if v_ver is null then
          v_ver := transit.admin_copy_stop_version(v_cur,
            jsonb_build_object('lat', f.lat::float8, 'lng', f.lon::float8, 'source_layer', f.source_layer,
                               'source_code_raw', f.source_code_raw, 'label_raw', f.label_raw, 'content_hash', f.content_hash,
                               'edit_note', 'import ' || v_snapshot),
            array['curb_position'], f.source_identity);
          insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values (v_stop, v_ver, f.raw_id);
        end if;
        perform transit.admin_repoint_stop(v_draft, v_stop, v_cur, v_ver);
        v_new_versions := v_new_versions + 1;
        v_actions := v_actions || jsonb_build_object(f.source_identity, 'new_version');
      else
        v_kept := v_kept + 1;
        v_actions := v_actions || jsonb_build_object(f.source_identity, 'kept_reviewed_stop');
      end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------- changes and conflicts
  insert into ingest.change (batch_id, source_identity, kind, diff)
  select v_batch, x.source_identity,
         case when b.id is null then 'added' when b.content_hash = x.content_hash then 'unchanged' else 'changed' end,
         case when b.id is null then
                jsonb_strip_nulls(jsonb_build_object('action', v_actions ->> x.source_identity,
                  'to', jsonb_build_object('layer', x.source_layer, 'code', x.source_code_raw, 'label', x.label_raw,
                                           'lat', x.lat::numeric, 'lng', x.lon::numeric)))
              when b.content_hash = x.content_hash then null
              else jsonb_strip_nulls(jsonb_build_object('action', v_actions ->> x.source_identity,
                  'from', jsonb_build_object('layer', b.source_layer, 'code', b.source_code_raw, 'label', b.label_raw, 'lat', b.lat, 'lng', b.lon),
                  'to', jsonb_build_object('layer', x.source_layer, 'code', x.source_code_raw, 'label', x.label_raw,
                                           'lat', x.lat::numeric, 'lng', x.lon::numeric),
                  'movedM', round(extensions.ST_Distance(
                    extensions.ST_SetSRID(extensions.ST_MakePoint(b.lon::float8, b.lat::float8), 4326)::extensions.geography,
                    extensions.ST_SetSRID(extensions.ST_MakePoint(x.lon::float8, x.lat::float8), 4326)::extensions.geography)::numeric, 1)))
         end
    from jsonb_to_recordset(p_plan -> 'features') as x(source_identity text, source_layer text, source_code_raw text,
           label_raw text, lon text, lat text, content_hash text)
    left join ingest.raw_feature b on b.batch_id = v_base.id and b.source_identity = x.source_identity;
  insert into ingest.change (batch_id, source_identity, kind, diff)
  select v_batch, b.source_identity, 'missing',
         jsonb_build_object('action', 'review_retire',
           'from', jsonb_build_object('layer', b.source_layer, 'code', b.source_code_raw, 'label', b.label_raw, 'lat', b.lat, 'lng', b.lon))
    from ingest.raw_feature b
   where b.batch_id = v_base.id
     and not exists (select 1 from ingest.raw_feature n where n.batch_id = v_batch and n.source_identity = b.source_identity);
  insert into ingest.conflict (batch_id, kind, refs, detail)
  select v_batch, c.kind, array(select jsonb_array_elements_text(c.refs)), coalesce(c.detail, '{}'::jsonb)
    from jsonb_to_recordset(p_plan -> 'conflicts') as c(kind text, refs jsonb, detail jsonb);

  v_counts := jsonb_build_object('raw_features', v_total, 'added', v_added, 'changed', v_changed, 'unchanged', v_unchanged,
    'missing', v_missing, 'conflicts', jsonb_array_length(p_plan -> 'conflicts'), 'new_candidate_stops', v_new_stops,
    'new_stop_versions', v_new_versions, 'kept_reviewed_stops', v_kept, 'documents_sha256', p_plan ->> 'sha256',
    'revision_id', v_draft);
  update ingest.batch b set status = 'committed', counts = v_counts, finished_at = now() where b.id = v_batch;
  perform core.audit('import.commit', 'ingest.batch', v_batch::text,
    v_counts || jsonb_build_object('snapshot_version', v_snapshot, 'file_name', p_plan ->> 'fileName'));
  return jsonb_build_object('outcome', 'committed', 'batchId', v_batch, 'snapshotVersion', v_snapshot, 'revisionId', v_draft,
    'counts', v_counts);
end;
$$;
alter function ingest.admin_import_commit(jsonb) owner to paranaga_definer;
revoke execute on function ingest.admin_import_commit(jsonb) from public;
grant execute on function ingest.admin_import_commit(jsonb) to paranaga_app;

-- ---------------------------------------------------------------- validation facts (C8 + the stop rules)
-- Same as 0023 except the stops: version name, status, curb side, evidence claims, metres moved since
-- the parent revision's version of the stop, and whether a member variant's stop order uses it.
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
               'code', spv.source_code_raw, 'name', coalesce(spv.name, sp.name),
               'lat', extensions.ST_Y(spv.geog::extensions.geometry), 'lng', extensions.ST_X(spv.geog::extensions.geometry),
               -- 0024 (N5b): what the stop rules need.
               'status', spv.status, 'curbSide', spv.curb_side,
               'evidenceClaims', coalesce((select jsonb_agg(distinct l.claim) from transit.evidence_link l
                                            where l.stop_point_version_id = spv.id), '[]'::jsonb),
               'movedM', (select round(extensions.ST_Distance(pv.geog, spv.geog)::numeric, 1)
                            from transit.revision_member pm
                            join transit.stop_point_version pv on pv.id = pm.version_id
                           where pm.revision_id = v_rev.parent_revision_id and pm.entity_kind = 'stop_point'
                             and pm.entity_id = spv.stop_point_id and pm.version_id <> spv.id),
               'inSequence', exists (select 1 from transit.revision_member vm
                                      join transit.route_stop rs on rs.variant_version_id = vm.version_id
                                     where vm.revision_id = p_revision and vm.entity_kind = 'variant'
                                       and rs.stop_point_version_id = spv.id)))
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


revoke create on schema ingest from paranaga_definer;
revoke create on schema transit from paranaga_definer;
