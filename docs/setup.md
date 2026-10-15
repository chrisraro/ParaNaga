# Setup

## Why the database isn't created yet

Your only Neon organization ("Vercel: chrisraro's projects") is **managed by Vercel**, so Neon refuses to create projects through its API or MCP (`action restricted; organization is managed by Vercel`). Create the database from Vercel instead; after that, the Neon MCP and these scripts work on it normally.

## 1. Create the Neon database (Vercel dashboard, ~5 min)

1. Push this repo to GitHub and import it as a Vercel project named `paranaga`.
2. Vercel → project → **Storage** → **Create Database** → **Neon**.
   - Name: `paranaga` · Region: **Singapore (aws-ap-southeast-1)** · connect it to the `paranaga` project for Production and Preview.
3. In the Neon console (open from Vercel's Storage tab):
   - Rename the default database to `paranaga` if you like (update URLs accordingly).
   - Create a branch **`dev`** from `main` for local work; keep `main` as production and mark it **protected**.
   - **Do not** create `paranaga_app` / `paranaga_import` in the console: console roles join `neon_superuser`, which bypasses row-level security. The migration creates them (step 3).
   - **Auth** → **Enable Auth** (Managed Better Auth). Turn on **email OTP / magic link** and Google; add your production and preview domains as trusted domains. Copy the **Auth URL**.
   - **Storage** → create buckets `public-media`, `quarantine`, `evidence-private` (all private) and a scoped credential with `storage:read` + `storage:write`.
   - Set the history (point-in-time restore) window to **≤ 7 days** (spec §5.9).

## 2. Environment

Copy `.env.example` to `.env.local` and fill in, for the **`dev`** branch:

| Variable | Value |
|---|---|
| `PARANAGA_DATABASE_URL` | pooled connection string for role `paranaga_app` |
| `DATABASE_URL_UNPOOLED` | direct connection string for the owner role |
| `NEON_AUTH_BASE_URL` | Auth URL from the Neon console |
| `NEON_AUTH_COOKIE_SECRET` | `openssl rand -base64 32` |
| `STORAGE_*` | endpoint + scoped credential |
| `CRON_SECRET` | `openssl rand -base64 32` |
| `OPENROUTER_API_KEY` | your key — set it yourself in `.env.local` / Vercel, never paste it into chat |

In Vercel, set the same variables per environment as **sensitive**. Vercel's Neon integration injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and friends as the **owner** role; leave them alone (the integration manages them). The app reads only `PARANAGA_DATABASE_URL`, and production refuses to start unless it connects as `paranaga_app`.

## 3. Migrate, set role passwords, check

```bash
pnpm db:migrate
```

The migration creates `paranaga_app`, `paranaga_import` and `paranaga_definer` without login and refuses to run if any of them could bypass RLS. Give the two login roles strong passwords from `psql` (owner connection) — never commit them:

```sql
alter role paranaga_app    with login password '<generated>';
alter role paranaga_import with login password '<generated>';
```

Then build `PARANAGA_DATABASE_URL` from the **pooled** host (`ep-…-pooler…`) with `paranaga_app`, and verify:

```bash
pnpm db:check-rls
```

It fails if any app-schema table lacks forced RLS, any definer function is unsafe, or any runtime role is over-privileged.

## 4. First admin

Sign up in the app with your email, verify it, then:

```bash
pnpm admin:bootstrap --email you@example.com
```

It refuses to run if an admin already exists. Grant other roles from the admin console (later increment) or `select core.grant_role(...)` in an admin session.

## 5. CI

Create a GitHub environment `neon-ci` (with required reviewers if you like) holding secret `NEON_API_KEY` (least-privilege key); add repository variables `NEON_PROJECT_ID`, `NEON_SEED_BRANCH=dev`, `NEON_OWNER_ROLE` (the owner role name), `NEON_DATABASE`. On pushes to `master` or manual runs (never on pull requests), the `database` job creates a branch, migrates, runs the RLS check and integration tests, and deletes the branch. Keep real personal data out of the seed branch.

## Transit data import

`pnpm db:import` loads the research snapshot (`Data_Sets/`) into the `ingest` and `transit` schemas and publishes the provisional revision `provisional-loops-2026-10-15`.

```bash
pnpm db:import --dry-run   # parse, check, and report counts; writes nothing
pnpm db:import --commit    # write everything in one transaction
```

- It connects with the owner URL `DATABASE_URL_UNPOOLED` from `.env.local`, then runs the whole write as `paranaga_import` in a single transaction.
- It aborts, writing nothing, on any data-check problem.
- A second `--commit` on the same data reports `unchanged`. A changed-data import is refused for now (a versioned importer is a follow-up).
- Integration tests and RLS checks against a throwaway Neon branch: `bash scripts/with-neon-branch.sh pnpm test:integration` (also works with `pnpm db:check-rls`).

### Production runbook

Run in this order. The app code needs migration 0002 and a published revision, so merge only after step 8.

1. **Backup branch.** In Neon, branch `main` as `pre-data-import-YYYY-MM-DD`:
   ```bash
   neonctl branches create --project-id <project-id> --parent main --name pre-data-import-YYYY-MM-DD
   ```
2. `pnpm db:migrate` against `main` (0000 checksum normalized, then 0001 and 0002). On an older database the first run prints "normalized checksum of 0000_foundation.sql"; that is expected.
3. `pnpm db:check-rls`.
4. Confirm `main` has no `transit` or `ingest` rows.
5. `pnpm db:import --dry-run`, and read the counts.
6. `pnpm db:import --commit`.
7. `pnpm db:import --commit` again; expect `unchanged`.
8. Smoke a preview deployment: `GET /api/v1/network/head`, `/stops?bbox=…`, `/stops/:id`, `/routes/R8-A`, and `POST /api/v1/plan` for a pair across Loops A and B (badge present, fare is a range). Then merge.

**Rollback:** the publish is irreversible in place. Restore or reset `main` from the backup branch (Neon console: restore or reset from the backup branch), then redeploy the previous app version.

## Health endpoint

`GET /api/health` returns only `{ "ok": true }` publicly. With `Authorization: Bearer $CRON_SECRET` it also probes the database and reports which providers are configured (never their values).

## Notes

- Per-minute Vercel Cron needs a paid Vercel plan; on Hobby, increment 6 falls back to a Neon scheduled Function calling the job endpoint.
- The project lives in OneDrive. If installs or builds get slow or files lock, move the repo outside OneDrive or exclude `node_modules` and `.next` from sync.
