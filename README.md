# ParaNaga

**Know your ride. Find your way.**

ParaNaga is a mobile-first commuter web app (PWA) for **Naga City, Camarines Sur, Philippines**. It helps tourists, students, newcomers and residents answer the everyday questions: where to wait, which jeepney and direction to take, what it costs, where to transfer, and when to get off. People can also report corrections, share commuting tips, and privately report a driver, with a handoff to the city's official MyNaga app.

> **Status: pre-launch (N8 readiness).** The planner, step-by-step guidance, saved trips, community tips, corrections, private driver reports and the admin review console are built (increments N1–N7). Route data stays provisional and badged, with fare ranges rather than exact fares, until reviewers publish checked data.

## Principles

- **No invented transport data.** Unknown fares, stops and routes are shown as unknown, never guessed.
- **Two trust levels.** *Explore mapped stops* shows public map pins as clearly badged candidates. *Plan a verified commute* uses only reviewed routes, stops and curbs.
- **AI is evidence, not authority.** Community posts are classified by Jev (TypeSafe, via OpenRouter); app-owned policy decides, and AI never changes a fare or route.
- **Private stays private.** Driver-report evidence is visible only to a separate complaint-review role and is never published.
- **Guest by default.** Searching and exploring need no account.

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · strict TypeScript · Neon Postgres + PostGIS · Neon Managed Better Auth · Neon Object Storage · Vercel

## Docs

- [Product, architecture, security and delivery spec](docs/spec/README.md)
- [Setup: Neon via Vercel, roles, environment, first admin](docs/setup.md)
- [Research package and source register](Data_Sets/Naga_Commuter_Research.md) (read-only input)
- [Research updates](docs/research/) (dated, AI-drafted evidence; not app data until reviewed)

## Development

Requires Node.js 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm verify` | Typecheck, lint, layer boundaries, unit tests, build, bundle secret scan |
| `pnpm test:e2e` | Playwright smoke tests (mobile + desktop) against `pnpm start` |
| `pnpm test:integration` | Row-level-security tests against a throwaway Neon branch |
| `pnpm db:migrate` | Apply `db/migrations/*.sql` (owner role, direct endpoint) |
| `pnpm db:check-rls` | Fail if a table lacks forced RLS, a definer function is unsafe, or a runtime role can bypass RLS |
| `pnpm db:import --dry-run\|--commit` | Import the research snapshot and publish the provisional revision (owner URL, one transaction) |
| `pnpm admin:bootstrap --email …` | One-time first admin |

Copy `.env.example` to `.env.local` and fill it in per [docs/setup.md](docs/setup.md). Never commit real values.

## Layout

```
src/domain/    pure TypeScript: planner, fares, walk graph, guidance, moderation, API schemas
src/server/    server-only: env, db (withRequestContext), auth, repos, admin, media, jobs, rate limits
src/client/    browser state: IndexedDB, saved-trip sync, geolocation, offline/PWA
src/ui/        React components by feature
src/i18n/      en, fil, bcl dictionaries (Bikol falls back to Filipino)
src/app/       routes: /app (commuter), /admin (review console), /api/v1 (JSON), /api/cron
src/proxy.ts   optimistic gate for /account and /admin
db/migrations  hand-written SQL; row-level security forced on every table
scripts/       migrate, check-rls, import, bootstrap-admin, boundary and bundle-secret checks, load test
tests/         unit · integration · e2e
docs/          spec, setup, plans, research updates
Data_Sets/     research snapshot (15 Oct 2026, read-only)
```

## Data and attribution

The research snapshot cites its sources (S01–S42) in [Data_Sets/Naga_Commuter_Research.md](Data_Sets/Naga_Commuter_Research.md). Mapped stop pins come from the public *Naga City Designated Stops* Google My Maps collection, whose public owner display name is "Tan Gumba"; ParaNaga does not claim city endorsement or affiliation with MyNaga or the City Government of Naga. "ParaNaga" is a working name.
