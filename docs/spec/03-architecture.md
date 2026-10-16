# 3. System architecture

## 3.1 Context

```
                ┌──────────────────────── Browser (PWA) ────────────────────────┐
                │ Next.js RSC + client islands · React-Leaflet · TanStack Query    │
                │ Service worker (Serwist) · IndexedDB (saved cards, snapshots)  │
                └───────────────┬───────────────────────────────┬───────────────┘
                                │ HTTPS (same origin)           │ PMTiles range requests
                ┌───────────────▼────────────── Vercel ─────────┴───────────────┐
                │ Next.js App Router                                             │
                │  ├─ Server Components (public pages, cached by revision)       │
                │  ├─ Route Handlers /api/v1/* (typed, Zod-validated)            │
                │  ├─ Server Actions (forms; auth-checked)                       │
                │  ├─ proxy.ts (session refresh, security headers, coarse limits)│
                │  └─ Cron: /api/cron/jobs (drain) · /api/cron/expire · retention│
                └──┬──────────────┬──────────────┬──────────────┬───────────────┘
                   │ Drizzle + pg  │ S3 API        │ Better Auth  │ HTTPS
          ┌────────▼────────┐ ┌───▼──────────┐ ┌─▼───────────┐ ┌▼──────────────────────┐
          │ Neon Postgres 17│ │ Neon Object  │ │ Neon Managed│ │ OpenRouter Decisions  │
          │ + PostGIS       │ │ Storage      │ │ Better Auth │ │ API (Jev, pinned)     │
          │ schemas: core,  │ │ public-media │ │ neon_auth.* │ ├───────────────────────┤
          │ ingest, transit,│ │ quarantine   │ └─────────────┘ │ Image-safety adapter  │
          │ community, priv,│ │ evidence-priv│                 │ (human review in v1)  │
          │ ops             │ └──────────────┘                 ├───────────────────────┤
          └─────────────────┘                                  │ Walk-router adapter   │
                                                               │ (optional)            │
                                                               └───────────────────────┘
```

One deployable (Next.js on Vercel) plus managed Neon services. No Redis, separate worker or queue service in v1; §3.12 lists the measured triggers for adding them.

## 3.2 Stack (pin exact versions at scaffold time; commit the lockfile)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS on Vercel | Node runtime for every DB/S3 route; no Edge runtime for data access |
| Framework | Next.js App Router (current stable), React 19, TypeScript `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` | Verify `proxy.ts` (formerly middleware) and cache APIs against current docs at scaffold |
| UI | Tailwind CSS v4, Radix primitives (shadcn/ui source), Lucide icons, `next-themes` | Tokens as CSS variables |
| Forms | React Hook Form + Zod resolvers | Same Zod schemas on the server |
| Server state | TanStack Query v5 | Query keys include `revisionId` |
| Map | React-Leaflet + Leaflet raster tiles (ADR 009; supersedes MapLibre GL + `pmtiles`) | Client-only component (`next/dynamic`, `ssr: false`) |
| i18n | `next-intl` | `en`, `fil`; `bcl` behind a reviewed-translation flag |
| DB | Neon Postgres 17 with `postgis`, `pg_trgm`, `unaccent`, `pgcrypto`, `btree_gist` in schema `extensions` | |
| ORM / migrations | Drizzle ORM; drizzle-kit generates **SQL files**; PostGIS, RLS and functions hand-written in SQL | Migrations reviewed as SQL |
| Driver | node-postgres (`pg`) Pool on Vercel Fluid compute, registered with `attachDatabasePool` (`@vercel/functions`), via `drizzle-orm/node-postgres` | Pooled (PgBouncer, transaction mode) endpoint for the app, direct endpoint for migrations. Verify current Neon + Vercel guidance at scaffold; fallback is a per-request `@neondatabase/serverless` Pool created and closed inside the request |
| Auth | Neon Managed Better Auth (Next.js server SDK) | Roles in `core.user_role`, never in auth metadata |
| Storage | Neon Object Storage via `@aws-sdk/client-s3` + presigner behind `StoragePort` | R2/S3 adapter possible |
| PWA | Serwist (`@serwist/next`) | Precache shell; runtime caches public data only |
| Client storage | IndexedDB via `idb` | Saved cards, snapshot meta |
| Images | `sharp` for EXIF strip, resize, display copies | Runs in jobs |
| Tests | Vitest, Testing Library, `fast-check`, Playwright, `@axe-core/playwright` | Neon branch per CI run |
| CI | GitHub Actions: typecheck, lint, unit, integration, build, e2e smoke, bundle secret scan | Paid Jev calls never run in CI |
| Observability | Vercel logs, `@vercel/otel`, structured JSON logs with PII scrubbing | |

## 3.3 Repository layout

```
paranaga/
├─ app/
│  ├─ [locale]/(public)/            # map, search, explore, stops, routes, trips, community (read)
│  ├─ [locale]/(account)/           # saved, settings, my submissions, my reports
│  ├─ [locale]/admin/               # role-gated console
│  ├─ api/v1/                       # route handlers
│  ├─ api/cron/                     # job drain, disruption expiry, retention purge
│  └─ manifest.ts · sw.ts
├─ src/
│  ├─ domain/                       # PURE TypeScript: types, Zod schemas, no I/O
│  │  ├─ planner/  fares/  guidance/  moderation/  import/
│  ├─ server/                       # every file starts with `import 'server-only'`
│  │  ├─ db/ (schema.ts, client.ts, withRequestContext.ts)
│  │  ├─ auth/ (session.ts, authorize.ts, roles.ts)
│  │  ├─ repos/  services/  jobs/  ratelimit/
│  │  └─ adapters/ jev/ storage/ geocoder/ walkRouter/ imageSafety/ tiles/ mynaga/
│  ├─ client/                       # hooks, map, idb, geolocation, camera
│  └─ ui/                           # design-system components
├─ db/migrations/*.sql · db/seed/dev/ (synthetic, flagged)
├─ data/source/naga/                # research package, read-only input
├─ scripts/ import-naga.ts · bootstrap-admin.ts · jev-smoke.ts · replay-policy.ts · check-bundle-secrets.ts
├─ tests/ unit/ integration/ e2e/ fixtures/synthetic/
└─ docs/
```

Dependency rule: `domain` imports nothing from `server` or `client`; `client` imports only `domain` types; only `server/db` imports `pg`; every `server` module imports `server-only`. Enforced by `scripts/check-boundaries.ts` in CI (the ECC config-protection hook keeps `eslint.config.mjs` at the Next defaults) plus the `server-only` package.

## 3.4 Request paths

| Path | Rendering | Caching |
|---|---|---|
| `/[locale]` map shell | RSC shell + client map island | Static shell; data via API |
| `GET /api/v1/network/snapshot/:revisionId` | Route handler | `public, s-maxage=31536000, immutable` |
| `GET /api/v1/network/head` | Route handler | `s-maxage=30`; returns current published revision id |
| `GET /api/v1/network/search-index/:revisionId` | Route handler | `public, s-maxage=31536000, immutable`; 404 unless the revision is the published one |
| `GET /api/v1/network/lines/:revisionId` | Route handler | Immutable. The approximate ride path of every variant (traced variants with their off-list segments and stop measures, untraced variants with their reason), each labelled "Approximate path, not a verified route shape" with its road snapshot (`OSMR-…`) and the ODbL attribution. 404 when the revision is not the published one or was published without paths; 503 (never cached) on an incomplete read |
| `GET /api/v1/network/walk-graph/:revisionId` | Route handler | Immutable. The stored walk-graph payload served verbatim as `application/json`, `ETag` = its sha256; a matching `If-None-Match` gets 304 without reading the payload. Size and hash are checked and the text re-parsed as format v1 before sending, else 503 (never cached). 404 as for lines |
| `GET /api/v1/terminals/:code` | Route handler | `s-maxage=300, stale-while-revalidate=600`. Terminal fields with the OSM coordinate provenance, routes naming it, regional services leaving from it with fare **estimates** (the only place regional fare rules appear) |
| `GET /api/v1/stops?bbox=&status=` | PostGIS `geog && ST_MakeEnvelope` | `s-maxage=300, stale-while-revalidate=600` |
| `POST /api/v1/plan` | In-process planner | `no-store`; origin/destination never logged |
| `GET /api/v1/search?q=` | Alias + trigram + optional geocoder | `s-maxage=60` |
| Stop/route pages | RSC, static params for published entities | Tagged with the stable tag `transit:published` (plus entity tags); publish and rollback revalidate `transit:published` |
| Authenticated APIs, admin | Dynamic | `private, no-store`; the service worker never caches them |

Versioned API (`/api/v1`) with a shared error envelope: `{ error: { code, message, requestId, details? } }`. Pagination is cursor-based (`?cursor=&limit≤50`).

## 3.5 Data access and RLS

- The browser never connects to Postgres. **Neon Data API stays disabled.**
- Postgres roles:
  - `paranaga_owner` — owns schemas and tables; migrations only (CI secret). Never in the app runtime.
  - `paranaga_app` — runtime; no `BYPASSRLS`; DML only on granted tables; `EXECUTE` only on listed functions.
  - `paranaga_definer` — `NOLOGIN`, **no** `BYPASSRLS`; owns every `SECURITY DEFINER` function (role helpers, publish, grant role, apply moderation decision, issue evidence URL). It passes forced RLS only through explicit `TO paranaga_definer` policies on the tables it touches, so its reach is listed table by table. Its functions are small, audited and linted (below).
  - `paranaga_import` — runs the import script; explicit `TO paranaga_import` policies on `ingest.*` and draft-revision `transit.*` rows only.
- **Every** query runs through `withRequestContext(ctx, fn)`, which opens an explicit transaction and sets context first; a lint rule forbids using the DB client outside it. Transaction-local settings are safe with PgBouncer in transaction mode; session-level `SET` is banned.
  ```sql
  select set_config('app.user_id', $1, true),      -- '' for guests
         set_config('app.request_id', $2, true);
  ```
- `core.current_user_id()` returns `NULLIF(current_setting('app.user_id', true), '')::uuid` — NULL for guests, never an error or an empty-string cast. `core.has_role(text)` looks the caller up in `core.user_role` (index `(user_id, role_code) WHERE revoked_at IS NULL`). `has_role` is `STABLE SECURITY DEFINER` owned by `paranaga_definer` (which has a read policy on `user_role`), so it works although `user_role` has forced RLS; `current_user_id` is a plain invoker function. Neither takes a user-id parameter. Policies call them as `(select core.has_role('…'))` so they are evaluated once per statement, not per row.
- App-layer `authorize(ctx, action, resource)` runs **first**; RLS is the second wall.
- Definer-function lint (migration CI check): `SET search_path = pg_catalog, <schemas>, pg_temp`; `REVOKE EXECUTE … FROM PUBLIC` then `GRANT EXECUTE` to `paranaga_app` only; no user-id or role parameters (caller identity always comes from `core.current_user_id()`); an audit insert in the same transaction for every state change. `CREATE` on all app schemas revoked from `PUBLIC`.
- Integration test: two different users run back-to-back on the same pooled connection; the second must never see the first's context.

## 3.6 Transit planner (`src/domain/planner`)

### Graph
Built per **published revision** from `transit.*` into an immutable structure, also serialized as the cached snapshot.

- **Nodes:** boarding curbs (`stop_point`), terminal bays and entrances, crossing nodes; virtual origin/destination per request.
- **Ride edges:** per `variant_revision`, consecutive `route_stop` rows in reviewed order, carrying along-shape metres (from cumulative `ST_LineLocatePoint` × length), boarding/alighting permissions, service windows and fare-rule reference. Direction is inherent; a reverse edge exists only if a reverse variant exists.
- **Walk edges:** reviewed `walk_edge` rows (sidewalk, crossing, overpass, terminal path) with accessibility flags.
- **Transfer edges:** curb→curb via the walk graph, bounded (default ≤ 400 m).

At full-city coverage the graph stays small (< 5 000 nodes, < 20 000 edges, < 2 MB JSON, < 50 ms build). Each serverless instance caches it by revision id.

### Increment D additions (all modes and lines)

- **Path distances.** A ride leg's metres are measured along the variant's approximate path (`measure(alight) − measure(board)`, modulo the path length on a circuit) when every stop has a measure and the measures are in ride order (non-decreasing on a line, exactly one lap on a circuit). Otherwise the leg falls back to the straight-line stop-to-stop sum. Each ride leg says which (`distanceBasis`: `approximate_path` or `stop_to_stop_straight_line`) and the UI shows "≈ 3.4 km along the approximate path" or "≈ 3.1 km stop to stop (straight line)", never an exact distance. Walk caps stay straight-line.
- **Vehicle classes on ride legs.** A ride leg carries its route's fleet summary (traditional, modern, mixed traditional and modern on R4 and R7, or "type not confirmed" when a cached snapshot has no fleet record). Planning is still jeepney only; tricycles, UV Express, buses and rail are shown but never planned.
- **On-device walk routing.** The walk graph (`/api/v1/network/walk-graph/:revisionId`, roughly 80 KB gzipped, at most 220 KB) is fetched lazily by the phone, never sent with a plan. `routeWalk` (A-star over the decoded graph, snapping within 100 m) gives each walk leg and the direct origin to destination walk a street path with its length, or a straight line with the reason (no path, graph loading, offline and never stored, skipped in low-data mode). Paths are labelled "Approximate walking path · crossings not checked".
- **D14 "must save walking" re-check.** After the walk paths exist, a ride option is kept only if its total walking is shorter than walking the whole way, compared like with like: graph path lengths when the direct walk and every walk leg have one, else the x 1.3 straight-line estimates. Dropped options are removed; if the recommended one is dropped the remaining options are relabelled in the fixed label order; if none remain the plan becomes `coverage = none` with reason `walk_shorter`. This runs in `src/domain/trip/enrich.ts` on the device, online and offline.
- **Time estimates.** `src/domain/eta` computes a range from the snapshot's `eta_param` rows (walk speed times a slowdown factor; jeepney speed off-peak or peak; peak windows in Manila time). The peak band is decided per trip: if the trip, from departure to the high end of the estimate, touches a peak window, every ride uses the peak band. Waiting time is unknown and never added. Tricycle and other modes get no minutes (no speed on file). Texts read "Estimate 18–27 min + waiting (unknown)" and "≈ 14–18 min walk"; no clock time and no word "arrival" is ever shown. No model on file gives "Time not available".
- **Tricycle hint.** A card "Tricycle may serve this" appears under the options (never as a ranked option) when a published tricycle terminal with a coordinate is within 600 m of the start or destination or a tricycle feeder path passes within 300 m. It states the ₱15 minimum (Ordinance 2024-002), that discounts are not applied and to confirm with the driver; no minutes and no drawn ride line.

### Access/egress candidates
1. `ST_DWithin(geog, origin, maxWalk)` over published stop points (GiST index), top 12 per side.
2. Filter: boarding permitted (origin) / alighting permitted (destination); variant active at the requested time; not closed by an active disruption; accessibility constraints met.
3. Walk legs, in order of preference:
   - reviewed walk graph if connected;
   - pedestrian-router adapter (foot profile) if configured — result marked `pathVerified=false`; any segment that crosses the carriageway the curb faces must use an approved crossing edge, otherwise rejected;
   - otherwise a straight-line distance estimate (× 1.3) **only** for same-side access that does not cross any road centreline, **and only** inside areas whose barrier/crossing coverage a reviewer has marked audited. It is shown as a distance ("about 150 m, path not verified"), never drawn as a line. It is never used for transfers or to reach an opposite curb. Anything else → candidate rejected.

### Search
Round-based multi-criteria search (McRAPTOR-style, frequency-based, since no timetables exist):

- Rounds = ride legs, max 3 (≤ 2 transfers by default).
- Criteria (all minimised): `knownFareCentavos` (completed legs only), `unknownFareLegs`, `estimateFareLegs`, `walkMeters`, `transfers`, `rideMeters`, `uncertainty` (sum of evidence-confidence penalties).
- Fares are **not** additive per edge (base + per-km + rounding). While riding, a label carries its boarding stop and the along-shape distance so far; the leg is priced by the fare engine only when the label alights. Labels still on board are compared only with labels on the same variant boarded at the same stop.
- Dominance: a label with `unknownFareLegs > 0` never dominates a fully known label on fare; estimate legs never dominate exact ones of equal amount.
- Loops: on circular variants, ride distance wraps modulo shape length (see `route_stop` in the data model); a ride may pass the loop's start point but never travel a full circuit.
- Selection: first pick each preset's winner from the full Pareto set, then fill the remaining slots (≤ 4 shown, ≤ 8 kept); finally de-duplicate by route-variant sequence (same variants with different curbs collapse to the better one).

### Ranking presets (documented, configurable)
| Label | Primary | Tie-breakers |
|---|---|---|
| Cheapest | fully known fare ascending; partial/unknown excluded unless nothing is fully known (then labelled "Lowest known fare") | transfers, walk |
| Fewest transfers | transfers | walk, fare completeness |
| Least walking | walk metres | transfers |
| Recommended | `knownFareΔ/₱5 + unknownFareLegs×4 + estimateFareLegs×1 + transfers×1.0 + walk/400 m + uncertainty×0.5` (an unknown leg costs as much as ₱20 of known fare) | |
| Fastest | only when every leg has travel-time and wait-range evidence | |

### Output
`PlanResult { revisionId, generatedAt, coverage: 'full'|'partial'|'none', options[], nearbyVerified[], warnings[] }`. Each leg carries evidence ids and freshness dates. `coverage='none'` renders the honest empty state.

### Saved itineraries
Stored as `{ revisionId, legs: [{ variantRevisionId, fromStopPointId, toStopPointId }] }`. On start, each leg is revalidated against the current revision and active disruptions; any failure → "Route changed since you saved this" + replan.

## 3.7 Fare engine (`src/domain/fares`)

- Money: integer **centavos** everywhere; formatting only in UI.
- `FareRule` (versioned): mode, vehicle class, kind (`distance_based` | `flat` | `stop_pair_matrix` | `corridor_fixed` | `exclusive_quote`), base amount, base distance, increment per km, rounding (`none` | `nearest_25c` | `nearest_peso` | `ceil_peso` — must be set explicitly, never assumed), effective interval (`tstzrange`), evidence ids, status (`draft` | `verified` | `superseded` | `conflicted`).
- `DiscountRule`: category, explicit mode scope (solo parent is not auto-extended), percent or fixed, rounding, evidence.
- Per ride leg:
  1. Resolve the rule for mode + class at trip time. None → `unknown`.
  2. `conflicted`, `draft` or expired → at best `estimate`, with a reason code.
  3. Distance = along-shape metres between curbs; missing shape distance → `unknown` for distance-based rules.
  4. Discount only if the category is in the rule's scope and evidence exists; otherwise the regular fare plus a notice.
  5. Status `exact` requires: verified rule, valid interval, verified distance, verified rounding.
- Trip total: sum of known legs + `completeness = exact | estimate | partial | unknown` (same enum as F-B1) → "₱28 + 1 unknown leg".
- Exclusive tricycle quotes are never summed with shared fares as if comparable.
- Seed rules F01–F05 import as `draft`, `publish_exact_trip_fares=false`. F05 (EASTTODA ₱13 student) imports as a **fare observation** linked to F03 with an open `fare_conflict`.

**Implemented for the provisional planner (`src/domain/planner/fares.ts`):** the planner prices a ride from the fare rules of the route's fleet. Traditional-only routes (R1 to R3, R5, R6, R8) use F01 alone. A **mixed fleet** (R4 and R7: traditional and modern jeepneys) spans the traditional minimum to the modern maximum, where the modern maximum is the larger of F02's maximum and the traditional maximum plus the riders' reported modern delta (an observation, never a rule; when it sets the maximum its code is listed and the basis becomes `fare_rules_and_reports`). A route with no fleet record (an older cached snapshot) spans both rules. The distance is the ride's D13 distance (approximate path or straight line). The seed's rounding is unknown, so ranges are widened (minimum rounded down, maximum rounded up), discounts are never applied, and a missing rule gives "unavailable", never a hard-coded fallback.

**Regional services** (`src/domain/fares/regional.ts`): UV Express, bus and regional jeepney fares are per-km **estimates** from the national rates effective 28 Sep 2026 (rules F06 to F12; F01 for a regional jeepney), computed from the service's recorded `distance_km` (the length of its OSM relations, recorded by the road fetch). They appear only on terminal and regional service detail, always as an estimate with "operator prices may differ", and never enter the planner. Without a distance only the rates are shown.

Property tests: monotonic in distance; a discount never increases a fare; unknown never coerces to 0; no floating-point money.

## 3.8 Moderation pipeline (Jev)

```
client submit → Server Action → validate (Zod, session, account age, guideline ack version)
  → deterministic checks (rate limit, duplicate fingerprint, link allow/deny, length, language hint)
  → persist submission version (status=pending); media to quarantine bucket
  → enqueue job (idempotency key = submission_version_id)
  → [job] classifySubmissionWithJev(state)  → community.jev_evidence (raw typed answers)
  → [job] imageSafety(media)                → media evidence or human queue
  → [job] applyModerationPolicy(evidence, signals, thresholds@version) → action
  → publish (promote version, copy display media to public-media)
    | reject (reason codes → localized templates) | human_review (queue)
```

### Adapter contract (`src/server/adapters/jev`)
- `POST ${JEV_DECISIONS_URL}` with `Authorization: Bearer ${OPENROUTER_API_KEY}`, body `{ model, state, questions }`. **Recheck the alpha Decisions API contract at implementation** and keep a contract test against recorded fixtures.
- Model pinning: on 15 Oct 2026 Jev resolved to **`typesafe/jev-1.13-20260917`**, while the model listing only advertised `typesafe/jev-router`. `typesafe/jev-1.13` (the brief's value) is treated as an alias because it resolves to a dated build. In production, startup fails with a clear message unless `JEV_MODEL_ID` is a dated build id; `jev-router`, `jev-latest` and undated ids are refused. Each response's returned build is compared with the pinned id; a mismatch → evidence discarded, content pending, admin alert.
- Sanitizing `state`: every field (including `route_context`, `stop_context`, `ocr_text_untrusted`) is length-capped, NFC-normalized, and stripped of control and zero-width characters; emails, phone numbers and plate-like strings are masked (`[phone]`, `[plate]`) before sending.
- `AbortController` timeout `JEV_TIMEOUT_MS` (10 s). Response parsed with Zod; missing or extra answers, wrong types, or probabilities outside [0,1] → `MalformedJevResponse`.
- Error mapping: 401/403 → `auth`; 402 → `credits`; model 400/404 → `config`; 429 → `rate_limited` (honour `Retry-After`); 5xx/timeout/network → `transient`. Only `transient` and `rate_limited` retry (30 s → 2 min → 10 min → 1 h, max 5). Everything else stays pending and alerts admins. **Never publish on error.**
- Stored per call: request id, returned model/build, usage, latency, question-set version, policy version, typed answers. Never the key; never the full text in logs.
- Circuit breaker: 5 consecutive non-transient failures or `JEV_DAILY_BUDGET_REQUESTS` exceeded → stop calling, queue for humans, show status in admin.

### State (bounded, untrusted)
```json
{
  "submission_type": "post",
  "topic": "commute_tips",
  "route_context": "R8-A Loop A",
  "stop_context": "NCF Magsaysay",
  "language_hints": ["fil", "en"],
  "signals": { "account_age_days": 3, "link_count": 0, "duplicate_count_24h": 0, "length_chars": 412 },
  "text": "<user text, ≤ 4 000 chars>"
}
```
User text is only ever a field value, never part of question wording. OCR output, if configured, goes in `ocr_text_untrusted`.

### Question set `paranaga-community-v1`
| Id | Type | Question (abridged) |
|---|---|---|
| `relevance` | choice | `commuting_naga` / `transport_general` / `off_topic` |
| `spam_scam` | noul | Is the text advertising, repetitive promotion, or a scam? |
| `abuse_category` | choice | `none` / `insult` / `targeted_harassment` / `hate` / `sexual` / `graphic` |
| `threat_incitement` | noul | Does the author threaten or incite violence (not merely describe an incident)? |
| `private_data` | choice | `none` / `contact_details` / `plate_or_body_with_allegation` / `home_address` / `id_numbers` |
| `stance` | choice | `first_hand_report` / `criticism_of_service_or_policy` / `endorses_misconduct` / `not_applicable` |
| `language_fit` | score | 0–3: how clearly the text is in en / fil / bcl / code-switched |

Each question's criteria include compliant examples (angry fare criticism; an incident description quoting abuse) and prohibited examples.

### `applyModerationPolicy()` — pure, versioned
Input: typed evidence + deterministic signals + thresholds for a policy version. Output: `{ action: 'publish'|'reject'|'human_review', reasonCodes[], policyVersion }`.
- `reject` only on high-certainty prohibited content, e.g. `spam_scam ≥ 0.95`, `threat_incitement ≥ 0.95`, `abuse_category ∈ {hate, sexual}` with confidence ≥ 0.90.
- `human_review` for: any mid-band score; `private_data ≠ none`; `endorses_misconduct`; `language_fit < 1.5` (unfamiliar language is never auto-rejected); an account's first 3 posts; any media still pending.
- `publish` only when every prohibition is under its low threshold **and** relevance is commuting/transport with confidence ≥ 0.80 **and** media checks passed.
- Thresholds live in `ops.moderation_policy` per version. Until they are calibrated on a labelled en/fil/code-switched/bcl sample, `AUTO_PUBLISH_ENABLED=false` sends everything that isn't a high-certainty reject to humans.
- `scripts/replay-policy.ts` re-applies a new policy version to stored evidence without new inference.

### Media
Jev never receives images, and photo URLs are never treated as inspected. `ImageSafetyPort` has two implementations: `HumanReviewOnly` (v1 default) and a configured vision-safety provider. A submission stays pending until its media evidence is complete.

### Driver complaints
Routing is **deterministic first**: category, keywords from a reviewed list (e.g. "injured", "weapon", "sinaktan") and form fields put a complaint in `queue_normal` / `queue_priority` / `queue_check_completeness`. Jev (question set `paranaga-complaint-v1`: relevance, spam intent, sensitive-disclosure categories, urgency hint) can only **raise** priority or flag spam for a human — it can never lower a deterministic priority, reject, or close a complaint. Because complaint text names identifiable third parties, Jev classification of complaints is behind `JEV_COMPLAINTS_ENABLED=false` until a privacy impact assessment is done and OpenRouter zero-data-retention / no-training settings are confirmed for the account; plates, names and phone numbers are masked before sending. This satisfies brief §9D while keeping a safe default; the owner decides when to switch it on. Complaints are never auto-rejected for describing violence and never published. The reporter-facing summary is formatted deterministically from the form fields.

## 3.9 Media and storage

| Bucket | Contents | Access |
|---|---|---|
| `quarantine` | Raw uploads pending checks (community, corrections) | Presigned PUT (5 min, type + length bound); server-only reads |
| `public-media` | Approved display copies (EXIF/GPS stripped, ≤ 1600 px WebP); reviewed stop/sign photos | Served through the app with long-cache public URLs |
| `evidence-private` | Driver-complaint originals (immutable) + redacted review copies | Server-only. Signed GET ≤ 60 s, issued only to `complaint_reviewer` (or the reporter for their own files); every issuance audited |

Upload flow:
1. Client requests a slot; the server checks type, declared size and rate, then creates a `media_object` row (`status='slot'`, `owner_id`, `purpose`, `expected_bytes`, server-generated key `quarantine/{purpose}/{yyyy}/{uuid}`).
2. Server returns a presigned **POST policy** with `content-length-range` and exact `Content-Type` if Neon Object Storage supports POST policies (verify at scaffold — see its S3-compatibility page); otherwise a presigned PUT, with size enforced after upload.
3. Client uploads, then confirms **by slot id** (never by key). The server checks the slot belongs to the caller, `HEAD`s the object, checks size, sniffs magic bytes, decodes it, computes SHA-256.
4. The server copies the verified object to a new server-owned key in the destination bucket and deletes the quarantine object — so a client cannot overwrite it after verification. `media_object.status='verified'`.
5. An orphan sweep job deletes slots and quarantine objects not confirmed within 1 hour.

Buckets: no public ACLs, no listing for the app credential, CORS allow-list limited to the app origins and `POST`/`PUT`.

Accepted types: JPEG, PNG, WebP. HEIC is converted to JPEG **on the client** (canvas re-encode) before upload, because prebuilt `sharp` cannot decode HEIC. Video (driver reports only): MP4/WebM ≤ 30 s and ≤ 25 MB; duration and codec read with a pure-JS container parser (e.g. `mp4box`), since ffmpeg is unavailable in Vercel functions. Originals are never modified; display copies come from a job.

## 3.10 Background jobs

`ops.job(id, kind, payload jsonb, idempotency_key, status ('queued','running','retry','done','dead'), attempts, max_attempts, run_after, locked_until, locked_by, last_error_code, created_at, finished_at)`; unique `(kind, idempotency_key)` while not `done`/`dead`; claim index `(run_after) WHERE status IN ('queued','retry','running')`.
- Claim in one short statement, then **commit before doing any I/O** (Jev calls, `sharp`, S3), so no row locks or pooled connections are held during work:
  ```sql
  update ops.job set status='running', locked_until=now()+interval '2 minutes',
         locked_by=$1, attempts=attempts+1
  where id in (select id from ops.job
               where status in ('queued','retry','running') and run_after <= now()
                 and (locked_until is null or locked_until < now())
               order by run_after for update skip locked limit $2)
  returning *;
  ```
- Batch size is chosen to fit the function `maxDuration`; long kinds (`import_batch`, `media_derivatives`) extend `locked_until` with a heartbeat. At `attempts = max_attempts` → `dead`.
- Triggers: `/api/cron/jobs` authenticated by `CRON_SECRET`, plus an opportunistic drain via `after()` right after enqueue. Per-minute Vercel Cron needs a paid Vercel plan; on Hobby (daily cron only) the fallback is a Neon Function scheduled trigger calling the same endpoint. `retention_purge` and `expire_disruptions` run as singleton jobs.
- Handlers check target state first, so a re-run is harmless.
- Kinds: `moderate_submission`, `media_derivatives`, `image_safety`, `publish_followups` (cache revalidation, saved-trip invalidation flags), `expire_disruptions`, `retention_purge`, `import_batch`.
- After max attempts → dead-letter view in admin.

## 3.11 PWA and offline

- Precache: app shell, fonts, icons, locale messages.
- Runtime caches (public, allow-listed):
  - `network/snapshot/:revisionId` → CacheFirst (immutable).
  - Public stop/route JSON → StaleWhileRevalidate.
  - PMTiles ranges → CacheFirst **only** for areas the user chose to download.
- Runtime caching is an **allow-list of public paths** only (`/api/v1/network/*`, `/api/v1/stops`, public route/stop JSON, tiles, static assets). Everything else is network-only, including navigations to the `(account)` and `admin` groups, Server Action POSTs, RSC requests (`?_rsc=` / `RSC` header), `/api/v1/me/*`, `/api/v1/reports/*`, and any `Cache-Control: private` response. An e2e test inspects Cache Storage after an authenticated session.
- Increment D additions (allow-listed, query-free paths only; any query string, POST or other origin is network-only):
  - `network/search-index/:revisionId` → CacheFirst, last 3 revisions kept.
  - `network/lines/:revisionId` → CacheFirst (`pn-lines-f<format>-<build>`), last 3 revisions kept.
  - `network/walk-graph/:revisionId` → CacheFirst (`pn-walk-graph-<build>`), last **2** revisions kept; the handoff accepts a body up to 2 MB and refuses 3 MB.
  - `terminals/:code`, `routes`, `routes/:code`, `stops/:id`, `sources` → StaleWhileRevalidate reference cache (200 entries, 30 days).
  - `POST /api/v1/plan` is never cached.
  - A stored copy that no longer validates is dropped from the data caches and refetched once with `cache: "no-cache"`; if still invalid the screen shows its error state.
  - Low-data mode or Data Saver never downloads the walk graph on its own (a visible opt-in offers it in trip detail); a copy already stored is used. Offline with no stored graph, walks are drawn as straight dotted lines with "Street paths need a connection the first time."
  - Terminals, routes and modes come from the cached snapshot and search index; "Clear data" removes lines and the walk graph with the other data caches.
- IndexedDB: `savedCards`, `snapshotMeta { revisionId, publishedAt }`, `prefs`, `reportDrafts`. On sign-out, account-linked IndexedDB stores **and** any non-public Cache Storage entries are cleared.
- On reconnect, compare `snapshotMeta` with `/network/head`; if changed, refetch and flag saved cards whose legs changed.
- Offline banner: "Offline — data from {date}. Fares may have changed."

## 3.12 Scaling triggers

| Signal | Threshold | Action |
|---|---|---|
| Plan p95 latency | > 800 ms for 3 days | Precompute transfer table; then a separate worker |
| Job backlog age | > 10 min sustained | Raise cron frequency; then Neon Function triggers or QStash |
| DB pool usage | > 70 % | Tune pool; read replica for public reads |
| Rate-limit writes | > 200 /s | Move rate limiting to Upstash Redis |

## 3.13 Architecture decision records

| ADR | Decision | Alternatives | Jev evidence (`typesafe/jev-1.13-20260917`, 15 Oct 2026) | Final |
|---|---|---|---|---|
| 001 | Drizzle + SQL migrations | Prisma, raw SQL | `drizzle` p=0.99 → act | Adopted |
| 002 | In-process TS planner | pgRouting, separate worker | `in_process_ts` p=0.89 → act | Adopted |
| 003 | Postgres job table + Vercel Cron | QStash, Inngest | `pg_queue_cron` p=0.95 → act | Adopted |
| 004 | Neon Object Storage behind `StoragePort` | Vercel Blob, R2 | `neon_storage` p=0.73 → review | Adopted with adapter; R2 fallback documented |
| 005 | Neon Managed Better Auth | Auth.js, Clerk | 0.48 Neon / 0.50 Auth.js → abstain | Human call: Neon Auth — same platform, branches with the DB; roles kept in our tables so the provider stays replaceable |
| 006 | Self-hosted Protomaps PMTiles (OSM) | MapTiler, Stadia | not asked | Adopted: offline download legally possible, predictable cost; `TileProvider` keeps MapTiler as an option |
| 007 | No Neon Data API; server-only DB access | Data API + JWT RLS | not asked | Adopted: smaller attack surface |
| 008 | Image moderation by humans until a vision adapter is chosen | Third-party vision API | not asked | Adopted; the brief forbids sending images to Jev |
| 009 | React-Leaflet raster tiles instead of MapLibre; MapTiler production tiles | MapLibre GL + PMTiles (ADR 006) | MapTiler tiles p=0.89 → act | Adopted: user decision 2026-10-15 for the map (supersedes the MapLibre row); MapTiler for production tiles, OSM tiles only for dev/test |

Jev's answers are logged as decision evidence; the ADR owner makes the final call — the same relationship the app has with Jev.

## 3.14 Environment variables (`.env.example`)

```dotenv
# Database (server-only)
DATABASE_URL=                  # pooled, role paranaga_app
DATABASE_URL_UNPOOLED=         # direct, migrations only (CI secret)
# Auth (Neon Managed Better Auth)
NEON_AUTH_BASE_URL=
NEON_AUTH_COOKIE_SECRET=
# Object storage (server-only)
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_BUCKET_PUBLIC=public-media
STORAGE_BUCKET_QUARANTINE=quarantine
STORAGE_BUCKET_EVIDENCE=evidence-private
# Jev via OpenRouter (server-only)
OPENROUTER_API_KEY=
JEV_MODEL_ID=typesafe/jev-1.13
JEV_DECISIONS_URL=https://openrouter.ai/api/alpha/decisions
JEV_TIMEOUT_MS=10000
JEV_POLICY_VERSION=paranaga-community-v1
JEV_DAILY_BUDGET_REQUESTS=5000
AUTO_PUBLISH_ENABLED=false
JEV_COMPLAINTS_ENABLED=false   # on only after DPIA + OpenRouter zero-retention confirmed
# Map (public)
# Unset: OSM tiles outside production (dev/test only); no basemap in production.
# Production (MapTiler): NEXT_PUBLIC_TILE_URL=https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=YOUR_KEY
#                        NEXT_PUBLIC_TILE_ATTRIBUTION=© MapTiler © OpenStreetMap contributors
NEXT_PUBLIC_TILE_URL=
NEXT_PUBLIC_TILE_ATTRIBUTION=© OpenStreetMap contributors
# Optional providers (server-only)
GEOCODER_PROVIDER=none
WALK_ROUTER_PROVIDER=none
IMAGE_SAFETY_PROVIDER=none
# Ops
CRON_SECRET=
BOOTSTRAP_ADMIN_EMAIL=
```

The brief's `JEV_MODEL_ID=typesafe/jev-1.13` stays in the example; production must set the dated build. Env is parsed once with Zod at startup (`src/server/env.ts`); missing optional providers degrade to honest unavailable states, while a missing Jev key keeps all submissions pending.
