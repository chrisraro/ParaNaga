// CI gate (spec §5.5, §5.13): every table in app schemas has RLS enabled AND forced,
// and every SECURITY DEFINER function pins search_path (pg_temp last) and is not
// executable by PUBLIC.
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is required.");
  process.exit(1);
}

const APP_SCHEMAS = ["core", "ingest", "transit", "community", "priv", "ops"];
const client = new pg.Client({ connectionString: url });
await client.connect();

const problems: string[] = [];
try {
  const tables = await client.query<{ name: string; rls: boolean; forced: boolean }>(
    `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname = any($1)
      order by 1`,
    [APP_SCHEMAS],
  );
  for (const t of tables.rows) {
    if (!t.rls) problems.push(`${t.name}: row level security not enabled`);
    if (!t.forced) problems.push(`${t.name}: row level security not forced`);
  }

  const fns = await client.query<{ name: string; config: string[] | null; public_exec: boolean }>(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
            p.proconfig as config,
            has_function_privilege('public', p.oid, 'execute') as public_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = any($1)
      order by 1`,
    [APP_SCHEMAS],
  );
  for (const f of fns.rows) {
    const searchPath = (f.config ?? []).find((c) => c.startsWith("search_path="));
    if (!searchPath) problems.push(`${f.name}: SECURITY DEFINER without pinned search_path`);
    else if (!/pg_temp\s*$/.test(searchPath)) problems.push(`${f.name}: search_path must end with pg_temp`);
    if (f.public_exec) problems.push(`${f.name}: EXECUTE granted to PUBLIC`);
  }

  // Runtime roles must never bypass RLS (Neon console roles join neon_superuser).
  const roles = await client.query<{ name: string; reason: string }>(
    `select r.rolname as name,
            concat_ws(', ',
              case when r.rolsuper then 'superuser' end,
              case when r.rolbypassrls then 'bypassrls' end,
              case when r.rolcreaterole then 'createrole' end,
              case when r.rolcreatedb then 'createdb' end,
              (select string_agg(g.rolname, ', ') from pg_auth_members m join pg_roles g on g.oid = m.roleid
                where m.member = r.oid
                  and g.rolname in ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data'))) as reason
       from pg_roles r
      where r.rolname in ('paranaga_app', 'paranaga_import', 'paranaga_definer')`,
  );
  for (const r of roles.rows) {
    if (r.reason) problems.push(`role ${r.name} is over-privileged: ${r.reason}`);
  }
  if (roles.rowCount !== 3) problems.push("expected roles paranaga_app, paranaga_import, paranaga_definer to exist");

  console.log(`checked ${tables.rowCount} tables, ${fns.rowCount} definer functions, ${roles.rowCount} roles`);
} finally {
  await client.end();
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("RLS and definer checks passed");
