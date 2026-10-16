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

### Modes, lines and time-estimate import

`pnpm db:import` also reads the reviewed modes seed (`data/source/research/naga-modes-seed-*.json`) and the pinned OpenStreetMap road snapshot (`data/source/osm/naga-roads-*.osm.json`). It traces the approximate ride paths and builds the walk graph from that snapshot, then publishes `modes-lines-<road snapshot date>`. Run `--dry-run` first: it aborts with the list of problems (a missing time-estimate parameter, an unpinned or altered snapshot, a seed record that fails review) and writes nothing. Preview the traced paths locally with `pnpm data:preview-paths` (writes the git-ignored `tmp/route-paths-preview.geojson`).

### Refreshing the road snapshot

Owner-run, never in CI or at build time. The app and the importer only read committed files.

1. `pnpm exec tsx scripts/fetch-osm-roads.ts --dry-run` prints the two Overpass queries and sends nothing. Check them.
2. `pnpm exec tsx scripts/fetch-osm-roads.ts` writes `data/source/osm/naga-roads-<UTC date>.osm.json` (contributor data is stripped before writing). Keep `.gitattributes` (`*.osm.json -text`) so the bytes stay exact.
3. Review the new file (way, node and place-node counts, regional relation lengths) against the previous one, then add its row (bytes, counts, sha256) to `data/source/osm/README.md`.
4. Add its sha256 to `ROADS_SNAPSHOT_PINS` in `scripts/lib/roads-snapshot.ts`. The importer and the preview refuse an unpinned file.
5. Re-check the street aliases (`streetAliases` in the modes seed): a unit test verifies every alias against the pinned snapshot, and `pnpm data:preview-paths` shows what could not be traced.
6. `pnpm db:import --dry-run`, a Neon backup branch of `main`, then `pnpm db:import --commit`, as in the runbook below. The new revision `modes-lines-<new date>` carries the new paths and walk graph; phones refetch them when the revision changes.

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

### Increment D release runbook

The Increment D release adds migrations 0006-0009 (modes, fleet, terminals, shapes, walk graph, time-estimate parameters, published views) and imports the reviewed modes seed plus the pinned road snapshot, which publishes `modes-2026-10-16` and then `modes-lines-2026-10-16`. Production is on `osm-places-2026-10-15` (Increment C) before this release. Do the steps in this order; every `pnpm` command runs with the owner URL in `.env.local` pointed at **Neon `main`** (the production branch), so double-check the target before each one.

1. **Back up Neon `main`.** Branch it first, and note the id of the currently published revision (the rollback target):
   ```bash
   neonctl branches create --project-id <project-id> --parent main --name pre-increment-d-YYYY-MM-DD
   ```
   Then on `main`: `select id, label from transit.v_published_revision;` (expect `osm-places-2026-10-15`). Keep that id.
2. **Migrate.** `pnpm db:migrate` (applies 0006-0009; additive, no data rewritten), then `pnpm db:check-rls`.
3. **Dry run.** `pnpm db:import --dry-run`. It must print no problems: a missing time-estimate parameter, an unpinned or altered road snapshot, or a seed record that fails review aborts with the list.
4. **Import.** `pnpm db:import --commit`, then once more: the second run must report `unchanged` for every stage.
5. **Deploy** the app (merge to `master`). Set or confirm the Vercel env vars first; `NEXT_PUBLIC_*` values are embedded at build time, so a change needs a redeploy. The new code needs migration 0009 and the published `modes-lines-*` revision, so deploy only after steps 2-4.
6. **Verify the endpoints** on the production URL:
   - `GET /api/v1/network/head` names `modes-lines-2026-10-16` as the published revision.
   - `GET /api/v1/network/snapshot/<id>` (its `routes[].fareReports` is present), `/network/search-index/<id>`, `/network/lines/<id>` (cache headers `immutable`), `/network/walk-graph/<id>`, `/routes/R4`, `/terminals/T01`.
   - `POST /api/v1/plan` for a pair across two routes returns options with ranges, not exact fares.
   - Open `/app`, plan a trip, open Layers (route lines and terminals) and the trip detail (street paths, time estimate).
7. **Post-import fixture recapture** (so the e2e fixtures name the production revision). The capture runs on a throwaway Neon branch, never on `main`:
   ```bash
   CAPTURE_E2E_FIXTURES=1 bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/reference-api.test.ts
   ```
   It writes `tests/e2e/fixtures/network/*.json` from `main`'s published revision. Fixtures that already name that revision keep their committed `publishedAt`; a new revision id brings its real production date. Then update `REVISION` in `tests/e2e/fixtures/plan-responses.ts` (id, label, `publishedAt`) and any spec that asserts the revision label or date, and run the e2e suite. `reference-api.test.ts` publishes the modes seed in its `beforeAll`: never point it at `main`.

**Rollback.** A published revision is never edited; the pointer moves. Order matters:

1. **Redeploy the previous app version first.** It must tolerate the newer revision's extra rows (the additive tables and the modes, lines and terminal records); it does not read them, so it keeps working while the pointer still names the new revision. Do not move the pointer under the running Increment D app: it needs the new revision's endpoints.
2. **Then publish the superseded revision again.** Only `paranaga_import` may execute `publish_revision`, so run this against the production owner URL (psql or any owner connection):

```sql
begin;
set local role paranaga_import;
select transit.publish_revision('<previous revision id>');
commit;
```

- The previous revision is `osm-places-2026-10-15` (the id you noted in step 1; it is `superseded` now, which `publish_revision` accepts and audits as `revision.rollback`). Do not restore `modes-2026-10-16`: it is an intermediate revision without paths or the walk graph.
- Re-publishing the previous revision does not remove the new rows or revisions; running `pnpm db:import --commit` later only prints a "(rolled back?)" warning; it never re-publishes by itself. If the data itself is damaged, reset `main` from the `pre-increment-d-YYYY-MM-DD` backup branch in the Neon console instead.
- The migrations stay applied (they are additive, and the previous app version does not read the new tables). The Increment D app reads modes, lines and walk-graph endpoints that the old revision does not serve, which is why the old app goes first. Phones refetch by revision id, so they follow the pointer.
- To go forward again: deploy the Increment D app, then publish `<modes-lines revision id>` with the same `begin; set local role paranaga_import; …; commit;` block.

**`NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY`** (optional interactive Street View, Maps Embed API only):

- Without it the stop and place pages show only the "Open in Google Maps" link; nothing breaks.
- Set it in Vercel for Production and Preview, then redeploy (it is embedded in the client bundle at build time).
- It is a browser-visible key: restrict it in Google Cloud to the Maps Embed API and to the exact website referrers (the production domain, authorized preview hosts, `localhost` for development). Never put a server credential here.
- The Playwright builds use a harmless test key and intercept the embed; no test loads Google imagery.
- Check once after deploying that the embed loads on the production domain (referrer authorization can only be verified there).

### Increment E release runbook (anywhere-alight)

Adds migrations 0010 (route notes, street graph v2, research source codes), 0011 (the OSM place categories) and 0012 (the Google Places guard), and an import that publishes `anywhere-alight-<roads date>`. Same safety rules as the Increment D runbook: every command targets Neon `main` only where stated. **Migrate before you deploy**: the new snapshot query reads `transit.v_published_route_notes` (0010), so the new code fails every snapshot, plan and route request until 0010 is applied. 0010-0012 are additive and the previous build ignores them.

1. Back up Neon `main` (branch it) and note the published revision id; that is the rollback target.
2. `pnpm db:migrate` (applies 0010, 0011, 0012), then `pnpm db:check-rls`. 0011 must be in place before the places import (the new place categories fail the check constraint without it). 0012 must be in place before `PLACES_GOOGLE_ENABLED=true`; keep that flag `false` until 0012 is applied on `main` and `db:check-rls` passes.
3. Merge the PR (CI e2e gates the merge); Vercel deploys on merge. Deploying before the import is safe: the new code reads the old revision's v1 graph until v2 is published.
4. `pnpm db:import --dry-run`. It prints metres per road rule, padyak-banned metres, padyak areas with their place nodes and coverage, graph size against the 800 KB / 260 KB budget, and notes per route. Read it before committing.
5. `pnpm db:import --commit`, then again: the second run must report `unchanged`. The reviewed seed keeps the name `naga-modes-seed-2026-10-16.json`; because its hash changed, the importer records it as a revised-seed batch (ADR 010).
6. Smoke test: `GET /api/v1/network/head` names the new revision; the snapshot has `routes[].notes`; `/network/walk-graph/<id>` returns v2; plan a trip in `/app` (jeepney, tricycle and padyak options, a 400 m walk). Between the deploy and the import the tricycle option is still offered at 500 m or more (Recommended) but reads "Street route not available" (the v1 graph has no mode data), and there is no padyak option.

**Rollback.** Publish the noted revision again first, with the `begin; set local role paranaga_import; select transit.publish_revision('<id>'); commit;` block above, and only then redeploy the previous app build: the new code reads both v1 and v2 graphs, the old code rejects a v2 graph, so redeploying first drops walks to straight lines until the old revision is published. Migrations 0010-0012 stay (additive, unused by old code). Saved trips written by the new code show as made by a newer version in old code; old guidance sessions are kept as format 1.

## Health endpoint

`GET /api/health` returns only `{ "ok": true }` publicly. With `Authorization: Bearer $CRON_SECRET` it also probes the database and reports which providers are configured (never their values).

## Notes

- Per-minute Vercel Cron needs a paid Vercel plan; on Hobby, increment 6 falls back to a Neon scheduled Function calling the job endpoint.
- The project lives in OneDrive. If installs or builds get slow or files lock, move the repo outside OneDrive or exclude `node_modules` and `.next` from sync.
