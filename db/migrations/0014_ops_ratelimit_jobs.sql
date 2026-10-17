-- 0014_ops_ratelimit_jobs.sql
-- Increment B, Task B3: Rate limiting definer function & background job worker queue.
--   - ops.take_token(p_key_hash, p_window_seconds, p_limit):
--     Fixed-window token-bucket rate limiter with atomic upsert and count check.
--     Returns true if request permitted, false if limit reached.
--   - ops.purge_rate_limit_buckets(p_older_than_interval):
--     Purges expired rate limit window rows older than specified interval.
--   - ops.claim_jobs(p_worker_id, p_limit, p_lease_seconds):
--     Claims queued/retry/expired running jobs atomically using FOR UPDATE SKIP LOCKED.
--   - ops.heartbeat_job(p_job_id, p_worker_id, p_lease_seconds):
--     Extends lease on a currently held running job.
--   - ops.finish_job(p_job_id, p_worker_id, p_status, p_error_code, p_retry_delay_seconds):
--     Finishes job with status 'done', 'retry' (with run_after backoff), or 'dead'.

grant create on schema ops to paranaga_definer;

-- ---------------------------------------------------------------- Rate Limiting
create or replace function ops.take_token(
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_window_seconds <= 0 or p_limit <= 0 then
    return false;
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into ops.rate_limit_bucket as b (key_hash, window_start, count)
  values (p_key_hash, v_window_start, 1)
  on conflict (key_hash, window_start)
  do update set count = b.count + 1
  where b.count < p_limit
  returning b.count into v_count;

  return v_count is not null;
end;
$$;
alter function ops.take_token(text, integer, integer) owner to paranaga_definer;
revoke execute on function ops.take_token(text, integer, integer) from public;
grant execute on function ops.take_token(text, integer, integer) to paranaga_app;

create or replace function ops.purge_rate_limit_buckets(
  p_older_than interval default interval '2 days'
) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ops.rate_limit_bucket
   where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ops.purge_rate_limit_buckets(interval) owner to paranaga_definer;
revoke execute on function ops.purge_rate_limit_buckets(interval) from public;
grant execute on function ops.purge_rate_limit_buckets(interval) to paranaga_app;

-- ---------------------------------------------------------------- Job Queue
create or replace function ops.claim_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns setof ops.job
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
begin
  return query
  update ops.job
     set status = 'running',
         locked_until = now() + (p_lease_seconds || ' seconds')::interval,
         locked_by = p_worker_id,
         attempts = attempts + 1
   where id in (
     select j.id
       from ops.job j
      where j.status in ('queued', 'retry', 'running')
        and j.run_after <= now()
        and (j.locked_until is null or j.locked_until < now())
      order by j.run_after
      for update skip locked
      limit p_limit
   )
  returning *;
end;
$$;
alter function ops.claim_jobs(text, integer, integer) owner to paranaga_definer;
revoke execute on function ops.claim_jobs(text, integer, integer) from public;
grant execute on function ops.claim_jobs(text, integer, integer) to paranaga_app;

create or replace function ops.heartbeat_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
declare
  v_updated integer;
begin
  update ops.job
     set locked_until = now() + (p_lease_seconds || ' seconds')::interval
   where id = p_job_id
     and locked_by = p_worker_id
     and status = 'running';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
alter function ops.heartbeat_job(uuid, text, integer) owner to paranaga_definer;
revoke execute on function ops.heartbeat_job(uuid, text, integer) from public;
grant execute on function ops.heartbeat_job(uuid, text, integer) to paranaga_app;

create or replace function ops.finish_job(
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_error_code text default null,
  p_retry_delay_seconds integer default 60
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
declare
  v_max_attempts integer;
  v_attempts integer;
  v_new_status text := p_status;
  v_run_after timestamptz := now();
  v_finished_at timestamptz := null;
  v_updated integer;
begin
  select attempts, max_attempts into v_attempts, v_max_attempts
    from ops.job
   where id = p_job_id;

  if not found then
    return false;
  end if;

  if p_status = 'done' then
    v_finished_at := now();
  elsif p_status = 'retry' then
    if v_attempts >= v_max_attempts then
      v_new_status := 'dead';
      v_finished_at := now();
    else
      v_run_after := now() + (p_retry_delay_seconds || ' seconds')::interval;
    end if;
  elsif p_status = 'dead' then
    v_finished_at := now();
  end if;

  update ops.job
     set status = v_new_status,
         locked_until = null,
         locked_by = null,
         last_error_code = p_error_code,
         run_after = v_run_after,
         finished_at = coalesce(v_finished_at, finished_at)
   where id = p_job_id
     and locked_by = p_worker_id
     and status = 'running';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
alter function ops.finish_job(uuid, text, text, text, integer) owner to paranaga_definer;
revoke execute on function ops.finish_job(uuid, text, text, text, integer) from public;
grant execute on function ops.finish_job(uuid, text, text, text, integer) to paranaga_app;

revoke create on schema ops from paranaga_definer;
