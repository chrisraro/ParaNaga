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
| 0 | **Foundation** | Next.js scaffold, strict TS, Tailwind tokens, i18n skeleton, ESLint boundaries, Vitest/Playwright, env schema, Neon project `paranaga` + PostGIS, roles `paranaga_owner/app/definer`, base migrations (schemas, `core`, `ops`, audit), Managed Better Auth, bootstrap-admin | Local typecheck, unit tests and affected e2e green; sign-in works on a preview; RLS-coverage check script passes (CI retired 2026-10-20) | Done. Migrations 0001 to 0026 exist (0001 to 0025 applied in production by 2026-10-22; 0026 N7 not applied yet). |
| 1 | **Vertical slice: import → DB → map → stop detail → admin review** | `ingest` + `transit` candidate tables, `import-naga.ts`, `v_candidate_pins`, map with 128 pins, stop detail, admin import screen, candidate review, draft revision + publish/rollback skeleton | AC-1, AC-2, AC-4 (explore), AC-8 (partial) pass | Partial. Import, map, stop detail done (data-and-provisional-planner, maps-core). Draft revision + publish/rollback built (N5a); admin import screen (changed-data importer) and candidate review built (N5b, migration 0024 not applied yet). |
| 2 | **Search, routes, explore** | Landmarks/aliases/barangays, trigram search, route catalogue, terminals, Explore cards, fare evidence display (no exact fares) | Search "Centro"/"Diversion" behave per F-A3 | Done (A commuter-screens, D modes-lines-eta, E2 places-streetview, route-tally). |
| 3 | **Planner + fare engine (domain)** | Graph builder, Pareto/ranking, guidance, fare engine with centavos, synthetic fixtures (McRAPTOR search dropped) | AC-5, AC-6, AC-7 unit/property tests pass | Partial. In-process planner delivered across the provisional planner, D, E anywhere-alight, F far-areas, planner-audit and planner-revision. The McRAPTOR rewrite is dropped. Exact fares stay out (estimates only); the AC-5/6/7 rules are done (N4). |
| 4 | **Commuter trip experience** | Plan API, trip options/detail, walk/ride/transfer/arrive modes, saved trips, honest "no coverage" state | E2E: plan with fixtures; real data shows no-coverage state correctly | Done (A, D, E, F, home-map-first and home redesign, guidance rules of 2026-10-22). |
| 5 | **Admin stewardship** | Shape editor, curbs, reconciliation, terminals, fares/matrices/conflicts, service windows, disruptions, coverage audit, publication validation, cache + saved-trip invalidation | AC-8 full | Started: N5a built the shell, dashboard, publication validation, publish/rollback with step-up and the coverage view (migration 0023). N5b added candidate review, stops and curbs, reconciliation and the changed-data import (migration 0024). C4 to C7 deferred until field data. |
| 6 | **Corrections + community + Jev** | Correction wizard and states, community hub, uploads, job queue, Jev adapter, policy function, moderation queues, appeals, overrides, Jev admin panel | AC-11, AC-12, AC-13, AC-16 | Partial. Commuter side, jobs, Jev and policy built (B, accounts-community-plan; B4 WebP re-encode open). Corrections review, moderation queue, appeals, overrides and photo approval built (N6, migration 0025 applied). Jev & providers panel built (N7, C12; migration 0026 not applied yet). |
| 7 | **Driver reports + MyNaga** | Camera capture, fallbacks, private storage, review console, evidence access audit, statuses, retention job, handoff flow | AC-14, AC-15 | Partial. Reporter flow, private storage and handoff built (B, migrations 0018 and 0019). Complaint review console, evidence access audit and retention purge built (N7, migration 0026 not applied yet); driver reports stay gated (N2) until a complaint reviewer is named. |
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
| 9 | Offline saved instructions usable, show freshness; no private cache leak | E2E offline mode + Cache Storage inspection (`offline.spec.ts`, `saved.spec.ts`; signed in: `offline-signed-in.spec.ts`: every private API family answered with cacheable headers, then no `/api/v1/me`, complaints, media, admin, plan or auth entry and no private marker in any cached body; offline the saved card shows its data date and reopening says which data it was planned from). **Passing (N8)** |
| 10 | Tests, types, build pass; visual review | Local typecheck, unit tests, build + `ecc:browser-qa` screenshots. **N8 (2026-10-22):** typegen + tsc, check-boundaries, unit (209 files, 2995 tests), build + bundle secret scan, full e2e with the enforced CSP (427 passed, 393 skipped by project/viewport gates, 4 failed: `anywhere-alight` (a)/(c2) are stale (a route letter the route tally removed), two load timeouts pass 3/3 on repeat; no CSP violation anywhere). Visual review not redone |
| 11 | Approved publish; spam/threat rejected; unclear/failure pending; edits re-reviewed | Policy unit matrix on recorded Jev answers (`tests/unit/moderation-ac11.test.ts`, `tests/fixtures/jev/recorded-responses.json`) + integration (`tests/integration/review-moderation-rls.test.ts`: stored states, edit as a new pending version while the live one stays, photo public only after approval). **Passing (N6)**; refresh the recordings with `pnpm jev:smoke` once the key is set |
| 12 | Criticism vs threats distinguished; appeals/overrides audited | Labelled sample eval on recorded answers (`tests/unit/moderation-ac12-eval.test.ts`, `tests/fixtures/jev/labelled-sample.json`: no criticism auto-rejected, no threat auto-published) + integration audit rows (`community.override`, `community.appeal`, `community.appeal_resolve`; appeal resolver ≠ original decider by CHECK constraint). **Passing (N6)** on synthetic recordings; a live labelled run needs the owner's key |
| 13 | Corrections don't change data until review + publication; price conflicts traceable | Integration (`tests/integration/review-moderation-rls.test.ts`): an accepted stop report is a new version in the open draft only, the public stop moves only on publication, which marks it incorporated; a fare report is an accepted proposal naming the fare rule version (audited). **Passing (N6)** |
| 14 | Driver evidence inaccessible to commuters/moderators; camera-denial/upload-failure flows | Integration (`tests/integration/priv-complaint-rls.test.ts`, `complaint-review-system-rls.test.ts`): guests, commuters, the reporter, moderators, transport reviewers and admins are refused every reviewer function even with a step-up; a reviewer without step-up is refused; with it, the queue has no text, reporter or keys, own reports are hidden, each open and each evidence link is audited and logged in `priv.evidence_access` (60 s); unit (`admin-complaint-handlers`: 404 before any database call for every other role) + e2e (`admin.spec.ts`: other roles get the not-found page; step-up first; no previews). Camera-denial/upload fallback e2e from B. **Passing (N7)** |
| 15 | MyNaga handoff prepares info, opens verified link, no fake acknowledgment | E2E: status unchanged after click; handoff event recorded |
| 16 | Jev uses server key + Decisions API, validates typed answers, failures hold; not used for vision/rewriting | Contract tests + bundle scan + code review. N7 adds the Jev & providers panel (key present yes/no only, never the key or an error body; `admin-system-handlers` asserts the key never appears) and an admin diagnostic that makes one synthetic server-side call only when the key is set. **Partly passing (N7)**: a live diagnostic and the recorded-answer refresh need the owner's key |

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
| N3 | Step-up OTP | **Built (2026-10-22), migration 0022 applied 2026-10-22.** A fresh Neon Auth email code (email-otp, type `sign-in`) within 15 minutes, recorded server-side per Neon Auth session in `core.step_up` (definer functions only; request, success and failure audited). `POST /api/v1/me/step-up/code` sends a code (5/hour), `POST /api/v1/me/step-up` checks it (10/hour); protected handlers call `core.step_up_apply` in the same transaction, which sets `app.step_up_at` for `priv.require_step_up()`. Protected now: the reporter's original evidence download (403 `step_up_required` + code prompt on the MyNaga handoff) and the reviewer functions (`priv.review_queue`, `priv.reviewer_evidence_download`, `priv.set_complaint_status`; no HTTP route yet, N7). Publish/rollback, role changes and threshold changes reuse `applyStepUp` when they are built (N5). Driver reports stay behind `DRIVER_REPORTS_ENABLED`. |
| N4 | Fare and planner rules on the current planner | **Done (2026-10-22).** AC-5, AC-6, AC-7 on the current planner (no McRAPTOR). Fares were already integer centavos; added fare rows by effective date (`rulesInForce`, newest in force wins, applied once in `planTrip`), a mode-scoped discount domain (`discountedFare`: exact scope, explicit rounding, never raises a fare, not shown in the UI), shared cheapest ranking (`byCheapest`: unknown after every known fare), the synthetic publication guard (`src/domain/network/publication.ts`; the N5 publish flow must call it) and the landmark check on rough GPS ("Check you're beside {stop}"). |
| N5 | Admin core | C1 shell + dashboard, C8 revisions + coverage, C3 candidates + stops/curbs + reconciliation, C2 imports; AC-8. Migrations renumbered from 0023 (the outline's 0010 to 0014 are taken; 0022 is N3's step-up). **N5a built (2026-10-22), migration 0023 not applied yet:** `/admin` (English only, desktop-first) for `admin` and `transport_reviewer`; everyone else gets a real 404 (the proxy for signed-out visitors, the layout for signed-in non-staff, every `/api/v1/admin/**` call, and `transit.admin_assert_staff()` in each definer function). C1 dashboard (published revision, open drafts, candidate stops, open corrections, last import). C8 revisions: list, "New draft from published" (copies the membership, one open draft at a time), Validate (N4's `publicationBlockers` + the F-E rules checkable today + a rolled-back dry run of `transit.publish_revision`; the report is stored bound to a membership hash), Publish / Roll back (fresh step-up via `applyStepUp` + `priv.require_step_up`, the pointer the page saw, a passing validation under 30 minutes old on the current membership, the optional two-person flag, then `transit.publish_revision` in the same transaction; audited `revision.draft_create`, `revision.validate`, `revision.publish`, `revision.rollback`). The public head moves in the same transaction; CDN copies of `/api/v1/network/head` refresh within `s-maxage=30`, per-revision URLs are new, and phones re-check saved trips against the new snapshot. A13 coverage shows what is on file per barangay (survey status and one dimension; the 27 × 9 matrix needs field data). Deferred rules: opposite-direction boarding (no curb sides), disruption without expiry (no disruptions). **N5b built (2026-10-22), migration 0024 not applied yet:** every edit is a new `*_version` row in the one open draft (`transit.admin_create_draft`) plus a repointed draft member, through SECURITY DEFINER functions that check the role (`transit.admin_assert_staff`), lock the draft, take the stop version the page saw (409 on a stale page) and audit (`stop.promote`, `stop.evidence_attach`, `stop.retire`, `stop.relocate`, `stop.edit`, `stop.reconcile`, `import.commit`). Repointing a stop that a route's stop order uses adds a variant version with the same order on the new stop version, and a shape version following it, so publication's own checks keep passing. New tables `transit.evidence`, `transit.evidence_link` (one target per link, claim/target check, evidence links to versions and is carried to the next version; a relocation drops curb evidence) and `transit.reconciliation_decision`; `stop_point_version` gains a versioned `name`, `aliases` and `edit_note` (`v_published_stops` reads the version name). Screens: **A3 Candidate review** `/admin/candidates` (queue, source pins, evidence; promote candidate → documentary → installed → field verified, each step needing evidence of its claim: legal designation, sign installed, operating observed or curb position; evidence = document with a source code, note, or a photo through the existing upload slots, purpose `stop_photo`, private bucket; relocate with a reason; retire, refused while a route's stop order uses the stop), **A6 Stops & curbs** `/admin/stops` (name, other names, curb side and curb point within 30 m only with curb position evidence, boarding/alighting), **A7 Reconciliation** `/admin/reconciliation` (stops within 15 m: link, which retires one and adds its pins to the kept stop, or keep separate; read-only list of stops whose source pin is more than 15 m away or labelled differently), **A2 Imports** `/admin/imports` (upload a KML or the package CSV with its export date; the server dry run uses the CLI's parsers and identities, `planRawFeatures` now in `src/domain/import/mapped-stops.ts`, writes nothing and shows added/changed/unchanged/missing, the 128 and A30/B31/C34/D33 counts check and the conflicts; commit is disabled on any problem; `ingest.admin_import_commit` recomputes the change kinds from the stored hashes, writes nothing when nothing changed (AC-1 rerun: 128 unchanged), otherwise a batch with raw features, changes, conflicts and, in the open draft, a new candidate per new pin and a new version per moved candidate pin; reviewed stops are never moved by an import; the first import of a map stays the CLI's). Validation rules added: promoted stop without evidence and curb side without curb evidence (warning on provisional, error on verified), retired stop in a stop order (error), stop moved more than 50 m since the parent revision (warning). Tests: unit (import planner on the real KML and CSV, promotion rules and bodies, handlers, migration text), integration `tests/integration/admin-stops-imports-rls.test.ts` (written, needs a Neon branch), e2e desktop with axe light/dark. Not built: a map on A3, photo redaction and the "Approve for navigation" checklist with a second editor (promotion stops at field verified), road segment and toward label, signed-URL viewing of evidence photos (N6), changing stop orders (C4). |
| N6 | Corrections + moderation queues | C9, C10; AC-11, AC-12, AC-13. **Built (2026-10-22), migration 0025 not applied yet.** Admin (English only): **A14 Corrections review** `/admin/corrections` (transport_reviewer, admin; `GET /api/v1/admin/corrections?scope=open\|closed`, `POST /api/v1/admin/corrections/:id`): reports with evidence (private photos streamed by `GET /api/v1/admin/media/:id`, each read audited `media.review_view`; location; history; similar reports; the stop in the open draft; for fare reports the published fare rules with sources, evidence and open conflicts). Actions start review, ask for information, reject, duplicate (templated reasons the reporter sees localized on My reports; the reviewer's note stays in the console), accept. Accept needs the open draft and records a stop action made in the same transaction (0024's functions), a stop version already edited in the draft, or a proposal with a note (and the fare rule version it concerns): never published data. A trigger on `transit.revision` marks accepted draft changes `incorporated` when that draft is published (AC-13). **A15/A16 Moderation & appeals** `/admin/moderation` (community_moderator, admin; `GET /api/v1/admin/moderation`, `POST /api/v1/admin/moderation/decisions`, `POST /api/v1/admin/moderation/appeals/:id`): pending posts, edits (with the live title), comments and photos with Jev's stored typed answer (`community.jev_evidence`, written by the server next to each submission in a savepoint) as a probability; decide with a reason code; going against Jev's recommendation is an override that needs a note (CHECK + function) and is audited `community.override`; nobody moderates their own content. Photos: commuters attach up to 3 verified `community_photo` uploads to a new post; approving one copies the stripped private object to `STORAGE_BUCKET_PUBLIC` inside the decision's transaction (removed again if the commit fails), the only path to public; `GET /api/v1/community/photos/:id` serves approved photos from the public bucket only. Appeals: `POST /api/v1/community/appeals`, once per item (unique index); a Jev auto-reject is recorded as the policy's decision when appealed; the resolver must differ from the original decider and the author (CHECK `appeal_other_moderator`, function, and the queue hides them); overturning a policy decision is an audited override. No step-up for moderation (spec §5.4 lists publish, role grant, evidence access, threshold change). Moderators now enter `/admin` (Dashboard + Moderation only; transport pages and the dashboard API answer 404 to them). Commuter strings: `report.reviewReasons`, `community.photos`, `community.appeal` (en + fil, ledger `review: true`). Tests: unit (`admin-review-handlers`, `admin-review-domain`, `community-n6-handlers`, `moderation-ac11`, `moderation-ac12-eval`, 0025 section of `admin-migration`), integration `tests/integration/review-moderation-rls.test.ts` (7 tests, passing on a Neon branch; `community-rls` and `admin-stops-imports-rls` still pass), `pnpm db:check-rls` passing (86 tables, 72 definer functions), e2e desktop admin with axe light/dark, community and my-reports. Not built: WebP re-encode of photos (B4), a content-report queue screen (definer functions exist since 0017), user restrictions, the public changelog of incorporated corrections, applying an accepted proposal automatically, edits of photos after posting. |
| N7 | Complaint review + system screens | C11, C12; AC-14, AC-16. **Built (2026-10-22), migration 0026 not applied yet.** Admin (English only). **A17 Complaint review** `/admin/complaints` for the `complaint_reviewer` role only: admins, moderators, transport reviewers and commuters get the not-found page and every `/api/v1/admin/complaints/**` call answers 404 before any database call (admin break-glass, spec 05 §5.3, is not built: admins get nothing). Every call needs a fresh step-up (N3, applied first in the same transaction; 403 `step_up_required` otherwise) and the 0026 definer functions check the role and step-up again (`priv.assert_complaint_reviewer`), hide the reviewer's own reports and audit every read: `GET /api/v1/admin/complaints?scope=open|closed` (`priv.review_list`: reference, category, queue, status, dates, evidence count; no text, no reporter, no previews; `complaint.queue.read`), `GET /api/v1/admin/complaints/:id` (`priv.review_complaint`: the text, vehicle, location, evidence metadata, history, evidence-download log; never `reporter_id` or a storage key; `complaint.review.open`, and `complaint.review.alert` on a reviewer's 31st open in 24 hours), `POST /api/v1/admin/complaints/:id` (status through 0018's `priv.set_complaint_status`, outcome codes exactly when closing, note to the reporter or reviewers only; legal hold through `priv.set_complaint_legal_hold`, reason as a reviewer-only event), `POST /api/v1/admin/complaints/:id/evidence/:evidenceId` (`priv.reviewer_evidence_download` writes `priv.evidence_access` and `complaint.evidence.read`, then the server signs a 60-second GET with `response-content-disposition=attachment`, returned in a private, no-store, no-referrer JSON body and followed at once). Not gated by `DRIVER_REPORTS_ENABLED`. **Retention** `/api/cron/retention?mode=dry-run|commit` (Bearer `CRON_SECRET`, mode required; not scheduled, see docs/setup.md): closed/withdrawn reports past `retention_until` (closure + 365 days) and not on legal hold, plus unused complaint uploads after 30 days; per report one transaction deletes the rows (`priv.retention_purge_complaint`: access log, handoff, events, evidence rows, report, media objects; re-checked under a row lock), then the storage objects with a HEAD check, then commits (objects that will not go roll the rows back); system callers only (`priv.assert_system`), restrictive delete policies for `paranaga_definer` on the five priv tables and a definer delete policy on `core.media_object` limited to complaint evidence; audited `retention.purge`, `retention.purge_upload`, `retention.run`. **C12** `/admin/users` (admins: lookup by full email only via four columns of `neon_auth."user"`, audited `user.lookup` without the address, 30/hour; staff list; grant/revoke with a required reason after a fresh step-up; `core.grant_role` / `core.revoke_role` now require step-up and a reason, refuse your own roles, unknown users and granting commuter, and never remove the last active admin; audited with the reason; roles are re-read every request, so a revocation applies on the next request, sessions are not rotated), `/admin/providers` (moderators and admins: Jev key present yes/no, never the key; model pin, endpoint host, budget used today from the shared `ops.take_token` bucket, auto-publish and complaint switches, `ops.provider_health`, other providers yes/no, feature flags; admins run one synthetic Decisions call only when the key is set, the budget is above 0 and the circuit is closed, 6/hour, audited `ops.jev.diagnose`, health recorded), `/admin/jobs` (admins: `ops.job` counts and the latest 100 rows without payloads, last retention runs), `/admin/audit` (read-only, 50 a page, keyset cursor in microseconds; filters actor, action or prefix, Manila dates; admins all rows, other staff their own by a new RLS policy). New action `ops.manage` (admin). Tests: unit (`admin-complaint-handlers`, `admin-system-handlers`, `complaint-retention`, `cron-retention-route`, `admin-n7-domain`, 0026 section of `admin-migration`, `admin-access`, `permissions`), integration `tests/integration/complaint-review-system-rls.test.ts` (12 tests) and `rls.test.ts` updated for step-up on role changes, passing on a Neon branch; full integration suite on one branch; `pnpm db:check-rls` passing (86 tables, 81 definer functions); e2e desktop admin with axe light/dark. Not built: admin break-glass evidence access (reason + notification of the other admins), session rotation on role change, redacted copies of evidence (`redacted_key` is purged when present but nothing writes it), requeue of dead jobs, alert delivery (the review-rate alert is an audit row). |
| N8 | Hardening + launch prep | **Done (2026-10-22).** CSP enforced (`CSP_REPORT_ONLY=1` kill switch, docs/setup.md), `/api/csp-report` takes both report formats and is rate limited; every POST/DELETE route reviewed for rate limits; AC-9 signed-in Cache Storage e2e; planner load test (`pnpm load:plan`, local only); privacy texts corrected; audit/bundle scan clean. Readiness: §7.12. |

### Blocked on owner/field data

- Everything in §7.5: directed shapes, ordered stop sequences with curbs, curb evidence, walk network, fare matrices, service windows, Eastbound trial status, latest PSO stop register.
- Loops C and D stop order; letters F and G (routes 3 and 4) and the R1 letter (route-tally plan).
- Headways, TODA zone map and tricycle speeds, fleet registry, PNR timetable (§7.10).
- Source-rights items S33, S34, S39, S40 (§7.10).
- Credentials: `OPENROUTER_API_KEY` (moderation stays pending without it), Neon Auth/Google OAuth setup, `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` and Google Places keys (§7.7); legal notices and reviewer recruitment (§7.7).

## 7.12 Readiness (2026-10-22)

N2 to N8 built; migrations through 0026 applied in production (owner). Format: §7.6.

### Implemented

- **CSP enforced** (N8): `Content-Security-Policy` on every response from `next.config.ts`; `CSP_REPORT_ONLY=1` at build is the kill switch (docs/setup.md "Content Security Policy"). Policy: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <tile origin>; media-src 'self' blob:; connect-src 'self' <storage origin>; frame-src https://www.google.com/maps/embed/; worker-src 'self' blob:; child-src blob:; font-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests` (Vercel only)`; report-uri /api/csp-report; report-to csp` plus `Reporting-Endpoints`. The tile origin comes from `NEXT_PUBLIC_TILE_URL` (OSM only outside production), the storage origin from `STORAGE_ENDPOINT`. No `'unsafe-eval'` outside `next dev`. Verified origins: tiles are `<img>` loads; Google Places and Jev are server-side only; Neon Auth's client calls same-origin `/api/auth`; uploads PUT to the storage origin; Street View is the Maps Embed iframe; no analytics. The service worker never handles cross-origin requests.
- `/api/csp-report` takes `report-uri` and Reporting API batches, logs directive + blocked origin only (≤ 5 per batch), 20 reports/min per sender (fails open).
- **Rate limits reviewed** (every POST/PATCH/DELETE under `src/app/api`): all `/api/v1/**` mutations take a limit in the route or its handler (`mutationPerMinute` and per-feature limits; admin `limited()`; Google calls their own per-address limit). Gap fixed: `/api/csp-report` (new `cspReportPerMinute`). Exempt by design: `/api/auth/**` (Neon Auth's own limits), `/api/cron/jobs` and `/api/cron/retention` (Bearer `CRON_SECRET`, constant-time compare).
- **Load test** `scripts/load-plan.ts` (`pnpm load:plan`), localhost only.
- **Privacy texts** corrected (en; fil drafted, ledger `review: true`): location is sent to plan a trip (not device-only); guests can plan, map and save (not "everything"); Google suggestions 24 h but a picked place's location 30 days; driver reports deleted 365 days after closing unless on legal hold; saved trips stay on the phone unless synced.
- `pnpm audit --prod` clean (browserslist override); bundle secret scan passing again (an N7 admin string named `OPENROUTER_API_KEY`).

### Verified (with test evidence)

- Full e2e with the enforced CSP, both builds (mobile, desktop, no-tiles): 427 passed, 393 skipped (viewport/project gates), 4 failed: `anywhere-alight` (a) and (c2) are stale (they expect the inferred route letter "E" that the route tally removed; not CSP), `map.spec` "peek snap makes the options inert" and the new AC-9 spec timed out under full-suite load and pass 3/3 on repeat. Every spec asserts no `securitypolicyviolation`; none fired. `smoke.spec.ts` asserts the enforced header, no `unsafe-eval`, `Reporting-Endpoints` and the signed-out `/admin` 404.
- AC-9: `tests/e2e/offline-signed-in.spec.ts` (see §7.4). AC-10: §7.4.
- Unit: 209 files, 2995 tests (`tests/unit/csp-report-route.test.ts` new); typegen + tsc; check-boundaries; build; `check:bundle-secrets` ("70 client files: no secrets found").
- RLS check green in production (owner, after 0026).
- Secrets in history: gitleaks is not installed on this machine; a pattern scan of all 484 commits (OpenRouter `sk-or-v1-`, Google `AIza`, Postgres URLs with passwords, private keys, AWS and GitHub tokens) found nothing. Run gitleaks before launch.
- **Planner load** (local `next start`, one Node process on the owner's Windows laptop, throwaway Neon branch of main in Singapore, 128 stops + 8 landmarks, pairs ≥ 400 m apart, 300 requests per level, latencies of 200s in ms):

  | Concurrent | req/s | p50 | p95 | p99 | max | Errors |
  |---|---|---|---|---|---|---|
  | 10 | 2.0 | 4741 | 6072 | 6764 | 7275 | 0 % |
  | 25 | 2.9 | 8881 | 10383 | 10972 | 11622 | 29.3 % (500 × 88) |
  | 50 | 5.0 | 10065 | 12148 | 12903 | 13205 | 64 % (500 × 192) |

  Throughput is flat at about 2 to 5 requests a second: each plan costs roughly 0.3 to 0.5 s of single-threaded CPU here plus two transactions over the laptop-to-Singapore link (rate-limit token, read-only snapshot read). The 500s are pool waits: `max: 5` connections with `connectionTimeoutMillis: 5000` (`src/server/db/client.ts`) while the event loop is busy planning. On Vercel each instance takes far fewer concurrent requests and instances scale out, and the database is in the same region, so these numbers are a worst case, not a production forecast. Not run against production or a preview.

### Blocked by credentials

- `OPENROUTER_API_KEY`: Jev moderation stays pending for a person; live AC-11/AC-12 recordings and the N7 diagnostic need it.
- `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` (Street View) as in §7.11.

### Blocked by transport evidence

- Every §7.5 item, for every corridor: directed shapes, ordered stop sequences with curbs, curb evidence, walk network, fare matrices, service windows, the Eastbound trial status, the latest PSO stop register. Loops C and D stop order. All routing stays "Unverified route", fares stay estimates.

### Known limitations

- `script-src` and `style-src` keep `'unsafe-inline'` (PPR shells stream inline RSC scripts; Next 16 nonces need dynamic renders of every page; Leaflet sets inline styles). XSS defence relies on React escaping and the other directives.
- Guest rate-limit keys include the first 32 characters of the user agent, so a client that rotates its user agent gets a fresh guest budget (`getRateLimitKey`). Kept for phones behind carrier NAT; revisit with a coarser IP-only ceiling.
- Plan errors under load are 500, not 503 + `Retry-After`; pool size and timeout untuned (see the load table).
- Cache Storage is not cleared on sign-out (§5.13 item). Nothing private is cached by construction (allow-list + AC-9 test), so clearing would only cost offline data.
- Community: the guidelines say "Jev checks submissions" but not that Jev is an AI service that may process text outside the Philippines (the corrections disclosure does). The guidelines are versioned verbatim text: changing them needs a new `GUIDELINES_VERSION` and counsel's wording.
- The driver-report text now promises deletion 365 days after closing; the retention cron is not scheduled yet (docs/setup.md). Driver reports are off (`DRIVER_REPORTS_ENABLED`).
- Dev-only audit findings, not fixed: `braces` 3.0.3 (no patched release), `esbuild` 0.18.20 through `drizzle-kit` (dev server only).
- Not built (from N3–N7): admin break-glass evidence access, session rotation on role change, redacted evidence copies, dead-job requeue, alert delivery, Bikol.
- Filipino strings changed in N8 need a native review (ledger `review: true`).

### Not production-ready because …

- §7.5 transport evidence blocks every corridor that would be advertised as verified; the app can only be launched as a provisional, badged guide.
- Legal (§7.7, §5.13): privacy notice, terms, AI-processing disclosure and retention schedule reviewed by counsel; DPO contact; privacy impact assessment before `JEV_COMPLAINTS_ENABLED`.
- Reviewer recruitment (§7.7): transport-data and complaint reviewers distinct from the moderator.

**Owner actions:** deploy and check the header (`curl -sI https://<host>/app | grep -i content-security`); watch Vercel logs for `csp_violation` for a few days (kill switch: `CSP_REPORT_ONLY=1` + redeploy); schedule `/api/cron/retention?mode=commit` daily before turning driver reports on; run gitleaks once; confirm Neon Auth OTP send/verify limits per email and IP; set `OPENROUTER_API_KEY` when ready; have a native speaker review the N8 Filipino rows; counsel review of privacy, terms and the community AI wording.
