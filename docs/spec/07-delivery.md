# 7. Delivery plan

## 7.1 Workflow (Jev + ECC)

Each increment follows the same loop:

1. **Plan** — `ecc:plan` / `ecc:blueprint` on the increment's slice of this spec; confirm scope.
2. **Decide** — where a choice is genuinely open, ask Jev typed `choice`/`noul` questions over a bounded state; record answers in the ADR table; humans make the final call when Jev abstains or returns `review`.
3. **Build test-first** — `ecc:tdd-workflow` for domain modules (planner, fares, guidance, moderation policy, import).
4. **Review** — `ecc:typescript-reviewer`, `ecc:react-reviewer`, `ecc:database-reviewer` (migrations/RLS), `ecc:security-reviewer` (anything touching auth, uploads, `priv`, Jev).
5. **Verify** — `ecc:verification-loop` / `ecc:quality-gate`: typecheck, lint, unit, integration (Neon branch), build, e2e smoke, axe; visual check on mobile + desktop (`ecc:browser-qa`).
6. **Gate** — readiness report updated (§7.6).

Neon: one long-lived `production` branch (protected), `dev` branch from a seed-only parent, and a disposable branch per PR/CI run.

## 7.2 Increments

| # | Increment | Contents | Exit criteria |
|---|---|---|---|
| 0 | **Foundation** | Next.js scaffold, strict TS, Tailwind tokens, i18n skeleton, ESLint boundaries, Vitest/Playwright, CI, env schema, Neon project `paranaga` + PostGIS, roles `paranaga_owner/app/definer`, base migrations (schemas, `core`, `ops`, audit), Managed Better Auth, bootstrap-admin | CI green; sign-in works on preview; RLS-coverage check in CI |
| 1 | **Vertical slice: import → DB → map → stop detail → admin review** | `ingest` + `transit` candidate tables, `import-naga.ts` (dry-run/commit/diff/conflicts), `v_candidate_pins`, map with 128 pins (GeoJSON layer), stop detail with source layer/code/description/coords, admin import screen, candidate review (promote/attach evidence/retire), draft revision + publish/rollback skeleton | AC-1, AC-2, AC-4 (explore), AC-8 (partial) pass |
| 2 | **Search, routes, explore** | Landmarks/aliases/barangays, trigram search, route catalogue from seed (legal text, trials, aliases), terminals, Explore cards, fare evidence display (no exact fares) | Search "Centro"/"Diversion" behave per F-A3 |
| 3 | **Planner + fare engine (domain)** | Graph builder, McRAPTOR search, Pareto/ranking, guidance (curb side, GPS confidence), fare engine with centavos, synthetic fixture network under `tests/fixtures/synthetic` | AC-5, AC-6, AC-7 unit/property tests pass; fixtures cannot be published (test) |
| 4 | **Commuter trip experience** | Plan API, trip options/detail, walk/ride/transfer/arrive modes, saved trips, honest "no coverage" state against real data | E2E: manual origin plan with fixtures; real data shows no-coverage state correctly |
| 5 | **Admin stewardship** | Shape editor, curbs, reconciliation, terminals, fares/matrices/conflicts, service windows, disruptions (expiry job), coverage audit, full publication validation, cache + saved-trip invalidation | AC-8 full; validation catches every rule in F-E list |
| 6 | **Corrections + community + Jev** | Correction wizard and states, community hub, uploads (quarantine → derivatives), job queue, Jev adapter + fixtures, policy function, moderation queues, appeals, overrides, Jev admin panel + diagnostic | AC-11, AC-12, AC-13, AC-16 |
| 7 | **Driver reports + MyNaga** | Camera capture, fallbacks, private storage, review console, evidence access audit, statuses, retention job, handoff flow | AC-14, AC-15 |
| 8 | **PWA + offline** | Serwist, snapshot caching by revision, offline cards, PMTiles area download, cache-leak tests | AC-9 |
| 9 | **Hardening + launch prep** | CSP enforce, rate limits tuned, load test planner, a11y audit, security review, privacy docs, readiness report | AC-10, checklist §5.13 |

## 7.3 Test strategy

| Layer | Tooling | Focus |
|---|---|---|
| Domain unit + property | Vitest + fast-check | Planner dominance & direction, fare monotonicity/unknown handling/discount scope/effective dates, curb-side logic under accuracy, moderation policy matrix, import identity & idempotency |
| Contract | Vitest + recorded fixtures | Jev typed responses (valid, missing answer, extra answer, wrong type, out-of-range), error codes 401/402/404/429/5xx/timeout |
| Integration | Vitest against a Neon branch | Migrations, RLS per role (guest/commuter/moderator/complaint reviewer/admin sessions), definer functions, job queue leasing, publication transaction/rollback, rate limits |
| E2E | Playwright (mobile + desktop projects) | Explore pins, manual-origin plan, no-coverage state, correction flow, community post → pending, driver report with camera denied → upload fallback, MyNaga handoff, offline card, admin import/review/publish |
| Accessibility | `@axe-core/playwright` | Every screen, light/dark |
| Security | CI scripts | Bundle secret scan, RLS coverage, gitleaks, dependency audit, SW cache contents |
| Live (opt-in) | `pnpm jev:smoke` | One synthetic Decisions call with the owner's key; never in CI |

Synthetic fixtures: `tests/fixtures/synthetic/*` with obviously fake names ("Fixture Loop X", coordinates offset into a test bbox) and `is_synthetic=true`. A test asserts publication refuses them.

## 7.4 Acceptance check mapping

| AC | Brief check | Where verified |
|---|---|---|
| 1 | Import preserves 128 records, A/B/C/D counts; rerun no duplicates | Integration: `import-naga` twice → counts, `unchanged`=128 |
| 2 | Map selection returns correct pin, description, layer, coords | E2E click pin → panel values match KML |
| 3 | Backend changes persist and enforce role permissions | Integration RLS matrix + e2e sign-in persistence |
| 4 | Guests explore without account; manual origin works without GPS | E2E with geolocation denied |
| 5 | Planner rejects wrong-direction/prohibited/disconnected/unavailable | Unit fixtures, one per rejection reason |
| 6 | Cheapest handles unknown fares; discount + effective-date tested | Fare + ranking unit/property tests |
| 7 | Low GPS accuracy → landmark check | Guidance unit tests + e2e with mocked geolocation |
| 8 | Admin reviews candidate, attaches evidence, publishes, retires/relocates | E2E admin flow + integration publication |
| 9 | Offline saved instructions usable, show freshness; no private cache leak | E2E offline mode + Cache Storage inspection |
| 10 | Tests, types, build pass; visual review | CI + `ecc:browser-qa` screenshots |
| 11 | Approved publish; spam/threat rejected; unclear/failure pending; edits re-reviewed | Policy unit matrix + integration with Jev fixtures |
| 12 | Criticism vs threats distinguished; appeals/overrides audited | Labelled sample eval + integration audit rows |
| 13 | Corrections don't change data until review + publication; price conflicts traceable | Integration |
| 14 | Driver evidence inaccessible to commuters/moderators; camera-denial/upload-failure flows | Integration RLS + e2e |
| 15 | MyNaga handoff prepares info, opens verified link, no fake acknowledgment | E2E: status unchanged after click; handoff event recorded |
| 16 | Jev uses server key + Decisions API, validates typed answers, failures hold; not used for vision/rewriting | Contract tests + bundle scan + code review |

## 7.5 Transport-data blockers (what activates real itineraries)

Real commute planning stays off until reviewers publish, per corridor:

1. **Directed shapes** for each active variant (start: Loops A–D; then R2, R5, R6) from GPS ride logs, reviewed against legal street lists — including the R3 Roxas/Almeda–Mabolo branch and the Aureus/Mayflower section.
2. **Ordered stop sequences** per direction with curb points on the correct side, reconciled from the 128 My Maps pins and the 30-label Loop A schematic, checked against physical signs.
3. **Curb evidence**: boarding/alighting permission, sign photo + verbatim text, road segment, toward label.
4. **Walk network** around each curb: sidewalks, medians, approved crossings, terminal entrances (BCS, Eastbound, LCC/Southbound, Northbound, Centro cluster).
5. **Fare matrices**: applicable LTFRB Region V matrix for traditional and modern PUJ (with class per vehicle), PSO tricycle distance matrix, rounding rules, discount scope by mode; resolution of the EASTTODA ₱13 conflict.
6. **Service windows**: first/last observed trips and dispatch model per variant (weekday/weekend).
7. **Status of the Eastbound trial** (Resolution 2025-735) and C/D baseline confirmation.
8. **Latest PSO stop register** and SimEx evaluation to move candidates beyond "documentary".

Field kit: `field_survey_template.csv` (45 columns) imports through the survey mapper into reviewer queues.

## 7.6 Readiness report template (updated each increment)

```
## Implemented
## Verified (with test evidence links)
## Blocked by credentials   (e.g. OPENROUTER_API_KEY not set → moderation stays pending)
## Blocked by transport evidence (from §7.5, per corridor)
## Known limitations
## Not production-ready because …
```

"Builds and passes tests" is never described as "production-ready" while any §7.5 item blocks the corridors being advertised.

## 7.7 Owner setup checklist (before increment 0)

- [ ] Create Neon project `paranaga` (Singapore region `aws-ap-southeast-1`, closest to Naga), enable PostGIS — can be done through the connected Neon MCP on your go-ahead.
- [ ] Provision Managed Better Auth; add Google OAuth client; set trusted domains.
- [ ] Create storage buckets `public-media`, `quarantine`, `evidence-private`.
- [ ] Add `OPENROUTER_API_KEY` to Vercel env (server-only) — never paste it into chat.
- [ ] Decide tile hosting: PMTiles extract for the Naga region (OSM, ODbL attribution) in `public-media` or a CDN.
- [ ] Legal: privacy notice, terms, AI-processing disclosure, DPO contact; trademark/domain check for "ParaNaga".
- [ ] Reviewer recruitment: at least one transport-data reviewer and one complaint reviewer who are not the same person as the community moderator.

## 7.8 Readiness: data import + provisional planner (15 Oct 2026)

**Delivered**

- All Data_Sets imported with provenance and conflicts; published revision `provisional-loops-2026-10-15`.
- Loops A and B planner, public API (`/api/v1/network`, `/stops`, `/routes`, `/plan`), and trip, stop and route screens.

**User decisions**

- Provisional loops on unverified pins, always badged "Unverified route"; no exact fares; no drawn path.
- Only Loops A and B are sequenced. Walks are capped at 600 m to or from a stop and 400 m between rides (straight-line); walking distances are straight-line x 1.3 estimates.
- Ride rule "must save walking": a ride option is kept only when its total walking is less than walking the whole way; a ride never goes more than one full loop circuit.
- Fare wording: "from reported fare rules · matrix not verified".

**Still blocks verified routing**

- No directed shapes, reviewed stop sequences, curb sides or boarding points (§7.5 items 1-3).
- No terminal coordinates and no exact fares (§7.5 items 4-5).
- Loops C and D stop order unknown; route alias mapping unresolved.
- No changed-data importer, so corrections need a new tool before any re-import.

**Follow-ups**

- Snapshot caching by revision and a rate limit on `/api/v1/plan`, before any public announcement.
- Import-time check that pin-order ring direction matches the documented loop direction.
- A reader role that owns the views, with base-table SELECT revoked from `paranaga_app`; `check-rls` coverage of views.
- Update policy for `ingest.batch.counts` (only while `status = 'running'`).
- Reword "(from pin order)" direction text to the documented direction.
- Home map: bbox query strings reach platform access logs (read pins from the immutable snapshot or snap coarser); add `stale-while-revalidate` to list caching.
- Landing page mockup shows "Exact · [₱ fare]"; remove or reword.

## 7.10 Readiness: modes, lines and time estimates (16 Oct 2026)

Branch `feat/modes-lines-eta` (Increment D). Not production-ready; see "Still missing".

**Implemented**

- Reviewed modes seed (sources N01 to N41 and U01, terminals T01 to T16, tricycle feeders, per-route vehicle classes and cooperative names, regional services RS01 to RS07, fare rules F06 to F12 and rider fare observations, time-estimate parameters, street aliases, conflicts register). Migrations 0006 to 0009; published revision `modes-lines-{date}` once the owner import runs.
- OpenStreetMap road snapshot (`naga-roads-2026-10-16.osm.json`), approximate ride paths for every variant that can be traced, and the on-device walk graph.
- Planner: ride distances along approximate paths, vehicle classes and mixed-fleet fare spans (R4, R7), regional per-km fare estimates on terminal detail, tricycle hint card, "must save walking" re-check on the device (D14).
- Map: mode palette and legend, Layers sheet, terminals layer and detail, route lines on the trip guide, route overview and route detail.
- Time estimates in options, trip detail, guidance, saved trips and Help ("How times are estimated"), with their basis sheet.
- PWA: lines, walk graph and search index cached; lines and street paths work offline once stored; low-data mode never downloads the walk graph unasked.
- Copy audit (Task 16): the About-data footer and the trip-detail fare note were reworded; no user-visible "live", "arrival", "ETA", "exact" or e-jeepney text remains (see `.superpowers/sdd/task-16-report.md`).

**Owner decisions in force (2026-10-16)**

- E-jeepney dropped everywhere; the 2017 route is not imported (N09 excluded).
- Modern jeepneys operate on R4 and R7 (owner-confirmed, source U01); R2, R3, R5, R6 and R8 are traditional only; traditional jeepneys operate on every route R1 to R8. This confirms service, not stop locations, stop order or paths: pins and paths keep their unverified and approximate labels and the trip badge stays.

**Verified**

- `pnpm verify` (types, lint, boundaries, unit tests, build, bundle secret scan), `pnpm test:integration` on a throwaway Neon branch, and the full Playwright suite at the end of the increment; counts are in the task report. Visual QA on Pixel 7 and 360 x 640 (light, dark, high contrast, low-data) is a separate pass.

**Blocked by credentials**

- None for this increment. The Street View embed needs `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` (set in Vercel; separate branch).

**Still missing (blocks verified routing and exact answers)**

- Headways and waiting times: none on file, so waiting is always "unknown" and no clock time is shown.
- Verified shapes: every drawn path is an approximate OSM trace; no variant has a reviewed shape (GPS ride log or survey).
- TODA zones and tricycle speeds: no zone map and no speed, so tricycles get a hint card only, never minutes or a ride line.
- Fleet registry: the LTFRB Region V route and unit lists, the April 2026 fuel-subsidy beneficiary list (Ordinance 2026-038) and cooperative fleet counts are not available; vehicle classes rest on the owner confirmation and reports.
- PNR (Philippine National Railways) service times and station facts: stations are mapped as terminals but no timetable or fare is on file.
- Loops C and D stop order, curb sides, boarding points and an approved fare matrix (see 7.5 and 7.8).
- SimEx speed and headway results and the 2025 LPTRP tricycle-zone map (City PSO and cooperatives office only).
- Source-rights items from the Codex source-compliance audit (branch `codex/place-media`, not yet merged): S33 and S34 (legacy graphic and transcription rights) and S39 and S40 (My Maps export reuse, recorded as "reuse unconfirmed") remain unresolved. Do not describe the app as legally cleared. Transitive auth packages (`@triplit/db`, react, logger) lack installed licence declarations and need a release review.

**Not production-ready because** §7.5 items 1 to 3 and 5 still block verified routing and exact fares, headways are unknown, and the source-rights items above are open.

**Owner and controller steps to publish**: `pnpm db:import --dry-run`, a Neon backup branch of `main`, `pnpm db:import --commit`, verify the published revision `modes-lines-{date}` and the API on a preview deployment. Refresh the road snapshot by the procedure in `docs/setup.md`.
