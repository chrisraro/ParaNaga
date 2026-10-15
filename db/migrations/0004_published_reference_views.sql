-- 0004_published_reference_views.sql
-- Published read model for the reference data behind Search, Place/Terminal detail, Explore and
-- Help (Increment A, Task 4). Views only, no tables or data: same pattern as 0001/0003 —
-- security_invoker = true (the caller's grants and RLS apply), each view starts from
-- published_pointer → revision_member and hides synthetic rows, so drafts and test data never leak.
-- These entity kinds have no version table: the member's version_id equals its entity_id.
-- None of these rows has a coordinate; none is invented here.

create view transit.v_published_barangays with (security_invoker = true) as
select pp.revision_id, t.id, t.name, t.psgc_code, t.survey_status, t.source_code
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'barangay'
  join transit.barangay t on t.id = m.entity_id
 where not t.is_synthetic;

-- Label-only records from the 2025 LPTRP SimEx (S33/S34): schematic labels, not curbs.
create view transit.v_published_designated_stop_candidates with (security_invoker = true) as
select pp.revision_id, t.id, t.code, t.label_raw, t.label_type, t.route_code, t.direction, t.source_ids,
       t.source_context, t.operating_status
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'designated_stop_candidate'
  join transit.designated_stop_candidate t on t.id = m.entity_id
 where not t.is_synthetic;

create view transit.v_published_destination_categories with (security_invoker = true) as
select pp.revision_id, t.id, t.category, t.destinations, t.candidate_terminal_code, t.evidence_status, t.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'external_destination_category'
  join transit.external_destination_category t on t.id = m.entity_id
 where not t.is_synthetic;

-- Fares are not exposed here (fare_centavos stays in the base table; no feeder fare is on file).
create view transit.v_published_feeder_leads with (security_invoker = true) as
select pp.revision_id, t.id, t.code, t.name, t.notes, t.operating_status, t.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'feeder_lead'
  join transit.feeder_lead t on t.id = m.entity_id
 where not t.is_synthetic;

-- The sources register also cites the sources behind the four reference views above.
create or replace view transit.v_published_sources with (security_invoker = true) as
select pp.revision_id, s.code, s.title, s.url, s.evidence_type, s.published_or_enacted, s.checked_on
  from transit.published_pointer pp
  join ingest.source s on s.code in (
         select unnest(x.source_codes) from transit.v_published_routes x
         union select unnest(x.source_codes) from transit.v_published_variants x
         union select unnest(x.source_codes) from transit.v_published_fare_rules x
         union select unnest(x.source_codes) from transit.v_published_fare_observations x
         union select unnest(x.source_codes) from transit.v_published_terminals x
         union select x.source_code from transit.v_published_route_aliases x where x.source_code is not null
         union select x.source_code from transit.v_published_places x
         union select x.source_code from transit.v_published_barangays x where x.source_code is not null
         union select unnest(x.source_ids) from transit.v_published_designated_stop_candidates x
         union select unnest(x.source_codes) from transit.v_published_destination_categories x
         union select unnest(x.source_codes) from transit.v_published_feeder_leads x);

grant select on transit.v_published_barangays, transit.v_published_designated_stop_candidates,
  transit.v_published_destination_categories, transit.v_published_feeder_leads, transit.v_published_sources
  to paranaga_app;
