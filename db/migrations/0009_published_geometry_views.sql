-- 0009_published_geometry_views.sql
-- All modes, Increment D, Task 7: the published read model of the 0007 objects (approximate paths,
-- the walk graph and the time-estimate parameters). Views only. Same pattern as 0008:
-- security_invoker = true, every view starts from published_pointer → revision_member and hides
-- synthetic rows (identity or version), so drafts and test data never leak.

-- ================================================================ approximate paths
-- One row per shape member: traced (ok / flagged, with the line) or untraced (no line, a reason).
create view transit.v_published_shapes with (security_invoker = true) as
select pp.revision_id, s.id as shape_id, sv.id as shape_version_id, s.variant_id, sv.variant_version_id,
       v.route_id, r.public_code as route_code, sv.trace_status, sv.flag_reason, sv.untraced_reason,
       extensions.ST_AsGeoJSON(sv.geog::extensions.geometry, 6) as geojson,
       sv.length_m, sv.stop_measures, sv.off_list_segments, sv.trace_quality, sv.label, sv.approximate,
       sv.evidence_kind, sv.road_source_code
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'shape'
  join transit.shape s on s.id = m.entity_id
  join transit.shape_version sv on sv.id = m.version_id and sv.shape_id = s.id
  join transit.variant v on v.id = s.variant_id
  join transit.route r on r.id = v.route_id
 where not s.is_synthetic and not sv.is_synthetic and not v.is_synthetic and not r.is_synthetic;

-- ================================================================ walk graph
create view transit.v_published_walk_graph with (security_invoker = true) as
select pp.revision_id, g.id as walk_graph_id, gv.id as walk_graph_version_id, g.key, gv.format_version, gv.payload,
       gv.bytes, gv.gzip_bytes, gv.sha256, gv.node_count, gv.edge_count, gv.road_source_code, gv.builder_version
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'walk_graph'
  join transit.walk_graph g on g.id = m.entity_id
  join transit.walk_graph_version gv on gv.id = m.version_id and gv.walk_graph_id = g.id
 where not g.is_synthetic and not gv.is_synthetic;

-- ================================================================ time-estimate parameters
create view transit.v_published_eta_params with (security_invoker = true) as
select pp.revision_id, p.id as eta_param_id, pv.id as eta_param_version_id, p.key, pv.value_low, pv.value_high,
       pv.unit, pv.windows, pv.days, pv.applies_to, pv.is_assumption, pv.assumption_note, pv.basis, pv.source_codes
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'eta_param'
  join transit.eta_param p on p.id = m.entity_id
  join transit.eta_param_version pv on pv.id = m.version_id and pv.eta_param_id = p.id
 where not p.is_synthetic and not pv.is_synthetic;

-- ================================================================ sources register
-- Also cites the road snapshot (OSMR-…) behind the paths and the walk graph, and the sources of
-- the time-estimate parameters. Same columns as 0008.
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
                where jsonb_typeof(e.value) = 'array'
         union select x.road_source_code from transit.v_published_shapes x
         union select x.road_source_code from transit.v_published_walk_graph x
         union select unnest(x.source_codes) from transit.v_published_eta_params x);

grant select on transit.v_published_shapes, transit.v_published_walk_graph, transit.v_published_eta_params,
  transit.v_published_sources
  to paranaga_app;
