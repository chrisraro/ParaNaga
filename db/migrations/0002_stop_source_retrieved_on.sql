-- 0002_stop_source_retrieved_on.sql
-- Exposes the retrieved date of the snapshot each published source pin came from, so the stop
-- screen can say "Source: public My Maps snapshot (<date>)" from the data instead of hard-coding
-- it. The date lives on ingest.source_document (already public to paranaga_app); the link from a
-- raw feature to its document goes through ingest.batch, which stays internal: paranaga_app gets
-- only the two link columns (never started_by, counts or status), so `select *` is still denied.

grant select (id, source_document_id) on ingest.batch to paranaga_app;
create policy public_read_link on ingest.batch for select to paranaga_app using (true);

-- Same columns as 0001, plus retrieved_on appended (CREATE OR REPLACE may only add columns at
-- the end). NULL when the batch has no source document or the document has no retrieved date.
create or replace view transit.v_published_stop_sources with (security_invoker = true) as
select pp.revision_id, sp.id as stop_point_id, rf.id as raw_feature_id, rf.source_layer, rf.source_code_raw,
       rf.label_raw, rf.description_raw, rf.coordinates_raw, rf.lon, rf.lat, rf.created_at,
       sd.retrieved_on
  from transit.published_pointer pp
  join transit.revision_member m on m.revision_id = pp.revision_id and m.entity_kind = 'stop_point'
  join transit.stop_point sp on sp.id = m.entity_id
  join transit.stop_point_version spv on spv.id = m.version_id and spv.stop_point_id = sp.id
  join transit.stop_point_source sps on sps.stop_point_version_id = spv.id and sps.stop_point_id = sp.id
  join ingest.raw_feature rf on rf.id = sps.raw_feature_id
  left join ingest.batch b on b.id = rf.batch_id
  left join ingest.source_document sd on sd.id = b.source_document_id
 where not sp.is_synthetic and not spv.is_synthetic and not sps.is_synthetic;

grant select on transit.v_published_stop_sources to paranaga_app;
