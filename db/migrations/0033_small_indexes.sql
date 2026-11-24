-- 0033_small_indexes.sql
-- docs/ERD.md I3 and I4: two indexes on small tables. Nothing else changes.
-- 1. evidence_access by complaint: priv.review_complaint (last 50), priv.retention_purge_complaint
--    and the cascade from priv.complaint.
-- 2. moderation_decision by date: the history in community.admin_moderation_queue.
-- lock_timeout 5 s: a plain build waits for running writes; give up rather than queue others behind it.
--
-- Rollback:
--   drop index priv.evidence_access_complaint_idx; drop index community.moderation_decision_created_idx;
--   delete from public.schema_migrations where name = '0033_small_indexes.sql';

set local lock_timeout = '5s';

create index evidence_access_complaint_idx on priv.evidence_access (complaint_id, issued_at desc);
create index moderation_decision_created_idx on community.moderation_decision (created_at desc);
