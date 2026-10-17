-- 0021_ops_definer_grants.sql
-- Fixes 0014: ops.take_token, ops.purge_rate_limit_buckets, ops.claim_jobs, ops.heartbeat_job and
-- ops.finish_job are SECURITY DEFINER functions owned by paranaga_definer, but 0000 only granted the
-- tables to paranaga_app (with forced RLS and policies for paranaga_app alone). Run as the definer,
-- every call failed with "permission denied for table rate_limit_bucket", so POST /api/v1/plan
-- returned 500 for every request. Give the definer role exactly what those functions touch.

-- Rate limiter: insert / update (upsert), delete (purge), select.
grant select, insert, update, delete on ops.rate_limit_bucket to paranaga_definer;
create policy rate_limit_definer on ops.rate_limit_bucket for all to paranaga_definer using (true) with check (true);

-- Job queue: claim_jobs / heartbeat_job / finish_job read and update rows; they never insert or remove any.
grant select, update on ops.job to paranaga_definer;
create policy job_definer_read on ops.job for select to paranaga_definer using (true);
create policy job_definer_update on ops.job for update to paranaga_definer using (true) with check (true);
