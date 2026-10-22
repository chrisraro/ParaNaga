# 7. Delivery plan

## 7.1 Workflow (Jev + ECC)

Each increment follows the same loop:

1. **Plan** — `ecc:plan` / `ecc:blueprint` on the increment's slice of this spec; confirm scope.
2. **Decide** — where a choice is genuinely open, ask Jev typed `choice`/`noul` questions over a bounded state; record answers in the ADR table; humans make the final call when Jev abstains or returns `review`.
3. **Build test-first** — `ecc:tdd-workflow` for domain modules (planner, fares, guidance, moderation policy, import).
4. **Review** — `ecc:typescript-reviewer`, `ecc:react-reviewer`, `ecc:database-reviewer` (migrations/RLS), `ecc:security-reviewer` (anything touching auth, uploads, `priv`, Jev).
5. **Verify** — locally (CI was retired 2026-10-20): `pnpm typecheck`, unit tests, and only the Playwright specs the change affects (no full local e2e suite); `pnpm build` and the security scripts (bundle secret scan, RLS coverage, dependency audit) when the change touches the UI bundle or the database; integration on a throwaway Neon branch when a migration changes; visual check on mobile + desktop (`ecc:browser-qa`).
6. **Gate** — readiness report updated (§7.6).

Delivery since 2026-10-20: work is pushed straight to `master` (no PRs, no CI); Vercel builds the deployment. Neon: one long-lived `production` branch (protected), `dev` branch from a seed-only parent, and a disposable branch per integration run.

## 7.2 Increments

Status as of 2026-10-22. Lettered work (A to F, E2, plus unnumbered passes) is the delivered slice, with its plan in `docs/plans/`; N-codes are in §7.11.

| # | Increment | Contents | Exit criteria | Status |
|---|---|---|---|---|
| 0 | **Foundation** | Next.js scaffold, strict TS, Tailwind tokens, i18n skeleton, ESLint boundaries, Vitest/Playwright, env schema, Neon project `paranaga` + PostGIS, roles `paranaga_owner/app/definer`, base migrations (schemas, `core`, `ops`, audit), Managed Better Auth, bootstrap-admin | Local typecheck, unit tests and affected e2e green; sign-in works on a preview; RLS-coverage check script passes (CI retired 2026-10-20) | Done. Migrations 0001 to 0021 exist. |
| 1 | **Vertical slice: import → DB → map → stop detail → admin review** | `ingest` + `transit` candidate tables, `import-naga.ts`, `v_candidate_pins`, map with 128 pins, stop detail, admin import screen, candidate review, draft revision + publish/rollback skeleton | AC-1, AC-2, AC-4 (explore), AC-8 (partial) pass | Partial. Import, map, stop detail done (data-and-provisional-planner, maps-core). Admin import, candidate review, publish/rollback screens not built (N5). |
| 2 | **Search, routes, explore** | Landmarks/aliases/barangays, trigram search, route catalogue, terminals, Explore cards, fare evidence display (no exact fares) | Search "Centro"/"Diversion" behave per F-A3 | Done (A commuter-screens, D modes-lines-eta, E2 places-streetview, route-tally). |
| 3 | **Planner + fare engine (domain)** | Graph builder, Pareto/ranking, guidance, fare engine with centavos, synthetic fixtures (McRAPTOR search dropped) | AC-5, AC-6, AC-7 unit/property tests pass | Partial. In-process planner delivered across the provisional planner, D, E anywhere-alight, F far-areas, planner-audit and planner-revision. The McRAPTOR rewrite is dropped. Exact fares stay out (estimates only); the AC-5/6/7 rules are done (N4). |
| 4 | **Commuter trip experience** | Plan API, trip options/detail, walk/ride/transfer/arrive modes, saved trips, honest "no coverage" state | E2E: plan with fixtures; real data shows no-coverage state correctly | Done (A, D, E, F, home-map-first and home redesign, guidance rules of 2026-10-22). |
| 5 | **Admin stewardship** | Shape editor, curbs, reconciliation, terminals, fares/matrices/conflicts, service windows, disruptions, coverage audit, publication validation, cache + saved-trip invalidation | AC-8 full | Not started (Increment C; N5; C4 to C7 deferred until field data). |
| 6 | **Corrections + community + Jev** | Correction wizard and states, community hub, uploads, job queue, Jev adapter, policy function, moderation queues, appeals, overrides, Jev admin panel | AC-11, AC-12, AC-13, AC-16 | Partial. Commuter side, jobs, Jev and policy built (B, accounts-community-plan; B4 WebP re-encode open). Moderation and corrections admin queues not built (N6). |
| 7 | **Driver reports + MyNaga** | Camera capture, fallbacks, private storage, review console, evidence access audit, statuses, retention job, handoff flow | AC-14, AC-15 | Partial. Reporter flow, private storage and handoff built (B, migrations 0018 and 0019). Complaint review console not built (N7); live-but-unready pieces are gated in N2. |
| 8 | **PWA + offline** | Serwist, snapshot caching by revision, offline cards, cache-leak tests (PMTiles area download dropped) | AC-9 | Mostly done (A, D, commit 4c16434: shells and segment prefetches work offline). Signed-in Cache Storage e2e open (N8). |
| 9 | **Hardening + launch prep** | CSP enforce, rate limits tuned, load test planner, a11y audit, security review, privacy docs, readiness report | AC-10, checklist §5.13 | Not started (N8). Plan-endpoint rate limit and the Increment B review (B10) are done. |
| - | **Internationalisation** (not numbered) | In-house dictionaries (ADR 011), Filipino live, Bikol hidden | Guard tests pass | In progress (docs/plans/2026-10-21-i18n-filipino-bikol.md; G1 done, T11 running). |

## 7.3 Test strategy

| Layer | Tooling | Focus |
|---|---|---|
| Domain unit + property | Vitest + fast-check | Planner dominance & direction, fare monotonicity/unknown handling/discount scope/effective dates, curb-side logic under accuracy, moderation policy matrix, import identity & idempotency |
| Contract | Vitest + recorded fixtures | Jev typed responses (valid, missing answer, extra answer, wrong type, out-of-range), error codes 401/402/404/429/5xx/timeout |
| Integration | Vitest against a Neon branch | Migrations, RLS per role (guest/commuter/moderator/complaint reviewer/admin sessions), definer functions, job queue leasing, publication transaction/rollback, rate limits |
| E2E | Playwright (mobile + desktop projects) | Explore pins, manual-origin plan, no-coverage state, correction flow, community post → pending, driver report with camera denied → upload fallback, MyNaga handoff, offline card, admin import/review/publish |
| Accessibility | `@axe-core/playwright` | Every screen, light/dark |
| Security | Local scripts, run by hand | Bundle secret scan, RLS coverage, gitleaks, dependency audit, SW cache contents |
| Live (opt-in) | `pnpm jev:smoke` | One synthetic Decisions call with the owner's key; never in automated runs |

Synthetic fixtures: `tests/fixtures/synthetic/*` with obviously fake names ("Fixture Loop X", coordinates offset into a test bbox) and `is_synthetic=true`. A test asserts publication refuses them (`tests/unit/publication.test.ts`; guard in `src/domain/network/publication.ts`).

## 7.4 Acceptance check mapping

| AC | Brief check | Where verified |
|---|---|---|
| 1 | Import preserves 128 records, A/B/C/D counts; rerun no duplicates | Integration: `import-naga` twice → counts, `unchanged`=128 |
| 2 | Map selection returns correct pin, description, layer, coords | E2E click pin → panel values match KML |
| 3 | Backend changes persist and enforce role permissions | Integration RLS matrix + e2e sign-in persistence |
| 4 | Guests explore without account; manual origin works without GPS | E2E with geolocation denied |
| 5 | Planner rejects wrong-direction/prohibited/disconnected/unavailable | Unit fixtures, one per rejection reason (`tests/unit/planner-rejections.test.ts`) |
| 6 | Cheapest handles unknown fares; discount + effective-date tested | Fare + ranking unit/property tests (`tests/unit/fare-rules.test.ts`, `planner-fares.test.ts`) |
| 7 | Low GPS accuracy → landmark check | Guidance unit tests + e2e with mocked geolocation (`guidance-view.test.ts`; `tests/e2e/guidance.spec.ts` "low GPS accuracy") |
| 8 | Admin reviews candidate, attaches evidence, publishes, retires/relocates | E2E admin flow + integration publication |
| 9 | Offline saved instructions usable, show freshness; no private cache leak | E2E offline mode + Cache Storage inspection |
| 10 | Tests, types, build pass; visual review | Local typecheck, unit tests, build + `ecc:browser-qa` screenshots |
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
- [x] Tile hosting: MapTiler raster tiles in production (ADR 009); the PMTiles extract was dropped.
- [ ] Legal: privacy notice, terms, AI-processing disclosure, DPO contact; trademark/domain check for "ParaNaga".
- [ ] Reviewer recruitment: at least one transport-data reviewer and one complaint reviewer who are not the same person as the community moderator.

## 7.8 Readiness: data import + provisional planner (15 Oct 2026)

**Delivered**

- All Data_Sets imported with provenance and conflicts; published revision `provisional-loops-2026-10-15`.
- Loops A and B planner (since extended to every route, see §7.2), public API (`/api/v1/network`, `/stops`, `/routes`, `/plan`), and trip, stop and route screens.

**User decisions**

- Provisional loops on unverified pins, always badged "Unverified route"; no exact fares. (Updated 2026-10-22: approximate OSM-traced paths are drawn and planned for all routes R1 to R7 and Loops A to D, labelled approximate.)
- Only Loops A and B have a stop sequence; Loops C and D are stop-unsequenced (`src/domain/import/provisional-loops.ts` returns null, because any order would be invented). Walks are capped at 600 m to or from a stop and 400 m between rides (straight-line); walking distances are straight-line x 1.3 estimates.
- Ride rule "must save walking": a ride option is kept only when its total walking is less than walking the whole way; a ride never goes more than one full loop circuit.
- Fare wording: "from reported fare rules · matrix not verified".

**Still blocks verified routing**

- No directed shapes, reviewed stop sequences, curb sides or boarding points (§7.5 items 1-3).
- No terminal coordinates and no exact fares (§7.5 items 4-5).
- Loops C and D stop order unknown (see above). Route letters: only A to D come from the ordinance; the inferred E to J were removed (route-tally plan).
- No changed-data importer, so corrections need a new tool before any re-import.

**Follow-ups**

- Done: snapshot caching by revision (CacheFirst, §3.11) and a rate limit on `/api/v1/plan` (30/min, 600/day).
- Import-time check that pin-order ring direction matches the documented loop direction.
- A reader role that owns the views, with base-table SELECT revoked from `paranaga_app`; `check-rls` coverage of views.
- Update policy for `ingest.batch.counts` (only while `status = 'running'`).
- Reword "(from pin order)" direction text to the documented direction.
- Home map: bbox query strings reach platform access logs (read pins from the immutable snapshot or snap coarser); add `stale-while-revalidate` to list caching.
- Done: landing page rebuilt on current master (commit a500a5e).

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

## 7.11 Next increments (2026-10-22)

Dropped: the McRAPTOR rewrite (the in-process planner stays) and the PMTiles offline download (ADR 009). Deferred until field data: C4 routes + shape editor, C5 terminals, C6 fares, C7 service windows + disruptions.

| Code | Increment | Covers |
|---|---|---|
| N1 | Docs realignment | Spec and plans match the app on master (this change). |
| N2 | Gate live-but-unready features | **Done (2026-10-22).** Driver reports behind `DRIVER_REPORTS_ENABLED` (default off; `/app/report-driver`, `POST /api/v1/complaints` and complaint-evidence upload slots answer 404; More, Help and My reports point to MyNaga; reading existing own reports stays). Verified uploads stay in the private bucket until approval. Rate limits on the three community DELETE endpoints (no other DELETE routes exist). Commits: see `git log --grep "N2"`. |
| N3 | Step-up OTP | Fresh OTP for publish/rollback, role changes, complaint unlock (increment-b-review decision, not built). |
| N4 | Fare and planner rules on the current planner | **Done (2026-10-22).** AC-5, AC-6, AC-7 on the current planner (no McRAPTOR). Fares were already integer centavos; added fare rows by effective date (`rulesInForce`, newest in force wins, applied once in `planTrip`), a mode-scoped discount domain (`discountedFare`: exact scope, explicit rounding, never raises a fare, not shown in the UI), shared cheapest ranking (`byCheapest`: unknown after every known fare), the synthetic publication guard (`src/domain/network/publication.ts`; the N5 publish flow must call it) and the landmark check on rough GPS ("Check you're beside {stop}"). |
| N5 | Admin core | C1 shell + dashboard, C8 revisions + coverage, C3 candidates + stops/curbs + reconciliation, C2 imports; AC-8. Migrations renumbered from 0022 (the outline's 0010 to 0014 are taken). |
| N6 | Corrections + moderation queues | C9, C10; AC-11, AC-12, AC-13. |
| N7 | Complaint review + system screens | C11, C12; AC-14, AC-16. |
| N8 | Hardening + launch prep | CSP enforce, planner load test, signed-in Cache Storage e2e, readiness report (§7.6); AC-9, AC-10. |

### Blocked on owner/field data

- Everything in §7.5: directed shapes, ordered stop sequences with curbs, curb evidence, walk network, fare matrices, service windows, Eastbound trial status, latest PSO stop register.
- Loops C and D stop order; letters F and G (routes 3 and 4) and the R1 letter (route-tally plan).
- Headways, TODA zone map and tricycle speeds, fleet registry, PNR timetable (§7.10).
- Source-rights items S33, S34, S39, S40 (§7.10).
- Credentials: `OPENROUTER_API_KEY` (moderation stays pending without it), Neon Auth/Google OAuth setup, `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` and Google Places keys (§7.7); legal notices and reviewer recruitment (§7.7).
