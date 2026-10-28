@AGENTS.md

<!-- vault-link:start -->
## KOS context
Before exploring this repo, read `C:\KOS\02 - Projects\Active\Naga Commuter App\PROJECT-CONTEXT.md` (and `handoff.md` in that folder if present). When you finish meaningful work: log it with `python "C:\KOS\00 - System\Automations\Dev-Metrics\Scripts\log_to_daily.py" --project "Naga Commuter App" --agent claude "<one line>"`, and refresh that folder's `handoff.md` (replace, don't append). Durable decisions go in `DECISIONS.md` there only after the user approves; mark anything AI-written as draft.
<!-- vault-link:end -->

## Stack
Next.js 16.4 (App Router, Cache Components, `src/proxy.ts` instead of middleware) · React 19.3 · strict TS · Neon Postgres + PostGIS via `pg` (Drizzle only in a few spots) · Neon Auth · React-Leaflet · Serwist PWA · Zod 4 · Tailwind 4 · pnpm 11, Node 22+. Deploys to Vercel (`sin1`). The spec in `docs/spec/` (01–07) is the source of truth; code comments cite it as `spec §x.y`.

## Layers (enforced by `pnpm check:boundaries`)
- `src/domain/`: pure TS (planner, fares, policy, Zod API schemas). No `next`, `react`, `pg`, `drizzle-orm`, and no `@/server|client|app` imports.
- `src/server/`: every file imports `"server-only"`. Only `src/server/db/` may import `pg`.
- `src/client/` (browser state, IndexedDB, hooks) and `src/ui/` (components by feature) never import `@/server/*`.
- `src/app/`: thin routes. `app/` = commuter app, `admin/` = admin console, `api/v1/` = JSON API, `api/cron/` = jobs.
- `src/i18n/`: `en`, `fil`, `bcl` dictionaries. Bikol falls back to Filipino. Admin screens are English-only.

## Request pattern (follow it for new endpoints)
`route.ts` → `publicPost`/`publicHandler` from `src/server/api/http.ts` (response schema, request id, errors like `badRequest`/`tooManyRequests`) → parse the body with a domain Zod parser → `checkRateLimit` → `withRequestContext` (`src/server/db/context.ts`, the **only** way to reach Postgres: transaction plus RLS context) → repo in `src/server/repos/` → pure domain function → response with an explicit `CACHE.*` header. Example: `src/app/api/v1/plan/route.ts`.
- Coordinates and complaint evidence are personal data: never log them and never cache them (`CACHE.none`).
- Errors never echo the request body.

## Database
- Migrations are hand-written SQL in `db/migrations/NNNN_name.sql` (next number after the highest). Apply them with `pnpm db:migrate`.
- Every table forces RLS. Run `pnpm db:check-rls` after any schema change.
- Integration tests run against a throwaway Neon branch (`scripts/with-neon-branch.sh`).

## Commands
- `pnpm dev` / `pnpm build`
- `pnpm typecheck` (`next typegen && tsc`), `pnpm lint`, `pnpm check:boundaries`
- `pnpm test` (Vitest unit, `tests/unit/*.test.ts(x)`), `pnpm test:integration` (`tests/integration/`, RLS against Neon)
- `pnpm test:e2e` (Playwright, `tests/e2e/*.spec.ts`). Locally, run only the specs your change touches.
- `pnpm verify`: full gate (typecheck, lint, boundaries, unit, build, bundle-secret scan)
- `pnpm check:bundle-secrets`: fails if a server secret or its env var *name* appears in client bundles

## Product rules that shape code
- Never invent transport data: unknown fares, stops and routes show as unknown. Unverified pins are always badged.
- AI (Jev) output is evidence only; app policy decides, and AI never changes a fare or route.
- Driver-report evidence is private to the complaint-review role and is never published.
- Guest by default: search, explore and plan need no account.

## Conventions
- Files are kebab-case; unit tests sit flat in `tests/unit/`, named by area (`api-handlers.test.ts`, `complaints-domain.test.ts`).
- Commits are Conventional Commits with the milestone as scope, e.g. `feat(N8): …`, `fix(N8): …`, `docs(N7): …`.
- Default branch is `main`. There is no CI in the repo (`.github/` is absent), so run checks locally before pushing.
- Copy `.env.example` to `.env.local` (see `docs/setup.md`). Never commit real values or name secret env vars in client-facing text.
