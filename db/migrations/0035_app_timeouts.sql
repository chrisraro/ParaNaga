-- 0035_app_timeouts.sql
-- docs/ERD.md O3: a slow statement or a blocked lock must not hold one of the pool's connections
-- until the function is killed. Role settings, because the pooled endpoint (PgBouncer, transaction
-- mode) does not keep session settings; they apply to server connections opened after this.
-- The app answers 503 for both (55P03, 57014: src/server/db/pg-error.ts). paranaga_import and the
-- owner (migrations, CLI imports) keep no limit.
--
-- Rollback:
--   alter role paranaga_app reset statement_timeout; alter role paranaga_app reset lock_timeout;
--   delete from public.schema_migrations where name = '0035_app_timeouts.sql';

alter role paranaga_app set statement_timeout = '15s';
alter role paranaga_app set lock_timeout = '5s';
