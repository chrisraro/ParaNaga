# 2. Feature catalog

Priority: **P0** = first vertical slice, **P1** = v1 launch, **P2** = after launch. Every feature lists its hard rules (what must never happen) and acceptance criteria (AC). Brief acceptance checks are referenced as `[AC-n]` (see [Delivery §7.4](07-delivery.md#74-acceptance-check-mapping)).

## A. Map and discovery

### F-A1 Home map — P0
Full-screen React-Leaflet map centred on Naga (loop pins span approx. 123.183–123.201 E, 13.616–13.634 N; the service-area polygon covers all 27 barangays). Search bar on top, draggable bottom sheet (peek / half / full), recenter, layer/legend button, low-data toggle.
- Layers: verified stops (solid), mapped candidates (hollow + badge), terminals, route shapes (only when reviewed), disruptions.
- Stops render as a GeoJSON source with symbol/circle layers, never as DOM markers.
- Rules: candidate pins never get connecting lines; no route line is drawn from unordered pins.
- AC: map loads with 128 candidate pins in < 2.5 s on 4G; tapping a pin shows its source layer, raw code, raw description and original coordinates [AC-2]; works with location denied [AC-4].

### F-A2 Location and origin — P0
Optional geolocation, requested only on user tap. Shows an accuracy circle. Manual origin by search, map pick, or saved place.
- Rules: never request location on page load; never store guest coordinates server-side; planner requests send origin rounded to 5 decimal places (~1 m) and nothing persists it.
- AC: denial shows a manual-origin prompt, not an error wall.

### F-A3 Search — P0
Landmarks, terminals, schools, hospitals, barangays, stops, routes, aliases (Centro, Francia, Diversion, CBD), saved places, map pick; optional address-geocoder adapter.
- The alias table maps one alias to one or more *distinct* entities. "Diversion" can match several places and shows a disambiguation list.
- Results are scoped to the service geography; a toggle widens to regional connections.
- Ranking: exact alias > trigram name > geocoder; locale-aware labels (en / fil / bcl).
- AC: "Centro" returns the Centro loading cluster as an area, not a single point; cached landmarks are searchable offline.

### F-A4 Explore — P1
Curated destinations (Basilica, Cathedral, Plaza Rizal, BCS, universities, hospitals) with "How to commute here" running the same planner.
- Rules: no invented reviews, hours or photos; every landmark field has a source or stays blank.
- AC: each card's commute button opens trip options with that destination preset.

### F-A5 Stops and terminals — P0 (stops) / P1 (terminals)
Stop detail: name, status badge (candidate → documentary → installed → field verified → published; temporary / relocated / retired), source layer + raw code, routes and directions permitted, boarding vs alighting, curb side and "toward" cue, photos, accessibility evidence, evidence freshness, "Help improve" action.
Terminal detail: compound, pedestrian entrances, bays with route assignment, known hours.
- Rules: "Routes nearby" is never presented as "routes stopping here" unless a route-stop association exists.
- AC: a candidate stop shows "Not yet verified for navigation" and offers no verified "Plan from here".

### F-A6 Routes — P0 (catalogue) / P1 (shapes)
Route list grouped by group number; variant detail with direction, signboard/headsign, vehicle class, legal plan text, reviewed shape (if any), ordered stops (if reviewed), fare evidence, service windows, disruptions, legacy aliases/colours marked historical.
- AC: R3 shows its circuit and the Almeda–Mabolo–Southbound structure separately, never merged; R8-A/B show the Eastbound trial as a separate trial revision with "permanence unconfirmed".
- **Approximate paths vs reviewed shapes (Increment D).** Two different things are never merged. An *approximate path* is traced by software along OpenStreetMap roads from the route's legal street list (or its pins or anchors), is always labelled "Approximate path, not a verified route shape", may be flagged (dashed where it leaves the street list or runs against one-way mapping) or absent ("Path could not be traced from the street list"), and is what the map, trip guide and route detail draw today. A *reviewed shape* (evidence: GPS ride log or survey, with a named reviewer) is what P1 "shapes" means; no variant has one yet, and an approximate path never becomes one by itself. Distances, fares and time estimates computed on an approximate path say so.
- Modes: the catalogue lists jeepney routes (R1 to R8, with traditional and, on R4 and R7, modern jeepneys), tricycle feeder routes, regional UV Express and bus services (listed, not drawn) and terminals. Only jeepney routes are planned; the rest are shown with their vehicle class and evidence.

## B. Trip planning

### F-B1 Trip options — P1 (engine P0 with fixtures)
Up to 4 Pareto alternatives labelled **Recommended**, **Cheapest**, **Fewest transfers**, **Least walking**. **Fastest** appears only when travel/wait evidence is adequate.
Each option: legs summary, known fare + completeness, walk metres, transfers, confidence, restrictions, data revision. Leg fare status is `exact` / `estimate` / `unknown`; trip completeness is `exact` (all legs exact) / `estimate` (all known, ≥1 estimate) / `partial` (≥1 unknown, ≥1 known) / `unknown`.
- Rules: an option with any unknown leg fare can never be labelled Cheapest over an option with a fully known fare, and estimates rank below exact fares of equal amount [AC-6]; candidate stops never enter verified planning; when nothing qualifies, show "No verified commute yet for this trip" + nearest verified info + a candidate-exploration link.
- AC: the planner rejects wrong-direction, prohibited, disconnected and unavailable boarding [AC-5].

### F-B2 Trip detail — P1
Ordered legs: walk → board → ride → alight → transfer → … → arrive. Per ride leg: route name, signboard text, vehicle class, boarding stop code + landmark + photo, "toward" cue, alighting point, leg fare breakdown, source freshness. Walk legs show a path only if reviewed or routed by a pedestrian-profile provider; otherwise distance + "path not verified".
- AC: a walk leg crossing a mapped median without an approved crossing is rejected, not drawn.

### F-B3 Walk to boarding — P1
Foreground `watchPosition`, heading, accuracy circle, distance to curb, boarding-side cue, crossing route if reviewed. If the accuracy envelope covers both curbs → landmark/photo check: "Check you're beside [landmark]" [AC-7].
- Rules: never say "you're on the wrong side" without reviewed curb + road evidence and accuracy below half the road width.

### F-B4 Ride mode — P1
"I boarded" → progress along the reviewed shape, next stop, approaching-alighting reminder (sound/vibration if permitted, foreground only), "I got off". Off-route detection with hysteresis (≥ 3 consecutive fixes > 60 m off-shape with accuracy < 30 m) before offering a reroute; missed-stop recovery offers walking back or the next alighting point.
- Visible: "Report a driver" action; a banner explaining that alerts only work while the app is open.

### F-B5 Transfer mode — P1
Alighting curb → approved crossing / terminal entrance → next boarding curb; next vehicle's signboard and direction.

### F-B6 Arrival — P1
Last-mile walk to the destination entrance (not the centroid). On finish, stop all watchers and clear active-trip state.

### F-B7 Saved trips and offline cards — P1
Save an itinerary as a self-contained card (text steps, cached landmark photos, fares, revision, saved date). Before starting a saved trip, recheck it against the current revision and disruptions; show "Route changed since you saved this" when it did.
- AC: an offline card works with no tiles and no network, and shows snapshot date and a stale-fare warning [AC-9].

## C. Accounts and settings

### F-C1 Accounts — P1
Optional. Email OTP / magic link and Google OAuth via Managed Better Auth. Display name only; no legal name shown.

### F-C2 Settings — P1
Language (en / fil; bcl when reviewed), fare category (regular / student / senior / PWD / solo parent — with mode-scoped eligibility shown), accessibility (avoid stairs, max walk, high contrast, reduced motion), theme, low-data, trip history on/off (default **off**), location-permission guidance, offline downloads, install prompt, data export, account deletion.

## D. Contributions

### F-D1 Report a correction ("Help improve ParaNaga") — P1
Available from every stop, route, fare and trip leg. Types: wrong pin, moved / new / removed stop, route deviation, fare (official matrix / charged fare / estimate / exclusive quote), hours, crossing/accessibility, signboard alias, disruption.
Fields: entity ref + revision, proposed change, observed date/time, regular vs discounted, shared vs exclusive, optional location with accuracy, evidence photos.
- Before/after preview; similar existing submissions shown first ("Add my evidence to this").
- Statuses: draft → submitted → awaiting moderation → needs evidence → under transport review → accepted / rejected / duplicate → incorporated / superseded.
- Rules: nothing changes published data until reviewer acceptance **and** a validated publication [AC-13]; votes and multiple accounts are not proof.
- A public, sanitized changelog lists incorporated corrections.

### F-D2 Community hub — P1
Categories: commute tips, first-time questions, experiences, accessibility, service feedback, route/stop discussions. Text + moderated photos, threaded comments (depth 2), "helpful" reactions, bookmarks, author edits (re-reviewed), blocks, content reports, filters by route/stop/barangay/topic, guidelines, my submissions, appeals.
- The guideline acknowledgment (brief §9B wording, localized) appears before the first post; its version is recorded.
- Labels: Official notice / Community observation / Incorporated verified change.
- Rules: identifying allegations against drivers are routed to human review and the author is pointed to the private report; the published version is stored separately from a pending edit [AC-11].

### F-D3 Jev moderation — P1
See [Architecture §8](03-architecture.md#38-moderation-pipeline-jev). Outcomes: publish / reject / human_review. Any failure keeps content pending [AC-11, AC-12, AC-16].

### F-D4 Report a Driver (private) — P1
Entry points: ride mode, route/vehicle detail, help, report history. Tap → safety/privacy explainer → camera permission → rear-camera capture (photo; short video ≤ 30 s where supported) → preview / retake / remove. Fallbacks: file input, then text-only.
Fields: category (overcharging, reckless driving, discount refused, harassment, improper loading/unloading, other), factual description, incident time (separate from capture time), location with accuracy + manual correction, route/direction, operator, plate/body number (unknown allowed).
Acknowledgment text (brief §9D) → review page → submit → receipt with reference.
- Statuses: draft, submitted, under review, needs information, closed, withdrawn.
- Notifications: in-app notification centre for every reporter-visible status change; optional email that says only "Your ParaNaga report {ref} has an update" (no details, no evidence).
- Rules: no face recognition, no automatic identification, evidence never public [AC-14]; urgent situations show official emergency numbers (911) without implying the app is monitored.

### F-D5 MyNaga handoff — P1
After saving: "Continue in MyNaga" → steps (prepare → open MyNaga → submit there → optionally record the reference). Copy summary, download selected evidence (redacted copy by default; the original only after a warning that it may contain location metadata and bystanders), Web Share where supported, open verified links (mynaga.app, Play Store, App Store, city info page).
- Records `handoff_started`, user-confirmed `submitted_externally`, and the user-entered reference (≤ 64 chars, plain text, marked self-reported, never sent to Jev) — separate from ParaNaga's own status [AC-15].
- Rules: no invented deep link, no PII in query strings, no "delivered/received" claims.

## E. Admin and stewardship

| ID | Feature | P |
|---|---|---|
| F-E1 | Source import: upload / preview / dry-run / diff / commit; batch history, hashes, conflicts, errors [AC-1] | P0 |
| F-E2 | Candidate review queue: promote status, attach evidence, retire/relocate [AC-8] | P0 |
| F-E3 | Route and variant editor; aliases; trial/event revisions | P1 |
| F-E4 | Directed shape editor (draw/edit on map; OSM road geometry as a *drawing aid* only; validation) | P1 |
| F-E5 | Pin-to-curb reconciliation: proposes duplicate matches, never auto-merges | P1 |
| F-E6 | Stop/sign photos with a redaction step before public display | P1 |
| F-E7 | Terminals, bays, entrances | P1 |
| F-E8 | Fare rules and matrices: versions, effective intervals, conflict flags | P1 |
| F-E9 | Service windows | P1 |
| F-E10 | Disruptions with mandatory expiry and scoped entities | P1 |
| F-E11 | Publication: validate revision → publish transactionally → rollback target; cache + saved-trip invalidation [AC-8] | P0 |
| F-E12 | Coverage audit per barangay (27) | P1 |
| F-E13 | Moderation queues (community), appeals, overrides with audit [AC-12] | P1 |
| F-E14 | Complaint review console (separate role) with audited evidence access [AC-14] | P1 |
| F-E15 | Roles and users (admin only); initial-admin bootstrap | P0 |
| F-E16 | Jev status panel + synthetic diagnostic | P1 |
| F-E17 | Audit log viewer | P1 |

Publication validation (F-E4, F-E11) must flag: disconnected shapes, coordinates outside the service bbox, opposite-direction boarding, stop order not monotonic along the shape, missing fare evidence on a published variant, source-code collisions, trial revision without status, disruption without expiry, any `is_synthetic` row.
