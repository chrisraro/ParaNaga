-- 0008_published_mode_views.sql
-- All modes, Increment D, Task 3: the published read model for the 0006 objects. Views only, no
-- tables or data. Same pattern as 0001/0003/0004: security_invoker = true (the caller's grants and
-- RLS apply), every view starts from published_pointer → revision_member and hides synthetic rows
-- (stable or version), so drafts and test data never leak. (0007 is reserved for the shapes, walk
-- graph and time-estimate tables of Task 7; their views are added there.)
--
-- CREATE OR REPLACE keeps every existing column, in order and type, and only appends columns, so
-- the views that depend on these (v_published_sources) and the existing readers are unaffected.

-- ================================================================ routes and variants: new columns
create or replace view transit.v_published_routes with (security_invoker = true) as
select pp.revision_id, t.id, t.public_code, t.official_group_number, t.name, t.mode_code, t.legal_status,
       t.allocated_units, t.allocation_is_active_fleet_count, t.notes, t.source_codes, t.properties,
       t.mode, t.service_status, t.planning
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route'
  join transit.route t on t.id = m.entity_id
 where not t.is_synthetic;

create or replace view transit.v_published_variants with (security_invoker = true) as
select pp.revision_id, vv.id as variant_version_id, v.id as variant_id, v.route_id, v.direction, v.kind,
       vv.headsign, vv.vehicle_class, vv.legal_streets, vv.trial_status, vv.effective_from,
       vv.trial_duration_days, vv.operating_status, vv.evidence_level, vv.is_circular,
       vv.navigation_approved, vv.source_codes, vv.notes,
       v.name, vv.anchors
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'variant'
  join transit.variant v on v.id = m.entity_id
  join transit.variant_version vv on vv.id = m.version_id and vv.variant_id = v.id
 where not v.is_synthetic and not vv.is_synthetic;

-- ================================================================ terminals: version-aware (D17)
-- A member whose version_id equals its entity_id is the legacy transit.terminal row (revisions
-- published before the modes seed, so a rollback still reads them as before); any other member
-- must be a terminal_version row of that terminal (publish_revision enforces it; a member that is
-- neither is hidden here). Version rows win over the legacy row for every shared column; the
-- coordinate is the version's OpenStreetMap coordinate (with its provenance) or the legacy geog.
create or replace view transit.v_published_terminals with (security_invoker = true) as
select pp.revision_id, t.id, t.code,
       case when tv.id is null then t.name else tv.name end as name,
       case when tv.id is null then t.location_text else tv.location_text end as location_text,
       case when tv.id is null then t.modes else tv.modes end as modes,
       case when tv.id is null then t.evidence_status else tv.verification end as evidence_status,
       case when tv.id is null then t.notes else tv.notes end as notes,
       extensions.ST_X((case when tv.id is null then t.geog else tv.geog end)::extensions.geometry) as lon,
       extensions.ST_Y((case when tv.id is null then t.geog else tv.geog end)::extensions.geometry) as lat,
       case when tv.id is null then t.source_codes else tv.source_codes end as source_codes,
       m.version_id, tv.kind, tv.modes_raw, tv.mode_sources, tv.coord_source, tv.osm_type, tv.osm_id,
       tv.osm_version, tv.osm_timestamp, tv.coord_note, tv.verification, tv.status_note
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'terminal'
  join transit.terminal t on t.id = m.entity_id
  left join transit.terminal_version tv on tv.id = m.version_id and tv.terminal_id = t.id
 where not t.is_synthetic
   and ((m.version_id = m.entity_id and tv.id is null) or (tv.id is not null and not tv.is_synthetic));

-- ================================================================ per-route records (unversioned)
-- The member's version_id equals its entity_id; rows are immutable once written.
create view transit.v_published_route_vehicle_classes with (security_invoker = true) as
select pp.revision_id, c.id, c.route_id, c.code, c.vehicle_class, c.evidence_levels, c.status,
       c.first_reported_on, c.last_reported_on, c.units_note, c.aircon, c.aircon_source_codes,
       c.cooperatives, c.notes, c.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route_vehicle_class'
  join transit.route_vehicle_class c on c.id = m.entity_id
 where not c.is_synthetic;

-- Cooperative names only: there is no chair or address column to select (C8).
create view transit.v_published_route_cooperatives with (security_invoker = true) as
select pp.revision_id, c.id, c.route_id, c.name, c.basis, c.reported_on, c.notes, c.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route_cooperative'
  join transit.route_cooperative c on c.id = m.entity_id
 where not c.is_synthetic;

create view transit.v_published_route_operating_statuses with (security_invoker = true) as
select pp.revision_id, s.id, s.route_id, s.operating_status, s.status_note, s.confirmed_on, s.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route_operating_status'
  join transit.route_operating_status s on s.id = m.entity_id
 where not s.is_synthetic;

create view transit.v_published_route_fare_observations with (security_invoker = true) as
select pp.revision_id, o.id, o.route_id, o.code, o.vehicle_class, o.kind, o.relative_to, o.delta_qualifier,
       o.delta_centavos_low, o.delta_centavos_high, o.observed_on, o.report_text, o.notes, o.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'route_fare_observation'
  join transit.route_fare_observation o on o.id = m.entity_id
 where not o.is_synthetic;

-- ================================================================ regional services (versioned)
create view transit.v_published_regional_services with (security_invoker = true) as
select pp.revision_id, s.id as regional_service_id, v.id as regional_service_version_id, s.code, v.mode, v.name,
       v.operators, v.terminal_code, v.terminal_note, v.destination, v.osm_relation_ids, v.osm_relation_versions,
       v.distance_km, v.distance_basis, v.status, v.fare_rule_codes, v.notes, v.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'regional_service'
  join transit.regional_service s on s.id = m.entity_id
  join transit.regional_service_version v on v.id = m.version_id and v.regional_service_id = s.id
 where not s.is_synthetic and not v.is_synthetic;

-- ================================================================ sources register
-- Also cites the sources behind the new views (vehicle classes and their aircon sources,
-- cooperatives, operating statuses, fare observations, regional services, per-mode terminal sources).
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
         union select unnest(x.source_codes) from transit.v_published_feeder_leads x
         union select unnest(x.source_codes) from transit.v_published_route_vehicle_classes x
         union select unnest(x.aircon_source_codes) from transit.v_published_route_vehicle_classes x
         union select unnest(x.source_codes) from transit.v_published_route_cooperatives x
         union select unnest(x.source_codes) from transit.v_published_route_operating_statuses x
         union select unnest(x.source_codes) from transit.v_published_route_fare_observations x
         union select unnest(x.source_codes) from transit.v_published_regional_services x
         union select jsonb_array_elements_text(e.value)
                 from transit.v_published_terminals x
                 cross join lateral jsonb_each(coalesce(x.mode_sources, '{}'::jsonb)) e
                where jsonb_typeof(e.value) = 'array');

grant select on transit.v_published_route_vehicle_classes, transit.v_published_route_cooperatives,
  transit.v_published_route_operating_statuses, transit.v_published_route_fare_observations,
  transit.v_published_regional_services, transit.v_published_routes, transit.v_published_variants,
  transit.v_published_terminals, transit.v_published_sources
  to paranaga_app;
