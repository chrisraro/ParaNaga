-- 0012_places_google_guard.sql
-- Increment E2, Task 15: the cost guard of the Google Places proxy (/api/v1/places/*). Additive.
--   - ops.places_daily_usage: Google calls taken per Asia/Manila day. paranaga_app has NO table
--     privileges; it takes a call only through ops.places_take_call (SECURITY DEFINER), which
--     refuses once the cap (passed by the app, constant GOOGLE_DAILY_CAP = 300, at most 1000) is reached.
--   - ops.places_cache: answers cached by a keyed hash (HMAC-SHA-256 under the server key) of the
--     normalized query + bias or of the place id. No query text, no IP address. Payloads are
--     Google suggestions (place id, title, subtitle) or a point, re-validated by the app on read.
-- The per-address rate limit reuses ops.rate_limit_bucket (0000) with 'places:'-prefixed keyed hashes.
-- Same RLS rule as every table: enabled and forced.

create table ops.places_daily_usage (
  day   date primary key,
  calls integer not null default 0 check (calls >= 0)
);

create table ops.places_cache (
  key_hash   text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  payload    jsonb not null check (octet_length(payload::text) <= 8192),
  expires_at timestamptz not null
);
create index places_cache_expires_idx on ops.places_cache (expires_at);

grant select, insert, update, delete on ops.places_cache to paranaga_app;
grant select, insert, update on ops.places_daily_usage to paranaga_definer;

alter table ops.places_daily_usage enable row level security;
alter table ops.places_daily_usage force row level security;
alter table ops.places_cache enable row level security;
alter table ops.places_cache force row level security;

create policy places_usage_definer on ops.places_daily_usage for all to paranaga_definer using (true) with check (true);
create policy places_cache_app on ops.places_cache for all to paranaga_app using (true) with check (true);

-- ALTER FUNCTION … OWNER TO needs CREATE on the schema for the new owner; revoked again below.
grant create on schema ops to paranaga_definer;

-- One call from today's budget: true if taken, false at the cap (the counter never passes it).
create function ops.places_take_call(p_cap integer) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, ops, pg_temp
as $$
declare
  v_calls integer;
begin
  if p_cap is null or p_cap < 0 or p_cap > 1000 then
    raise exception 'cap must be between 0 and 1000' using errcode = '22023';
  end if;
  if p_cap = 0 then
    return false;
  end if;
  insert into ops.places_daily_usage as u (day, calls)
  values ((now() at time zone 'Asia/Manila')::date, 1)
  on conflict (day) do update set calls = u.calls + 1 where u.calls < p_cap
  returning u.calls into v_calls;
  return v_calls is not null;
end
$$;
alter function ops.places_take_call(integer) owner to paranaga_definer;

revoke create on schema ops from paranaga_definer;

revoke execute on function ops.places_take_call(integer) from public;
grant execute on function ops.places_take_call(integer) to paranaga_app;
