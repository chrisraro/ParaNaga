-- 0034_narrow_grants.sql
-- docs/ERD.md S1 to S3: the app role keeps only the privileges its code uses. Policies are unchanged.
-- S1. core.profile: only the two fields a person may edit; never suspended_until or deleted_at.
-- S2. ops.job: only run_after, which the enqueue upsert (src/server/jobs/worker.ts) moves forward.
--     Claiming, heartbeats and finishing go through definer functions (paranaga_definer, 0021).
-- S3. Three reviewer queues nothing calls any more, kept but closed as 0030 did. Live paths:
--     community.admin_corrections, community.admin_moderation_queue (0025), priv.review_list (0026).
--
-- Rollback:
--   grant update on core.profile, ops.job to paranaga_app;
--   grant execute on function community.review_queue(integer), community.content_review_queue(integer),
--     priv.review_queue(integer) to paranaga_app;
--   delete from public.schema_migrations where name = '0034_narrow_grants.sql';

set local lock_timeout = '5s';

revoke update on core.profile from paranaga_app;
grant update (display_name, locale) on core.profile to paranaga_app;

revoke update on ops.job from paranaga_app;
grant update (run_after) on ops.job to paranaga_app;

revoke execute on function community.review_queue(integer) from public, paranaga_app;
revoke execute on function community.content_review_queue(integer) from public, paranaga_app;
revoke execute on function priv.review_queue(integer) from public, paranaga_app;
