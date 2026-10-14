# ParaNaga

**Know your ride. Find your way.**

ParaNaga is a mobile-first commuter web app (PWA) for **Naga City, Camarines Sur, Philippines**. It helps tourists, students, newcomers and residents answer the everyday questions: where to wait, which jeepney and direction to take, what it costs, where to transfer, and when to get off. People can also report corrections, share commuting tips, and privately report a driver, with a handoff to the city's official MyNaga app.

> **Status: early development.** Increment 0 (foundation) is built. There are no commuter screens yet, and no trip is presented as verified until reviewers publish checked route data.

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
- [Setup: Neon via Vercel, roles, environment, first admin, CI](docs/setup.md)
- [Research package and source register](Data_Sets/Naga_Commuter_Research.md) (read-only input)

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
| `pnpm admin:bootstrap --email …` | One-time first admin |

Copy `.env.example` to `.env.local` and fill it in per [docs/setup.md](docs/setup.md). Never commit real values.

## Layout

```
src/domain/    pure TypeScript (permissions; planner, fares, moderation policy later)
src/server/    server-only: env, db (withRequestContext), auth (session, authorize)
src/app/       routes; api/auth (Neon Auth proxy), api/health, api/csp-report
src/proxy.ts   optimistic gate for /account and /admin
db/migrations  hand-written SQL; row-level security forced on every table
scripts/       migrate, check-rls, bootstrap-admin, check-boundaries, check-bundle-secrets
tests/         unit · integration · e2e
docs/          spec and setup
Data_Sets/     research snapshot (15 Oct 2026)
```

## Data and attribution

The research snapshot cites its sources (S01–S42) in [Data_Sets/Naga_Commuter_Research.md](Data_Sets/Naga_Commuter_Research.md). Mapped stop pins come from the public *Naga City Designated Stops* Google My Maps collection, whose public owner display name is "Tan Gumba"; ParaNaga does not claim city endorsement or affiliation with MyNaga or the City Government of Naga. "ParaNaga" is a working name.
