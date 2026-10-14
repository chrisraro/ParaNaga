# ParaNaga — full-stack commuter app build prompt

Working name: **ParaNaga**. Tagline: **Know your ride. Find your way.**

Use this prompt with the latest `Naga_Commuter_Research_Pack.zip`. Extract the package into `data/source/naga/` in the project before implementation. The name is a proposed working brand; domain and trademark availability have not been checked.

---

You are a senior full-stack engineer, transit-routing engineer, geospatial developer and product designer. Build **ParaNaga**, a complete, modern, mobile-first commuter web application for **Naga City, Camarines Sur, Philippines**, with a real backend, interactive maps, trip planning and transport-data administration.

Help tourists, newcomers, students and residents answer: Where should I wait? Which vehicle and direction should I take? How much will it cost? Where do I transfer? When should I get off? How do I walk safely to my destination? Also let the community improve transport information, exchange commuting tips, and submit private driver complaints with an explicit handoff to MyNaga.

Implement the application in this repository. Do not stop at a specification, landing page, dashboard mockup or static map. Inspect existing files and repository instructions first, create a concise implementation plan, then build and test complete flows. Make reasonable reversible implementation decisions. If credentials or verified transport evidence are missing, continue building all independent work, document the precise dependency, and implement an honest unavailable state. Do not substitute invented transport data to make the product look complete.

## 1. Product and experience

Guest use is the default: searching, exploring and planning do not require an account. Optional accounts synchronize favorites, preferences and saved trips. The main home screen is a useful map with destination search, nearby transport and a draggable trip panel. Put tourist content inside Explore rather than making users pass through a marketing page.

Use a polished, friendly visual identity: deep navy, teal, warm coral accents, clear typography, rounded cards and restrained shadows. Make route colors consistent and supplement them with letters and direction arrows. Design readable outdoor screens with large touch targets and visible contrast. Respect reduced-motion settings. Use a bottom sheet on mobile and a map/list split on desktop. Keep controls reachable by one hand. Avoid decorative clutter, fake activity counters and animation that interferes with navigation.

Provide English and Filipino interfaces with an extensible localization structure for reviewed Bicol translations. Support locally used aliases such as Centro, Francia, Diversion and CBD without conflating different destinations. Display exact entrance/stop locations when known, not just a building's center. Design loading, empty, permission-denied, offline, poor-GPS and partial-data states as part of every relevant screen.

## 2. Technical foundation

- Next.js App Router, React and strict TypeScript; installable PWA.
- Tailwind CSS, accessible component primitives, Lucide icons; light/dark themes.
- Supabase PostgreSQL, Auth and Storage; PostGIS in a dedicated extensions schema; versioned SQL migrations and seed/import scripts.
- MapLibre GL JS for map rendering. Use a configurable production tile provider with attribution. Tiles, geocoding, pedestrian routing and transit planning are separate services.
- Typed server endpoints/Route Handlers, shared domain types, Zod validation, React Hook Form where appropriate, TanStack Query for interactive server state.
- A deterministic transit-planning module; PostGIS proximity queries and a directed graph of verified walking/transit/transfer edges.
- IndexedDB and a service worker for saved trip cards and permitted public snapshots; cache invalidation keyed to published transport-data revision.
- Vitest for meaningful routing, fare and import tests; Playwright for essential browser flows; CI for type checking, linting, tests and production build.
- Vercel-ready frontend/server deployment with documented Supabase setup. Keep the initial deployment simple; add Redis or a separate routing worker only when measured load or execution limits justify it.

Verify current official documentation before choosing package versions, SSR authentication conventions, map-worker configuration or service-worker integration. Pin compatible versions and commit the lockfile. Separate provider adapters so a geocoder, walking router or tile provider can be replaced. Configure service limits, caching permissions, timeouts and cost controls. Do not use a public community geocoder or tile server as an unrestricted production dependency.

## 3. Source data and integrity

Read all relevant files in the supplied research package, including:

- `Naga_Commuter_Research.md`
- `naga_transport_seed.json`
- `naga_mapped_stops.geojson`
- `naga_mapped_stops.csv`
- `naga_mapped_stops_source.kml`
- `designated_stop_candidates.csv`
- `field_survey_template.csv`

The research snapshot contains 11 approved route/variant records and a public **Naga City Designated Stops** My Maps collection:

https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4

It contains 128 layer-specific point records: A=30, B=31, C=34, D=33, with 114 exactly distinct coordinate pairs. These are not necessarily 114 physical stops. The public owner display name is Tan Gumba; do not attribute authorship to Allen Reondanga or imply city endorsement without evidence.

The KML contains points, not route polylines. Export order is not verified stop order. Some C/D records use A/B source codes. Preserve the source layer, raw code, raw description and original coordinates; use independent internal identifiers. Never deduplicate solely by stop name, code or nearby distance. Import idempotently using source identity plus layer/feature identity and snapshot version. Record hashes, changes, conflicts and import errors.

Keep legal route plans, map pins, observed vehicle paths and surveyed boarding curbs as distinct evidence types. Preserve previous revisions. Import this snapshot into candidate/review status rather than silently publishing it as reliable navigation. Allow public exploration of mapped candidates with a clear badge; exclude them from verified navigation until approved.

Fare evidence in the package is a dated snapshot, not a guarantee of current vehicle-specific charges. Maintain effective intervals, mode/class, source and rounding rules. Treat missing prices as unknown. The local official 20% discount and EASTTODA's reported student charge conflict; preserve and review that discrepancy. Do not automatically extend a local discount category to every transport mode. Keep trial route changes, event rerouting and planned construction separate from permanent service.

## 4. Commuter screens and workflows

Implement these complete flows:

1. **Home / map:** current location or manual origin, destination search, nearby verified stops, candidate-stop exploration, route filter, recenter, legend and low-data mode.
2. **Search:** landmarks, terminals, schools, hospitals, barangays, addresses, map-picked locations and saved places. Limit results to the service geography unless the user chooses regional connections.
3. **Trip options:** compare recommended, cheapest, fewest transfers and least walking. Offer fastest only when supporting travel/wait evidence is adequate. Show known fare, unknown legs, walk distance, transfers, service confidence and any availability restrictions. Incomplete fares cannot win a cheapest ranking by behaving as zero.
4. **Trip detail:** ordered walk/ride/transfer legs; route name, signboard/headsign, vehicle class, stop code, boarding landmark/photo, alighting point, fare breakdown, source freshness and walking paths.
5. **Walk to boarding:** foreground location tracking, destination direction, boarding-side cue, GPS accuracy circle and approved crossing route where available. Provide manual landmark confirmation when GPS is ambiguous.
6. **Ride mode:** explicit “I boarded” action, progress along the verified route, next stop, approaching-alighting reminder and “I got off.” Recover from missed stops and off-route movement without repeated noisy rerouting.
7. **Transfer mode:** alighting curb → legal crossing/terminal entrance → next boarding curb. Explain the next vehicle's signboard and direction.
8. **Destination arrival:** last-mile walk to the appropriate entrance; clear trip tracking and location watchers when finished.
9. **Stops / terminals:** permitted routes, directions, loading versus unloading, available photos, accessibility evidence, terminal bay and known hours. Never promise a ride just because a route passes nearby.
10. **Routes:** variants, verified shapes, ordered stops, fare evidence, service windows, vehicle/signboard identification and disruptions.
11. **Explore:** curated destinations and “How to commute here,” using the same routing engine. Seed named landmarks from evidence; do not invent reviews, opening hours or photographs.
12. **Saved trips / settings:** favorites, optional history, fare category, language, accessibility preferences, install prompt, offline download and location/privacy controls.
13. **Report a correction:** wrong pin, moved sign, fare discrepancy, missing route, inaccessible crossing or disruption. Attach evidence and location voluntarily; show moderation and transport-review status to the contributor.
14. **Community:** moderated commuting tips, first-hand experiences, feedback, questions and helpful replies; filter by route, stop, barangay and topic; save tips and report abusive content.
15. **Report a Driver:** private camera/evidence workflow, complaint preview, submission receipt, report history and an explicit MyNaga escalation/handoff action.

Browser geolocation needs HTTPS and permission. Do not promise background tracking or alighting notifications when the browser is suspended. Implement supported foreground alerts with permission-aware sound/vibration where available. Explain the limitation concisely in the trip experience. Manual origin and trip steps must remain usable without location access.

## 5. Routing requirements

Build a deterministic multi-modal planner over directed, revision-specific data. Start with verified walking + jeepney legs and bounded transfers; make mode support extensible for trimobiles, padyaks, vans, buses and rail.

Represent route variants, reviewed shapes and reviewed ordered stops explicitly. A reverse trip may use different streets and curbs. Distinguish walking distance, ride distance, waiting time and uncertainty. Include service windows, disruptions, mode exclusions, walking limits and accessibility constraints. Use actual route distance for fares, not straight-line origin/destination distance.

Generate candidates using indexed proximity search, then validate reachable walking paths, boarding permissions, route direction, stop order and transfers. Use Pareto-style alternatives or documented weighted criteria to avoid returning several equivalent trips. Include the data revision in the result and recheck availability before starting a saved itinerary.

Never draw a fabricated road-following route by joining unordered pins or routing a private car between them. Do not claim that PostGIS or a generic driving router knows jeepney service. A pedestrian-routing provider requires pedestrian profiles and reviewed local crossing constraints. Missing safe crossing evidence must not be replaced with a straight line over a median.

Offer two explicit states: **Explore mapped stops**, which can work immediately from imported pins, and **Plan a verified commute**, which uses only reviewed operational graph data. When the coverage cannot support an itinerary, say so and show useful verified nearby information. Isolate synthetic fixtures under tests/development; never publish them as Naga service.

## 6. Correct road-side guidance

Link each boarding point to a directed road segment, curb geometry, route variant, destination headsign and boarding permissions. Store median barriers, approved crossings and terminal pedestrian entrances. Prefer “toward Centro” or “beside [verified landmark]” over bare left/right instructions.

Assess GPS accuracy, movement heading and distance to both curbs. If the accuracy envelope spans both sides, display a landmark/photo check and avoid claiming the person is on the wrong side. Never let a nearby opposite-direction stop win merely because it is closer. Correct-side assertions require reviewed curb and road evidence, not just a pin coordinate.

## 7. Fare engine

Implement versioned fare rules and stop-pair/distance matrices with integer centavos or exact decimal arithmetic. Support verified mode/class pricing, discount categories, rounding, fixed corridor pricing and separate fares per ride leg. Return an evidence-backed exact price, explicitly labeled estimate, partial total or unknown status as appropriate.

Distinguish shared per-person fares from exclusive tricycle/charter quotations. Ride-hailing uses an external provider link or supported quote adapter; do not show invented live prices. Expired matrices and unresolved conflicts must not silently determine exact fares. Display each leg's fare and the completeness of the total.

## 8. Admin and data stewardship

Roles: guest, registered commuter, contributor, transport-data reviewer, community moderator, private-complaint reviewer and administrator. Apply least privilege. A logged-in commuter is not an editor. Community moderators do not automatically gain access to private driver evidence.

Implement admin workflows for source import/preview; route aliases; directed geometry/ordered stop editing; map-pin-to-curb reconciliation; stop/sign photos; terminal bays; fare matrices; service hours; temporary disruptions; report moderation; per-barangay coverage; and publication history.

Allow draw/edit route shapes and curb points on a map. Validation must identify disconnected shapes, unreasonable coordinates, opposite-direction boarding, missing fare evidence and source-code collisions. Propose duplicate matches for review instead of auto-merging.

Publication should validate a complete revision transactionally and preserve a rollback target. Legal designation, physical sign installation, operating observation and navigation approval have separate fields. Updates to published routes should invalidate affected caches and saved trips. Disruptions have explicit expiration and scoped affected routes/stops.

## 9. Database and backend

Design normalized tables for profiles/preferences, roles, source documents, import batches/raw features, agencies/operators, modes, routes, route variants/revisions, shapes, stop areas, individual boarding curbs, route-stop associations, terminals/bays/entrances, walk edges/crossings, fare rules/matrix rows, service windows, landmarks/aliases, disruptions, verification evidence, correction reports, favorites, optional trip history and audit/publication events. Add separate tables for community posts/comments/reactions/bookmarks, user blocks, content reports, moderation jobs/decisions/appeals, contribution-review events, private driver complaints/evidence/status events, disclaimer acknowledgments and external handoff records.

Use PostGIS spatial indexes, appropriate constraints and stable IDs. Preserve geography and coordinates correctly: GeoJSON uses longitude then latitude. Keep personal data separate from public transport data. Public guests may read published public data; reviewer/admin policies govern edits and approvals. Contributors may submit evidence but cannot publish routes. Prefer protected backend/RPC operations for publication.

Enable RLS on exposed tables, validate sessions and authorization server-side, use appropriate Storage policies and keep secrets/service-role keys server-only. Do not authorize privileged actions using user-editable metadata. Validate/rate-limit uploads and reports; redact personal details from public evidence photos. Collect neither unnecessary ID scans nor continuous location history by default. Guest journeys should not require server-side location retention.

Implement real persisted CRUD, pagination, spatial filtering, error handling, audit logs and import dry runs. No hardcoded admin credentials. Document a secure initial-admin bootstrap. Background jobs must be idempotent and scoped to actual supported deployment infrastructure.

## 9A. Community corrections initiative

Make “Help improve ParaNaga” available from every route, stop and fare detail. Let users propose fare corrections, new/moved/removed stops, route deviations, hours, crossing/accessibility issues and signboard aliases. A submission references the relevant entity and revision and records the proposed change, observed date/time, regular versus discounted category, shared versus exclusive service, optional location and supporting evidence.

Show a before/after preview and suggest existing similar submissions to avoid duplicate work. Accept disagreements as useful evidence rather than forcing one price into the official record. Classify submitted fares as official matrix, charged fare, estimate or exclusive quote. Moderation checks suitability; a transport-data reviewer checks truth, provenance and publication eligibility. AI approval of a comment must never change an official fare or route automatically.

Implement statuses: draft, submitted, awaiting moderation, needs evidence, under transport review, accepted, rejected, duplicate, incorporated and superseded. Show reasons, reviewer notes, evidence freshness and a public sanitized changelog for incorporated corrections. Trust/helpful-contribution indicators may assist review but do not override evidence. Community votes and multiple accounts are not proof of a fare or route.

## 9B. Small commuter community hub

Keep this a focused commuting space rather than a general social network. Implement categories: commute tips, first-time commuter questions, experiences, accessibility, service feedback and route/stop discussions. Support text, moderated photos, lightweight threaded comments, helpful reactions, bookmarks, author edits, user blocking and content reports. Clearly identify official/app notices, community observations and incorporated verified changes. A posted fare tip is not automatically a verified fare.

Guests can read approved posts. Verified signed-in accounts can post/comment, with lower limits for new accounts. Provide topic/route/stop filters, community guidelines, my submissions, moderation status, appeals and moderator queues. Keep public profile information minimal; offer a display name rather than exposing legal identity. Do not create a public driver blacklist, expose complaint evidence or publish identifying allegations against private people as community posts.

Before submission show a short acknowledgment, with localized equivalent:

“Keep this about commuting in Naga. Share accurate, respectful information. Do not post spam, threats, harassment or private personal details. Jev checks submissions before publication; uncertain cases go to a moderator. Data corrections require a separate evidence review.”

Record the accepted guideline/disclaimer version. Allow constructive criticism of fares, service and city policies. Block unrelated advertising, repetitive spam, scams, threats, incitement to violence, targeted harassment, hate, doxxing, sexual exploitation and irrelevant graphic material. Mentioning violence in a legitimate incident report is not itself a prohibited act.

## 9C. Jev — TypeSafe classification model through OpenRouter

**Jev is the actual TypeSafe classification/structured-decision model, accessed through OpenRouter.** The project owner already has an OpenRouter API key and will configure it in the app's server environment. Implement the integration using that key; do not create a substitute chatbot named Jev. Do not ask the owner to paste secrets into chat, commit them, or expose them to the browser.

Document these server-only environment variables in `.env.example`, with an empty key:

```dotenv
OPENROUTER_API_KEY=
JEV_MODEL_ID=typesafe/jev-1.13
JEV_DECISIONS_URL=https://openrouter.ai/api/alpha/decisions
JEV_TIMEOUT_MS=10000
JEV_POLICY_VERSION=paranaga-community-v1
```

The model ID and endpoint above were checked against official OpenRouter documentation on 15 October 2026. Recheck the current Decisions API contract at implementation time, since it is an alpha API. Pin the approved model/build for repeatable policy evaluations; do not silently upgrade to a latest-model alias.

Use **POST `https://openrouter.ai/api/alpha/decisions`**, with `Authorization: Bearer <server-side OPENROUTER_API_KEY>` and JSON containing `model`, `state` and `questions`. Jev uses typed `choice`, `noul` and `score` questions. This integration is not an ordinary chat-completions conversation or a request for generated JSON prose. Validate the actual typed `answers` contract against current documentation. Save the returned model/build, request ID, typed evidence, usage and decision-policy version.

Official references:

- https://openrouter.ai/typesafe/jev-1.13/
- https://openrouter.ai/docs/guides/community/jev
- https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
- https://openrouter.ai/blog/tutorials/how-to-use-jev/

Build a server-only `classifySubmissionWithJev()` adapter and a separate pure `applyModerationPolicy()` function. Classification results are evidence; the policy function controls publication and returns ParaNaga's `publish`, `reject` or `human_review` action. Never let clients submit trusted classifications or invoke a privileged publication write directly.

Construct a bounded `state` with submission type, text, topic, route/stop context, language hints and deterministic anti-spam signals. Keep rate limits, duplicate counts, field validation and other exact checks in code. Define separate typed questions for commuting relevance, spam/scam intent, abusive-content category, threats/incitement, private-data exposure, and first-hand reporting versus endorsement of misconduct. Include explicit compliant and prohibited criteria, including constructive criticism and legitimate incident descriptions.

Pipeline: validate inputs/auth → rate limits and duplicate/link checks → private temporary media storage/file checks → Jev text classification plus separate image-safety checks → validate typed answers → apply server policy → publish/reject/human review. Apply the same flow to comments, photos and edits; changes to a published post are re-reviewed. Store a reviewed published version separately from pending edits.

Jev returns typed classifications/probabilities, not generated explanations or rewritten content. Produce user-facing reasons and localized explanations from app-owned templates and policy reason codes. Thresholds must be configurable per classification and evaluated against a human-labeled English/Filipino/code-switching/Bicol sample; model confidence is not guaranteed accuracy. Use high-certainty policy outcomes for automatic publication/rejection, and send uncertain, context-sensitive, contested and identifying allegations to a moderator. Unfamiliar language triggers review rather than automatic rejection. Keep raw model evidence separate from the final app action so policy changes can be replayed without new inference.

Jev's documented input is text. Do not send image/video binaries to it or treat photo URLs as inspected evidence. Moderate attachments using a separately supported vision/image-safety adapter or human review. If OCR is configured, mark extracted text as untrusted text for Jev; this does not constitute image-safety review. Until required media checks finish, the submission remains pending. Jev cannot write a clearer complaint summary: use deterministic formatting or an explicitly separate generative feature if needed.

Treat submitted text, OCR, links and images as untrusted content, never instructions to Jev. Bound input/media size, require schema validation and enforce decisions server-side. Protect against prompt injection, race conditions, repeated retries and attempts to publish around the moderation endpoint. AI is not a fact verifier or a determination of driver guilt. When moderation times out, is malformed or unavailable, keep content pending; never publish by default.

Add clear rejection reasons, a revise/resubmit flow, one appeal per decision, human override with audit history, repeat-abuse restrictions and configurable spam controls. Include rate limits, cooldowns, duplicate fingerprints, suspicious-link checks and a configurable bot challenge when needed. Avoid irreversible bans based only on a single uncertain model decision. Do not reject fair criticism just because its sentiment is negative.

Use durable moderation jobs, retry/backoff and idempotency. Handle missing keys, invalid authentication, insufficient credits, rate limits, timeout, invalid model IDs and malformed/missing answers explicitly; keep affected content pending. Retry transient failures with bounds, avoid double publication and log sanitized operational errors without keys or unnecessary report text. Provide an admin status panel and a server-side diagnostic using synthetic non-sensitive content, with request ID and pass/fail feedback. Mocked results are allowed only in clearly isolated development/test mode.

Add an opt-in live integration smoke test using the owner's configured server key; do not run paid calls from ordinary CI. Include typed-response fixtures, policy tests for legitimate complaints, API failures and missing answers, plus a check that the key is absent from client bundles. Track latency, usage, false positives and appeal outcomes. Disclose AI review and third-party processing before upload; configure retention and minimize sensitive content sent to OpenRouter/TypeSafe. Private complaints follow the separate workflow below and never auto-publish to the community hub.

## 9D. Private “Report a Driver” workflow

Place a visible action in ride mode, route/vehicle detail, help and report history. On the user's tap, show a brief capture safety/privacy explanation, then request camera permission and open a mobile rear-camera capture UI where supported. Provide capture-input/file upload and text-only fallbacks if camera access is unavailable. Do not open the camera on page load. Make cancellation, permission denial and interrupted upload work correctly.

Capture a photo, or short video if supported and appropriate, then show a preview with retake/remove controls. Collect complaint category, factual description, incident time (separate from capture/upload time), location with accuracy/manual correction, route/direction, operator and vehicle plate/body number if known. Support overcharging, reckless driving, refusal to honor an applicable discount, harassment, improper loading/unloading and other commuting-related complaints. Unknown vehicle identity must remain unknown. No face recognition or automatic driver identification.

Use this short submission acknowledgment:

“Describe what you observed accurately and submit evidence you are entitled to share. Your complaint is private within ParaNaga and is not automatically sent to Naga City. You can choose to continue reporting in MyNaga after reviewing your report.”

Show a review page before private submission. Save evidence in restricted Storage with short-lived signed access, least-privilege policies and audited reviewer access. Keep original evidence immutable; separately generate compressed/redacted display copies. Store hashes, capture provenance, GPS accuracy and server receipt timestamps without claiming these prove authenticity. Uploaded images and browser-captured media have different provenance; never fake sensor/device metadata or require persistent device fingerprinting.

Use Jev through OpenRouter to classify complaint relevance, spam intent, context and sensitive-disclosure categories; format the complaint summary in application code. It must not adjudicate allegations or discard legitimate reports merely because they describe violence, threats, abusive quotes or misconduct. Ambiguous sensitive complaints go to authorized human review. Protect the reporter and bystanders; identifiable allegations/evidence remain private. Do not fabricate automatic emergency dispatch, police contact or enforcement actions.

Implement private states: draft, submitted to ParaNaga, under review, needs information, closed and withdrawn, with neutral outcome reasons. Add notifications, reporter history, reviewer notes and a configurable retention/deletion process. Urgent situations should offer verified official emergency information without implying that this app is continuously monitored.

## 9E. MyNaga handoff and escalation

MyNaga is an existing official city app. Verified public entry points as of 15 October 2026:

- Official information page: https://www2.naga.gov.ph/available-mynaga-app/
- App website: https://mynaga.app/
- Android: https://play.google.com/store/apps/details?id=com.easybusph.myNaga
- iOS: https://apps.apple.com/ph/app/mynaga/id6748720972

The city’s Ordinance 2026-062 describes digital traffic reporting through MyNaga and review by the Traffic Management Center. Its recognized evidence includes MyNaga capture and other verifiable digital evidence; acceptance of ParaNaga evidence must be decided by the receiving office, not promised by our UI.

Source: https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2026-062/

No public complaint-submission API, report-prefill contract, deep link or status-sync integration was established in this research. Implement a useful manual handoff immediately, with an adapter for a future documented city integration. Do not invent a URL scheme, use an unapproved endpoint, auto-submit through a user's account, or claim an affiliation/partnership.

After a private complaint is saved, show **“Continue in MyNaga”**. Let the user review and copy a concise report summary, securely download selected evidence or use supported device sharing. Then open a verified official link, with platform-appropriate installation instructions when needed. Keep sensitive details out of query strings. Show the steps clearly: prepare report → open MyNaga → submit there → optionally record the reference number.

Record `handoff_started`, user-confirmed `submitted_externally`, and a user-entered official reference separately from ParaNaga's complaint status. Opening a link, downloading a file or sharing an attachment is not official submission. Do not claim delivered/received/resolved by the city without an authoritative acknowledgment. Mark user-entered external status as self-reported.

If a documented city API is later authorized, require a user-reviewed disclosure/consent step, least-privilege integration credentials, idempotent transmission, real acknowledgment and external status provenance. A ParaNaga reviewer cannot issue government notices, fines or findings of guilt.

## 10. Performance, offline and resilience

Lazy-load map/rendering code; use map layers rather than hundreds of heavy DOM markers. Cache published network snapshots by revision. Throttle GPS work and stop watchers when inactive. Avoid full-city downloads on every pan/search.

Cache only public assets/data and the user's intentional offline downloads. Do not cache authenticated admin responses. Display offline snapshot date and stale fare/disruption status. Offline map tiles require provider-supported permissions; never bulk-download public tiles without authorization. Make cached trip instructions usable when map tiles are unavailable.

Handle provider errors, expired sessions, empty transport coverage and network reconnection. Do not turn an uncertain wait estimate into a live arrival countdown. Add observability for routing failures, import integrity and data staleness without logging precise user journeys unnecessarily.

## 11. Delivery and acceptance

Implement in working increments: foundation and source import; map/search/explore; deterministic routing and fare modules; commuter trip experience; admin verification/publication; community corrections and Jev moderation; private driver reports and MyNaga handoff; PWA/offline; security/performance validation. After each increment run relevant checks and fix failures. Continue until the independently implementable scope is complete.

Deliver:

- Complete runnable source, lockfile, environment example, migrations and idempotent imports.
- README with local setup, deployment, provider configuration and initial-admin setup.
- Architecture and schema notes, data dictionary, source provenance and data-verification guide.
- Functional consumer/admin screens and meaningful automated tests.
- A precise readiness report: implemented, verified, blocked by credentials, and blocked by transport evidence. Do not describe an app as production-ready merely because it builds.

Acceptance checks:

1. Import preserves all 128 map records and A/B/C/D layer counts; rerunning it creates no duplicates.
2. Map selection returns the correct source pin, description, layer and coordinates.
3. Real configured backend changes persist across sessions and enforce role permissions.
4. Guests can explore without an account; manual-origin search works without GPS.
5. Planner rejects wrong-direction, prohibited, disconnected or unavailable boarding paths.
6. Cheapest ranking handles unknown fares correctly; discount and effective-date behavior is tested.
7. Low GPS accuracy produces a cautious landmark check, not a false road-side assertion.
8. Admin can review a candidate, attach evidence, publish a validated revision and retire/relocate a stop.
9. Offline saved instructions remain usable and show freshness; no admin/private cache leakage.
10. Tests, type checks and production build pass; key mobile/desktop flows receive visual review.
11. Approved community posts/comments publish; spam/threats are rejected; unclear cases and moderation-provider failures remain pending; edited posts cannot bypass review.
12. Legitimate critical feedback and incident descriptions are distinguished from threats/harassment. Appeals and moderator overrides are audited.
13. Community corrections do not change published fares/routes until transport review and validated publication; conflicting price evidence remains traceable.
14. Driver evidence is inaccessible to other commuters and community moderators without a separate authorized complaint-review role; camera-denial/upload-failure flows work.
15. MyNaga handoff copies/prepares the reviewed information and opens a verified entry point, with no fake submission acknowledgment. Official status is never inferred from a button click.
16. Jev uses the configured OpenRouter server key and Decisions API, validates typed answers and applies the app's moderation policy. Missing credits/credentials or malformed responses hold publication. Jev is never treated as a vision model or a generative rewriting model.

If the supplied data cannot yet support real commute planning, deliver the complete planner and admin tools with clearly isolated test fixtures and a working real-data map explorer. Identify the exact verified shapes, stop sequences, curb evidence and fare matrices needed to activate production itineraries. Never fabricate those inputs.

Begin by inspecting the repository and source package, recording the architecture decisions, then implement the first complete vertical slice: data import → database → interactive map → stop detail → admin review.
