# ParaNaga — specification set

**Know your ride. Find your way.** A mobile-first commuter PWA for Naga City, Camarines Sur.

Status: planning baseline v0.1 — 15 October 2026. Source brief: [`ParaNaga_Build_Prompt.md`](../../ParaNaga_Build_Prompt.md). Source data: [`Data_Sets/`](../../Data_Sets/).

| # | Document | What it settles |
|---|---|---|
| 1 | [Product spec](01-product.md) | Problem, users, principles, scope, success measures, non-goals |
| 2 | [Feature catalog](02-features.md) | Every feature with ID, priority, rules and acceptance criteria |
| 3 | [System architecture](03-architecture.md) | Stack on Next.js + Neon, modules, planner, fare engine, Jev pipeline, offline, ADRs |
| 4 | [Data model](04-data-model.md) | Schemas, tables, state machines, import pipeline, data dictionary |
| 5 | [Security hardening](05-security.md) | Threat model, role matrix, RLS, storage, Jev/AI safety, headers, checklist |
| 6 | [Screens](06-screens.md) | Navigation map, every screen with states, design system |
| 7 | [Delivery plan](07-delivery.md) | Increments, test strategy, acceptance mapping, data blockers, readiness report template |

## Decisions in one table

The original brief assumed Supabase. This spec maps every Supabase responsibility onto the requested stack (Next.js, React, TypeScript, Neon).

| Concern | Brief assumed | ParaNaga uses | Why |
|---|---|---|---|
| Database | Supabase Postgres + PostGIS | **Neon Postgres 17 + PostGIS** (`extensions` schema) | Requested stack; branching per PR/preview |
| Auth | Supabase Auth | **Neon Managed Better Auth** (users in `neon_auth` schema) | Branches with the DB; roles stay in ParaNaga tables |
| Storage | Supabase Storage | **Neon Object Storage** (S3-compatible, 3 buckets) behind a `StoragePort` | Same platform; presigned URLs; swappable to R2 |
| Data access | supabase-js + RLS | **Drizzle ORM + SQL migrations**, server-only; RLS as defence in depth | No browser DB access at all |
| Background jobs | — | **Postgres job table (`FOR UPDATE SKIP LOCKED`) + Vercel Cron + `after()`** | No extra infra until load proves it |
| Planner | — | **In-process TypeScript planner** over a revision snapshot | Deterministic, unit-testable, city-scale graph |
| Moderation | Jev via OpenRouter | **Jev Decisions API**, pinned build, + app-owned policy function | Per brief §9C |
| Tiles | Configurable provider | **React-Leaflet raster tiles, MapTiler in production (ADR 009; PMTiles superseded)** | No offline tile download; tiles are never cached |

Jev was used to stress-test five of these choices; its typed answers are logged in the [ADR log](03-architecture.md#313-architecture-decision-records).

## Review log

| Date | Pass | Result |
|---|---|---|
| 2026-10-15 | Jev typed decisions on 5 open choices | Logged in ADR 001–005 |
| 2026-10-15 | `ecc:architect`, `ecc:security-reviewer`, `ecc:database-reviewer` (36 findings) | Applied: revision membership + published pointer, definer role/RLS helpers, pooled-connection safety, walk-fallback restriction, fare pricing at alighting, circular loops, job claim/lease, upload slot binding + copy-after-verify, HEIC/video handling, complaint-text Jev gate, SW allow-list, CSP, Privacy Act items, checklist additions |

## Five non-negotiables

1. **No invented transport data.** Unknown is `NULL` and shown as unknown. Synthetic fixtures live only under `tests/` and `dev` seeds, tagged `is_synthetic=true`, and can never be published.
2. **Two modes, two trust levels.** *Explore mapped stops* (candidates, badged) works on day one. *Plan a verified commute* uses only the published operational graph and says plainly when coverage is missing.
3. **AI is evidence, not authority.** Jev classifies; `applyModerationPolicy()` decides; nothing Jev returns can change a fare, route or stop.
4. **Private stays private.** Driver complaint evidence is readable only by the complaint-review role, through audited short-lived URLs. It never reaches the community hub.
5. **No fake acknowledgements.** MyNaga handoff records what the user did and what they told us, never what the city did.
