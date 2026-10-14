# ParaNaga

**Know your ride. Find your way.** A mobile-first commuter PWA for Naga City, Camarines Sur.

Next.js 16 (App Router, Cache Components) · React 19 · strict TypeScript · Neon Postgres + PostGIS · Neon Managed Better Auth · Neon Object Storage · Vercel.

- Product, architecture, security and delivery spec: [`docs/spec/`](docs/spec/README.md)
- Setup (Neon via Vercel, roles, env, first admin, CI): [`docs/setup.md`](docs/setup.md)
- Research package (read-only input): [`Data_Sets/`](Data_Sets/)

## Status

Increment 0 (foundation) of [the delivery plan](docs/spec/07-delivery.md). No commuter screens yet; the home page is the untouched scaffold while visual design happens separately.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm verify` | Typecheck, lint, layer boundaries, unit tests, build, bundle secret scan |
| `pnpm test:e2e` | Playwright smoke tests (mobile + desktop) against `pnpm start` |
| `pnpm test:integration` | RLS tests against a throwaway Neon branch (`TEST_*_DATABASE_URL`) |
| `pnpm db:migrate` | Apply `db/migrations/*.sql` (owner, direct endpoint) |
| `pnpm db:check-rls` | Fail if any table lacks forced RLS, a definer function is unsafe, or a runtime role can bypass RLS |
| `pnpm admin:bootstrap --email …` | One-time first admin |

## Layout

```
src/domain/   pure TypeScript (permissions; planner, fares, moderation policy later)
src/server/   server-only: env, db (withRequestContext), auth (session, authorize)
src/app/      routes; api/auth (Neon Auth proxy), api/health, api/csp-report
src/proxy.ts  optimistic gate for /account and /admin
db/migrations hand-written SQL; RLS forced on every table
scripts/      migrate, check-rls, bootstrap-admin, check-boundaries, check-bundle-secrets
tests/        unit · integration · e2e
```
