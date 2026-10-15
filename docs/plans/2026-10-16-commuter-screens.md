# Plan: commuter screens without new user content (Increment A)

Date: 2026-10-16 · Branch: new branch from `feat/data-and-planner` after it merges (suggested `feat/commuter-screens`).
Spec: `docs/spec/02-features.md` (F-A3 search, F-A4 explore, F-A5 terminals, F-B3–F-B7 guidance and saved trips, F-C2 settings), `03-architecture.md` (§3.4 request paths, §3.11 PWA and offline), `06-screens.md` (S2, S3, S6–S9, S11, S13–S15, S20, S22, §6.5 copy rules, §6.6 accessibility), `07-delivery.md` §7.8.
Design artboards (layout, tokens, dark variants): `.superpowers/sdd/design-all/project/` — `Search`, `PlaceDetail`, `TerminalDetail`, `Walk`, `Ride`, `Transfer`, `Arrive`, `Saved`, `Settings`, `Help`, `MyNagaHandoff`, `Explore`, `Components`, and the tab bar in `.superpowers/sdd/design/Home.dc.html`. Read the markup and the `t` token objects; where an artboard shows a placeholder (`[m]`, `[landmark]`, `[hours]`, `[min]`, `[₱ fare]`, `[SIGNBOARD TEXT]`, `[hotline]`) use the copy given in this plan instead.
Audit: `.superpowers/sdd/app-audit.md` — this increment fixes **F-03** (offline navigation) and the service-worker half of **F-14**.

Goal: every commuter screen that needs no account and no user-generated content on the server, built on the data that actually exists, with honest unknown states, working offline after one visit.

## What the data allows (binding for every task)

What exists in the published revision `provisional-loops-2026-10-15`:
- 128 mapped candidate pins (45 distinct raw labels such as "Plaza Rizal", "Naga Cathedral", "Mother Seton Hospital", plus 2 blank labels), Loop A and Loop B pin orders (provisional), C and D unordered.
- 11 routes with legal street lists (document text), 2 trial circuits (Resolution 2025-735, permanence unconfirmed), fare rules F01–F04 (draft) and observation F05 with an open conflict.
- 6 terminals (T01–T06): name, location text, modes, evidence status, sources. **No coordinates, entrances, bays or hours.**
- 27 barangays: name, `not_surveyed`, source S22. **No boundaries or centroids.**
- 32 designated-stop labels from the 2025 LPTRP SimEx (S33/S34): label, type, route, direction. **No coordinates.**
- 5 external destination categories (northbound, south_suburbs, north_suburb, southbound, eastbound) with a candidate terminal; 5 feeder leads (SF01–SF05); rail status notes; 42 sources.
- Legacy route names exist only as prose in research source S28 (1993 ordinance), **not mapped to current routes**.

Added by this increment (Task 3, user decision Q1): **named places from OpenStreetMap** inside the Naga City boundary (`data/geo/naga-city-boundary.json`, OSM relation 3084673) — name, category, coordinate, OSM type/id/version, imported from a committed, dated snapshot under the ODbL. They are places, not transport data: no entrances, hours, photos or ratings come with them, and an OSM bus-station or terminal feature never becomes a ParaNaga terminal or stop.

What does not exist and must never be shown as if it did: entrances, opening hours, photos, ratings, times or durations, arrival predictions, curb sides, boarding sides, crossings, signboard text, shapes, exact fares, discounts, bay assignments.

Consequences:
- **Search** searches: OpenStreetMap places, mapped-pin labels, routes (code, name, streets named in the legal plan), terminals, barangays, 2025 study stop labels, legacy names (as unmapped historical hints), the user's saved places, and (toggle) regional destination categories. No live geocoder.
- **A "place"** is one of four things, all from data: (1) an **OpenStreetMap place** (has a coordinate; labelled "Location from OpenStreetMap — entrance not mapped"); (2) a **mapped-pin place** = pins sharing one normalized raw label within 60 m (has the pins' coordinates); (3) a **barangay** (no location); (4) a **2025 study stop label** (no location). Only (1) and (2) can be a trip start or destination. Terminals have their own screen and have no location.
- **Guidance** (Walk, Ride, Transfer, Arrive) runs on the planner's provisional option: straight-line distances, pin order, no curb, no times, no buzz. GPS progress is optional and always confirmed by the user.

## Decisions (user, 2026-10-15)

- **Earlier increment:** all decisions from `docs/plans/2026-10-15-data-and-provisional-planner.md` still apply (provisional Loops A/B on unverified pins, always badged **"Unverified route — confirm with the driver"**, no exact fares, no drawn path, walk caps 600 m / 400 m, straight-line × 1.3 estimates labelled "path not verified", ride must save walking, fare wording "from reported fare rules · matrix not verified").
- **Q1 Landmarks → OpenStreetMap.** Import named places from OpenStreetMap (ODbL) through a reproducible, pinned snapshot (Task 3). Every OSM place is marked as sourced from OpenStreetMap, the attribution "© OpenStreetMap contributors (ODbL)" is shown on every screen that lists or shows OSM places, and no entrances are invented. Place detail plans trips to/from the place's coordinate, labelled "Location from OpenStreetMap — entrance not mapped".
- **Q2 Old route names → hints only.** The S28 legacy names are shown as historical hints, not mapped to current routes.
- **Q3 Language → English only** for this increment (D8).

## Planning decisions (reviewable)

Change these before Task 1 if you disagree:
- **D1 Client-side search.** The search index is one immutable JSON per revision (`GET /api/v1/network/search-index/:revisionId`, including the OSM places), searched in the browser. It works offline, logs no queries, needs no rate limit. This replaces the spec's `GET /api/v1/search?q=` (trigram) for now; a server endpoint returns when a live geocoder is added.
- **D2 Pins from the snapshot.** Home pins are read from the immutable `/api/v1/network/snapshot/:revisionId` and filtered in memory (audit follow-up in §7.8: bbox query strings no longer reach logs; works offline). `/api/v1/stops?bbox=` stays for API clients.
- **D3 Device-local only.** Saved trips, saved places, trip history and preferences live on the device (IndexedDB via `idb`, preferences in `localStorage` because the theme must be read before first paint). No account, nothing sent to the server. Sync arrives with sign-in in Increment B.
- **D4 Tab bar without Community.** Tabs: **Map · Explore · Saved · More**. Community is added in Increment B when it has content (no dead tab).
- **D5 Explore = OSM places by category + directory.** The Explore artboard's category chips and destination cards are filled from the OpenStreetMap places (no photos: "Photo pending"; "How to commute here" plans to the place's coordinate). Below them, a directory of everything else on file: mapped-pin places, Routes, Terminals, Barangays, Leads.
- **D6 Service worker = Serwist** (spec §3.2) through its Turbopack integration, plus Next's `experimental.useOffline` for soft navigations. Task 12 starts with a spike; if Serwist's Turbopack integration does not build on Next 16.4.1 with `cacheComponents`, fall back to a hand-written `public/sw.js` with the same allow-list (record the outcome in the task report).
- **D7 No helpfulness rating** on Arrive in this increment (no backend to receive it); it returns with corrections in Increment B.
- **D8 English only** (user decision Q3). Settings shows the language as text, not a toggle.
- **D9 Report-a-driver entry points point to MyNaga** (the City's own channel, verified links in the brief §9E) until private driver reports ship in Increment B.
- **D10 OSM categories.** The import keeps only named features of these categories (OSM tags in Task 3): mall, market, school, college, university, hospital, clinic, place of worship, government office (town hall, government, police, fire station, post office), bus station / terminal, park, plaza / landmark square. Anything else (shops, restaurants, ATMs, unnamed features) is dropped. Adding a category later is a new dated snapshot.

## Global Constraints

- **Stack and rules unchanged:** Next.js 16.4 (read `node_modules/next/dist/docs/` before Next-specific code; offline guide: `01-app/02-guides/offline-support.md`, PWA guide: `01-app/02-guides/progressive-web-apps.md`), React 19, strict TS, Tailwind v4 tokens, React-Leaflet, `src/domain/**` pure, `src/client`/`src/ui` never import `src/server`, every server module imports `server-only`, all DB access through `withRequestContext`, Zod at every boundary (API params and bodies, `localStorage`/IndexedDB reads, cached JSON), no secrets printed or committed. `pnpm check:boundaries` stays green. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Database:** only Tasks 3 and 4 touch it (migration `0003_osm_places.sql`: `transit.place` + `place_version` + view; migration `0004_published_reference_views.sql`: views only). Integration tests run on a throwaway Neon branch (`scripts/with-neon-branch.sh`), never on `main`.
- **App structure:** every new screen is a route under `/app` rendered as a panel over the mounted home map (`src/ui/app-shell/app-frame.tsx`), inside `PhoneOnlyGate`. Static shells (Cache Components); runtime data inside `<Suspense>`; data from `/api/v1` or device storage in the browser.
- **Honesty:** never invent transport data. Unknown is shown as unknown with a next step. Badges: `Mapped candidate` (amber hollow), `Documented only` (grey), `Trial — permanence unconfirmed` (amber dashed), `Unverified route — confirm with the driver` (warning), `Not surveyed` (grey). Copy rules §6.5: never "live", "arriving in", "guaranteed", "official" (except a cited official source), "submitted to the city".
- **No dead buttons.** A feature that does not exist yet is plain text ("Corrections open soon") styled as a note (see audit F-08: left-aligned footnote, no pill), never a disabled-looking button or a link to nowhere.
- **Privacy:** coordinates stay on the device; nothing new is sent to the server except the existing `/api/v1/plan` POST. No location request without a tap. External links (`MyNaga`, sources) use `rel="noopener noreferrer"` and carry no query parameters.
- **Accessibility:** WCAG 2.2 AA; targets ≥ 44 px (artboards) and ≥ 48 px for primary actions; every map interaction has a list equivalent; `aria-live="polite"` for guidance progress, `assertive` only for "Para! Next stop is yours"; focus moves to each screen's `h1` on open and returns on close; Escape closes panels.
- **Tests:** Vitest unit (domain TDD, components with Testing Library), integration for Tasks 3 and 4, Playwright **mobile** project with tiles aborted, network fixtures under `tests/e2e/fixtures/network/`, and `@axe-core/playwright` on every new screen in light and dark (`colorScheme`). `pnpm verify` and `pnpm test:e2e` stay green.

## Routes added

| URL | Screen | Artboard |
|---|---|---|
| `/app/search?for=start\|destination\|save` | Search | Search |
| `/app/places/osm/[type]/[id]` · `/app/places/pin/[key]` · `/app/places/barangay/[key]` · `/app/places/study/[code]` | Place detail | PlaceDetail |
| `/app/terminals/[code]` | Terminal detail | TerminalDetail |
| `/app/explore` | Explore (OSM places by category + directory) | Explore |
| `/app/saved` (`?tab=trips\|places\|history`) | Saved | Saved |
| `/app/more` | Settings ("More") | Settings |
| `/app/help` (`?tab=help\|safety\|data`), `/app/help/[article]`, `/app/help/sources` | Help, articles, sources register | Help |
| `/app/mynaga` | MyNaga handoff (informational) | MyNagaHandoff |
| `/offline` | Offline fallback | — |
| Guidance | in the home sheet (no URL), state kept in `sessionStorage` | Walk, Ride, Transfer, Arrive |

## API added (Tasks 3 and 4)

| Endpoint | Content | Cache |
|---|---|---|
| `GET /api/v1/network/search-index/:revisionId` | OpenStreetMap places, mapped-pin places (pin groups), routes (+ legal street names), terminals, barangays, study labels, destination categories, feeder leads, legacy names | `public, s-maxage=31536000, immutable`; 404 unknown revision |
| `GET /api/v1/terminals/:code` | terminal + routes whose legal plan or trial circuit names it + destination categories + sources | `s-maxage=300, stale-while-revalidate=600` |
| `GET /api/v1/sources` | sources register cited by the published revision | `s-maxage=300, stale-while-revalidate=600` |

---

### Task 1: App shell — tab bar, page frame, endpoint channel, UI kit

Files: `src/ui/kit/` (`switch.tsx`, `segmented.tsx`, `list.tsx`, `badge.tsx`, `screen-header.tsx`, `note.tsx`, `confirm-dialog.tsx`, `kit.css`), `src/ui/app-shell/tab-bar.tsx`, `src/ui/app-shell/page-frame.tsx`, `src/ui/app-shell/app-frame-context.ts`, `src/ui/app-shell/app-frame.tsx`, `src/ui/home/home-screen.tsx` (consume requests only), `tests/unit/kit-*.test.tsx`, `tests/unit/app-frame-requests.test.tsx`, `tests/e2e/shell.spec.ts`.

- **UI kit** extracted from `Components.dc.html` (reuse existing CSS where it exists: `.pn-cell`, `.pn-badge`, `.pn-seg`, `.pn-btn`, `.pn-honest`, `.pn-note`):
  - `Switch` (`role="switch"`, label + hint, 51×31 track, reduced-motion aware).
  - `Segmented` (radiogroup or tablist variant; arrow-key navigation; artboard sliding thumb).
  - `ListGroup` / `ListCell` (link, button or static; icon, title, sub, chevron; 50–64 px rows; separators).
  - `StatusBadge` variants: `verified`, `candidate`, `documented`, `trial`, `unverified-route`, `not-surveyed`, `historical` — text + icon, never colour alone (§6.1).
  - `ScreenHeader` (large title, optional back, optional right action), `Note` (left-aligned footnote style — replaces the pill look criticised in F-08 for new screens), `ConfirmDialog` (native `<dialog>`, focus trap, Escape).
- **Tab bar** (`Home.dc.html` "Main" nav, Liquid Glass pill, bottom 24 px): Map `/app`, Explore `/app/explore`, Saved `/app/saved`, More `/app/more`; `aria-current="page"`; hidden while a pick is in progress, while guidance runs, and inside detail panels (stop, route, place, terminal); the home sheet's peek height and the map attribution offset account for it.
- **PageFrame**: like `DetailPanel` but for tab pages (no back button, tab bar visible, home layer stays `inert` underneath). Escape on any panel goes back (audit F-15 behaviour for new panels).
- **Endpoint channel** in `AppFrameContext`, same pattern as `showOnMap`: `requestEndpoint(which, endpoint)` and `requestPick(which)`; `HomeScreen` applies each request once (counter `n`) by dispatching to `endpointsReducer` (`source: "search"` with the given label) or entering pick mode, then the caller navigates to `/app`. `requestTrip(savedTripId)` is added in Task 8.

Tests: kit unit tests (switch toggles `aria-checked`; segmented arrow keys; badge renders text); request channel applies once and survives re-render; e2e: tab bar navigates Map ↔ Explore ↔ Saved ↔ More with focus on each `h1`, the home trip state survives a round trip, the tab bar is hidden in a stop panel; axe light/dark on the tab bar.

### Task 2: Preferences, theme, low-data map and the More (Settings) screen

Files: `src/domain/prefs/prefs.ts` (Zod schema + defaults), `src/client/prefs/use-prefs.ts` (localStorage, `storage` event sync, Zod-validated read, fallback to defaults on bad data), `public/theme-init.js` (sync, `<script src>` in `<head>`, sets `data-theme` and `data-contrast` on `<html>` before paint; CSP-safe), `src/app/layout.tsx`, CSS files that use `@media (prefers-color-scheme: dark)` (`globals.css`, `detail.css`, `home-screen.css`, `naga-map.css`, `trip.css`, `kit.css`), `src/client/map/use-prefers-dark.ts` → `use-color-scheme.ts`, `src/ui/map/naga-map-leaflet.tsx` (no tile layer in low-data mode), `src/ui/settings/more-screen.tsx`, `src/app/app/more/page.tsx`, tests.

- Prefs: `{ theme: "system"|"light"|"dark", highContrast: boolean, lowData: boolean, historyEnabled: boolean (default false) }`. No units setting (metric only, matches the data). No fare-category or language setting (nothing to apply: discounts are unverified, no reviewed translation).
- **Theme refactor:** every dark block becomes `:root[data-theme="dark"] …` plus `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }`, so System follows the device and Light/Dark override it. Canvas map colours read the same resolved scheme. **High contrast** (`data-contrast="more"`): secondary text uses the primary label colour, separators and outlines at ≥ 3:1, badges get solid borders; aim ≥ 7:1 for body text (§6.1).
- **Low-data mode:** the map draws no tile layer; a note on the map reads "Map background off (low-data mode)" with a text button "Show background once". Pins, stops list and trip steps unchanged.
- **More screen** (artboard `Settings`, tab "More"), exact copy:
  - Account card (static, not a link): **"Accounts arrive later"** / "Everything works without one. Saved trips and places stay on this phone."
  - General: Language row: "Language · English" + note "Filipino arrives after a reviewed translation." · Fare category row: "Fare category · Regular" + note "Discounts for students, seniors and PWD apply only where a verified fare rule allows them. None is verified yet, so ParaNaga shows regular fares." · Appearance: segmented Light / Dark / System.
  - Display and data: switches "Low-data mode" ("Hide the map background; pins and trip steps still show"), "High contrast" ("Stronger text and borders"), "Trip history" ("Off by default, kept on this device"); row "Reduce motion · Follows your device setting".
  - Location: row "Location access · Allowed | Ask each time | Blocked | Not available" from `navigator.permissions.query({ name: "geolocation" })` (no request is made) + note "Used only on this device, when you tap “Use current location” or start guidance. Change it in your browser or phone settings."
  - Install (Task 12 fills it): placeholder section omitted until then.
  - Data on this device: button "Clear data on this device" → `ConfirmDialog` "Remove saved trips, saved places, trip history and settings from this phone?" [Remove] [Cancel]; clears IndexedDB stores, `localStorage` prefs, `sessionStorage` guidance and (after Task 12) non-precache caches.
  - About: rows "Help" → `/app/help` (Task 11 adds it; until then the row is not rendered), "Data revision · {label} · {published date}" from `/api/v1/network/head`.
- Turning **Trip history off** asks "Also delete the history on this phone?" [Delete] [Keep].

Tests: unit for prefs schema (bad JSON → defaults), theme-init sets attributes for each pref, permission row mapping; e2e: switch Dark → `html[data-theme=dark]` and survives reload with no light flash (check `data-theme` before hydration via `page.evaluate` on `DOMContentLoaded`), low-data hides tile requests (no tile URL requested), clear-data empties stores; axe light/dark/high-contrast on More and Home.

### Task 3: OpenStreetMap places — pinned snapshot, import and read model

Files: `scripts/fetch-osm-places.ts` (one-off, owner-run, never in CI or at build time), `data/source/osm/naga-places-YYYY-MM-DD.osm.json` (committed snapshot; the date is the fetch date), `data/source/osm/README.md` (licence and provenance notes), `src/domain/import/osm-places.ts` (pure parser), `db/migrations/0003_osm_places.sql`, `scripts/lib/import-plan.ts` + `scripts/lib/import-writer.ts` + `scripts/import-naga.ts` (extension), `src/server/repos/places-repo.ts`, `src/domain/api/schemas.ts` (`osmPlaceSchema`), `tests/unit/import-osm-places.test.ts`, `tests/integration/import-osm-places.test.ts`, `tests/fixtures/osm/` (small hand-made extract, flagged synthetic, obviously fake names).

- **Snapshot (reproducible, pinned):** `scripts/fetch-osm-places.ts` sends one Overpass query for the area of relation **3084673** (the same relation as `data/geo/naga-city-boundary.json`) and the D10 tag filters: `shop=mall`, `amenity=marketplace`, `amenity=school|college|university`, `amenity=hospital|clinic`, `amenity=place_of_worship`, `amenity=townhall|police|fire_station|post_office`, `office=government`, `amenity=bus_station`, `public_transport=station` with `bus=yes`, `leisure=park`, `place=square`; `nwr` with `out center meta` (so ways/relations get a centre point and every element has `version` and `timestamp`). It writes the raw response verbatim plus a header object `{ query, endpoint, fetchedAt, osmBaseTimestamp, boundaryRelation: 3084673, licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors" }`. The owner runs it once; the file is committed and reviewed like any data file. The app and the importer only ever read the committed file — no network call at import or runtime. A refresh is a new dated file plus a new import.
- **Licence notes** (`data/source/osm/README.md`): source, date, query, ODbL 1.0 (share-alike for the derived database, attribution "© OpenStreetMap contributors" with a link to openstreetmap.org/copyright), what was kept (name, category, coordinate, OSM type/id/version/timestamp) and what was dropped.
- **Pure parser** `parseOsmPlaces(snapshot, boundary)`: Zod-validates the file; keeps elements with a non-empty `name` (also keeps `name:en`, `name:fil`, `alt_name`, `old_name` verbatim as aliases); maps tags to one ParaNaga category (`mall`, `market`, `school`, `college_university`, `hospital_clinic`, `place_of_worship`, `government`, `bus_terminal`, `park`, `square`) by a fixed precedence table; coordinate = node position or the element's `center`; **drops anything outside the boundary polygon** (reuse the point-in-polygon in `src/domain/geo/naga.ts`); identity = `osm:{type}/{id}`; `contentHash` over name, aliases, category, coordinate, version. Never reads or stores `opening_hours`, `phone`, `website`, `image`, entrances or any other tag (stored `tags` = only the ones used for the category, verbatim, for provenance). Duplicate names are kept as separate places (no merging).
- **Schema (migration 0003, same revision/provenance pattern as 0001):** `ingest.source` row `OSM-2026-xx-xx` (title "OpenStreetMap places snapshot", url `https://www.openstreetmap.org/copyright`, evidence type `open_data`, checked on = fetch date); `ingest.source_document` for the snapshot file (sha256, bytes); `ingest.raw_feature` rows reused with `source_layer = 'osm'`, `identity_method = 'osm_id'`; new `transit.place` (stable `id`, `osm_type`, `osm_id`, unique (`osm_type`, `osm_id`), `is_synthetic`) and `transit.place_version` (`place_id`, `name`, `aliases text[]`, `category`, `geog geography(Point,4326)` with the service-area check, `osm_version`, `osm_timestamp`, `source_code`, `raw_feature_id`, `is_synthetic`); `revision_member.entity_kind` check extended with `'place'`; view `transit.v_published_places` (`security_invoker = true`, published pointer → membership → version, synthetic hidden); `ENABLE` + `FORCE ROW LEVEL SECURITY`, `paranaga_app` select via `using (true)` policies, writes only by `paranaga_import` on draft rows; GiST on `geog`. `pnpm db:check-rls` passes.
- **Importer extension (`pnpm db:import`):** reads the newest committed `data/source/osm/naga-places-*.osm.json` alongside the existing files; dry-run prints place counts per category and the number dropped (unnamed / outside boundary / other tags). The existing importer exits "unchanged" when nothing changed, and there is no changed-data importer yet (§7.8). This task adds the narrow path it needs: when the transit files are unchanged but the OSM snapshot is new, the commit creates a **new draft revision** by copying the published revision's membership (ids only), adds the `place` members (new `place_version` rows; a re-import of the same snapshot inserts nothing), and publishes it with `transit.publish_revision` (label `osm-places-{date}`). Transit entities are carried forward unchanged, so stop/route ids and saved trips stay valid. Re-running with the same files reports `unchanged`.
- **Read model:** `places-repo.ts` `listPlaces(db, revisionId)` → `{ key: "osm:node/123", name, aliases, category, lat, lng, osmType, osmId, osmVersion, sourceCode }`; the search index (Task 4) includes them. No separate endpoint.
- **Attribution in the UI** (used by Tasks 5–7): a shared `OsmAttribution` kit component — "© OpenStreetMap contributors (ODbL)" linking to `https://www.openstreetmap.org/copyright` — rendered on every list, card and detail that shows an OSM place, plus the `OpenStreetMap` source badge on each place.

Tests: unit (TDD) on the synthetic fixture: unnamed features dropped; a feature just outside the boundary dropped; way with `center` parsed; category precedence (a `place_of_worship` that is also a `school` → one category per the table); forbidden tags never present in output; identities stable; hashing deterministic. Integration on a throwaway branch: import the fixture → `v_published_places` readable by `paranaga_app`, not writable; publish creates revision `osm-places-…` whose stop/route members equal the previous revision's; second run → `unchanged`, no new rows; synthetic places refused by `publish_revision`. **After review, the controller runs the real fetch once (owner), commits the snapshot, then runs `pnpm db:import --dry-run` and `--commit` against Neon `main` with a backup branch, as in the previous increment's Task 8.**

### Task 4: Read model — views, search index, terminals, sources

Files: `db/migrations/0004_published_reference_views.sql`, `src/domain/api/schemas.ts` (new schemas), `src/domain/search/index-build.ts` (pure builder from rows), `src/domain/search/legacy-route-names.ts`, `src/server/repos/reference-repo.ts`, `src/app/api/v1/network/search-index/[revisionId]/route.ts`, `src/app/api/v1/terminals/[code]/route.ts`, `src/app/api/v1/sources/route.ts`, `tests/unit/search-index-build.test.ts`, `tests/unit/api-reference-handlers.test.ts`, `tests/integration/reference-api.test.ts`, `tests/e2e/fixtures/network/search-index.json`, `terminal-t01.json`, `sources.json`.

- **Migration 0004** (views only, `security_invoker = true`, same pattern as 0001: start from `published_pointer → revision_member`, hide synthetic rows; `grant select … to paranaga_app`): `v_published_barangays` (name, psgc_code, survey_status, source_code), `v_published_designated_stop_candidates` (code, label_raw, label_type, route_code, direction, source_ids, source_context, operating_status), `v_published_destination_categories`, `v_published_feeder_leads`, and `create or replace view v_published_sources` extended to also union the source codes of those four views. `pnpm db:check-rls` passes.
- **Search index builder (pure):**
  - OpenStreetMap places from `listPlaces` (Task 3): key `osm:{type}/{id}`, name, aliases, category, lat, lng, OSM version, source code.
  - Mapped-pin places: group published stops by normalized raw label (NFC, trim, collapse spaces, case-fold, strip diacritics) **and** within 60 m of the group's first pin; blank labels are not places. Each group: `key` (sha256 of normalized label + first stop id, hex, first 16 chars — stable per revision), display label (most frequent raw spelling), `spellings` (all raw spellings, verbatim), `pins: [{ stopId, code, layer, lat, lng, onRoute }]`.
  - Routes: code, name, group, evidence level, `hasTrial`, and the **distinct street names** from legal street lists and trial circuits (verbatim).
  - Terminals (code, name, location text, modes), barangays (name, survey status, source), study labels (code, label, type, route, direction, source context), destination categories (category, destinations, terminal code), feeder leads (code, name, status).
  - Legacy names: `legacy-route-names.ts` holds the S28 list **verbatim** from `Data_Sets/Naga_Commuter_Research.md` §"Route amendments and local names" ("Concepcion via Panganiban/diversion", "Magsaysay", "San Felipe/Lomeda", "Pacol/Carolina", "Cararayan/San Isidro", "Bagumbayan/Calauag") with `sourceCode: "S28"`, `year: 1993`, `mappedRouteCode: null` for every entry. No colours are shown (field confirmation required by the source).
- **Terminal detail** (`/api/v1/terminals/:code`, code `^T\d{2}$`): terminal fields; `routes`: published routes whose legal street list or trial circuit contains the terminal's name (case-insensitive exact substring of the full name, e.g. "Bicol Central Station"; for T02 also "Eastbound Terminal"), each with `basis: "legal_plan" | "trial"` and the source codes; `destinationCategories` whose `candidate_terminal_code` is this terminal; `sources`. Coordinates stay `null`.
- **Sources** (`/api/v1/sources`): code, title, url, evidence type, published/enacted, checked on — ordered by code.
- Handlers: Zod-validated params, `withRequestContext` as guest, error envelope, cache headers above.

Tests: unit for the builder (Plaza Rizal group includes A1 (Loop A) and A1 (Loop C) at the identical coordinate; B1/B1 group separate if > 60 m from A1 group, together if not — assert against the real fixture; "Naga Cathedral" is a mapped-pin place; OSM places from the Task 3 fixture appear with their `osm:` keys and categories; blank B18/B19 labels are not places; legacy names all `mappedRouteCode: null`; streets for R8-A include "Bicol Central Station"); integration on a throwaway branch with the import applied: views readable by `paranaga_app`, not writable; search index has 27 barangays, 32 study labels, 6 terminals, 11 routes; T01 lists R8-A and R8-B (`legal_plan`) and the trial basis; T06 lists no routes; sources include S22 and S33.

### Task 5: Search screen and endpoints from search

Files: `src/domain/search/normalize.ts`, `src/domain/search/search.ts`, `src/client/search/use-search-index.ts` (fetch by current revision, Zod, in-memory + SW cache), `src/ui/search/search-screen.tsx`, `src/ui/search/search.css`, `src/app/app/search/page.tsx`, `src/ui/home/endpoint-sheet.tsx` (add "Search" option), `src/ui/stops/stop-detail.tsx` (add "Use as start / destination"), tests.

- **Matching (pure):** normalize as in Task 4; tokens; score = exact name 100 > name prefix 80 > token prefix 60 > substring 40 > fuzzy (character-bigram Dice ≥ 0.6, min 4 characters) 20; street-name matches score as substring of the route; ties by kind order Places (OpenStreetMap, then mapped pins), Routes, Terminals, Barangays, Study labels, Old names; at most 5 per group with "Show all {n}". Saved places (device) are searched too.
- **Entry points:** in the endpoint sheet, each row's options become "Use current location", "Choose on map", **"Search places and stops"** (→ `/app/search?for=start|destination`). Saved → Places "Add a place" opens `?for=save`.
- **Screen** (artboard `Search`): header input (label "Search places, stops and routes", placeholder **"Place, stop, street, route or barangay"**), Clear (×), "Cancel" (back). Rows above results: "Use current location", "Choose on map" (both send `requestPick`/GPS request through the channel and return to the map), switch "Include regional connections".
- **Result groups and exact copy:**
  - **Saved** — "{label}" / "Saved place".
  - **Places** — OpenStreetMap places: "{name}" / "{Category} · from OpenStreetMap" with an `OpenStreetMap` source badge → place detail (osm). Mapped-pin places: "{label}" / "Mapped stop · {Loop A, Loop C …} · candidate" with a `Mapped candidate` badge → place detail (pin). The group ends with the `OsmAttribution` line when it lists any OSM place.
  - **Routes** — "{code} {name}" with evidence badge (`Documented only`, or `Provisional stops` for A/B); when matched by a street: sub "Legal route plan lists {street}" → route detail.
  - **Terminals** — "{name}" / "Terminal · {location text} · location not mapped" → terminal detail.
  - **Barangays** — "{name}" / "Barangay · not surveyed" → place detail (barangay).
  - **Stop labels from the 2025 route study** — "{label}" / "{route code} {direction} · label only, no location" → place detail (study).
  - **Old route names** — "{name}" / "Historical name (1993) · not matched to a current route · S28". Not tappable (static cell). Group footnote: **"Old route names are historical hints, not current routes."**
  - **Regional destinations** (toggle on) — "{destination}" / "{Category} destinations from {terminal name} · services not verified" → terminal detail. Toggle note: "Regional connections on: terminal destination categories are included. Individual services are not verified."
- **States:** empty query shows recent searches? **No** (would be history; history is a separate opt-in). Empty result: **"No match in Naga — try a place, stop name, street, route or barangay."** Loading index: skeleton rows. Index failed and nothing cached: "Search needs a connection the first time. Try again." [Try again]. Offline with cached index: note "Offline · searching data from {published date}".
- **Picking** (`for=start|destination`): an OpenStreetMap place sets the endpoint to its coordinate with label "{name}"; a mapped-pin place sets the endpoint to its first on-route pin (else first pin) with label "{label} (mapped pin)"; a Saved place sets its stored point; everything else opens its detail screen. `for=save`: picking either kind of place opens the save-place dialog (Task 8).
- **Stop detail addition:** two text buttons "Set as start" / "Set as destination" (label "{name} ({code})") + note "Trips from mapped pins are unverified." They use the endpoint channel and return to `/app`.
- Search `aria-live="polite"` announces "{n} results".

Tests: unit (TDD) for normalize and ranking: "Diversion" → place "Cor. Diversion Rd. & Fraternidad St." first, old name "Concepcion via Panganiban/diversion" in Old route names, no route claims to be the "Diversion route"; "Centro" → terminal "Centro loading cluster" (T05) and every route named "Centro–…"; "magsaysay" → routes via street + places; "Penafrancia" matches "Peñafrancia"; "Iriga" only with the toggle; "xyz" → empty. "SM City" (fixture) → OSM place first with category "Mall"; e2e: search "plaza rizal" → pick → start row reads "Plaza Rizal (mapped pin)" and a plan request fires when the destination is set; search "Diversion" shows the footnote; route result opens route detail; axe light/dark.

### Task 6: Place detail and Terminal detail

Files: `src/ui/places/place-detail.tsx`, `src/ui/places/places.css`, `src/app/app/places/osm/[type]/[id]/page.tsx`, `src/app/app/places/pin/[key]/page.tsx`, `src/app/app/places/barangay/[key]/page.tsx`, `src/app/app/places/study/[code]/page.tsx`, `src/ui/terminals/terminal-detail.tsx`, `src/app/app/terminals/[code]/page.tsx`, `src/client/network/use-network-resource.ts` (reuse), tests.

- Places read their entry from the cached search index (Task 5 hook); not found → `DetailNotFound` (with a "Place" title, avoiding the doubled "Not found" of F-22).
- **OpenStreetMap place** (artboard `PlaceDetail`, map centred on the place's coordinate with one destination-style marker; tile attribution plus `OsmAttribution`): h1 name; kind "{Category} · from OpenStreetMap"; badges `OpenStreetMap` (source) and, because nothing is surveyed, no verification badge; segmented "Directions to here / Directions from here"; primary CTA **"Plan trip to {name}"** / **"Plan trip from {name}"** (sets the endpoint to the OSM coordinate, label "{name}") + note **"Location from OpenStreetMap — entrance not mapped."**; save button as below. Rows:
  - "Entrance · Not yet mapped" / "Trips end at the place's map point until an entrance is surveyed."
  - "Also known as" — OSM `alt_name` / `old_name` / localized names verbatim, only when present.
  - "Nearest mapped stops" — up to 3 mapped pins within 600 m, straight-line "≈ {m} m", each linking to its stop detail (or "No mapped stop within 600 m.").
  - "Source · OpenStreetMap, snapshot of {fetch date} · object {type}/{id} v{version}" with link "View on OpenStreetMap" (`https://www.openstreetmap.org/{type}/{id}`, new tab, `rel=noopener noreferrer`) / "Hours, photos and ratings are not shown unless sourced."
  - Photo row: "Photo pending" / "Photos open with community corrections." (text only).
- **Mapped-pin place** (artboard `PlaceDetail`, map shows the group's pins as candidate rings, no lines): h1 label; kind "Mapped stop · {n} pins"; badge `Mapped candidate`; segmented "Directions to here / Directions from here"; primary CTA **"Plan trip to {label}"** / **"Plan trip from {label}"** + note "Trips use unverified mapped pins."; save button (round, top right) "Save place" / "Saved. Remove from saved places" (Task 8 wires storage; until then not rendered). Rows:
  - "Pins with this name" → each "{code} · {layer}" linking to the stop detail.
  - "Entrance · Not yet mapped" / "Trips end at the pin until an entrance is surveyed."
  - "Also known as" — other raw spellings, only when there is more than one (e.g. "Cor. Peñafrancia Ave & Magsaysay Ave." vs "…Ave").
  - "Source · Public My Maps snapshot · retrieved {date}" / "Hours, photos and ratings are not shown unless sourced."
  - Photo row: "Photo pending" / "Photos open with community corrections." (text, no Report link).
- **Barangay**: h1 name; kind "Barangay"; badge `Not surveyed`; rows "Boundary · Not on file", "Stops in this barangay · Unknown until a boundary is mapped", "Source · {S22 title} · checked {date}". CTA **"Choose a point in {name} on the map"** (segmented to/from decides which endpoint) → `requestPick`. No map.
- **Study label**: h1 label; kind "Stop label from the 2025 route study ({source context})"; badge `Documented only`; rows "Route · {code} {direction}", "Location · Not mapped. This is a schematic label, not a curb.", "Status · Historical pilot label; current status unverified", "Sources · S33, S34". Instead of a CTA: note "No location on file, so trips can't start or end here." + text link **"Search mapped stops for “{label}”"** (→ search with the query).
- **Terminal detail** (artboard `TerminalDetail`, but no map because there is no location): header pill "Location not mapped"; h1 name; sub "{modes} · {location text}"; badges `Documented only` + "Address: {evidence label}" with source chips (e.g. S09). Note (role=note): T01 "Not the PNR railway station." · T06 "Not Bicol Central Station (the bus terminal)." · terminals with destination categories add "Category labels such as northbound and eastbound are administrative, not compass directions." Tabs **Routes · Entrances · Hours**:
  - Routes: each route from the API: chip, name, sub "Named in the legal route plan · bay not mapped" or "Named in the Nov 2025 trial · permanence unconfirmed" (+ `Trial` badge) → route detail. Then "Regional destinations": "{Category}: {destinations joined} · services not verified". Footnote: "From the legal route plan. Bays and regional services are not mapped yet." Empty: "No route plan names this terminal yet."
  - Entrances: "No entrances surveyed yet" / "ParaNaga has no location for this terminal yet, so trips can't start or end here."
  - Hours: "Opening hours · Not on file" / "Evidence · None on file".
  - Bottom: note "Directions unavailable until the terminal's location is mapped." (replaces the artboard's "Directions to the terminal" button).
- Search results and Explore link here; route detail gains no new links in this task.

Tests: unit render tests per kind (OSM place always shows the entrance-not-mapped note and attribution; no CTA on study labels; barangay CTA triggers `requestPick`); e2e (fixtures): an OSM place → "Plan trip to {name}" sets the destination at its coordinate and the attribution link is present; Plaza Rizal place → "Plan trip to Plaza Rizal" sets the destination and returns to the map; T01 shows Loop A and Loop B with the trial line and no map; T06 shows "No route plan names this terminal yet."; unknown `/app/terminals/T99` → not-found panel; axe light/dark on each.

### Task 7: Explore — OpenStreetMap places by category, plus directory

Files: `src/ui/explore/explore-screen.tsx`, `src/ui/explore/explore.css`, `src/app/app/explore/page.tsx`, tests.

- Artboard `Explore` (decision D5). h1 "Explore"; sub **"Places in Naga, and how to get there."**; search icon → `/app/search`.
- **Category chips** (tablist, artboard style): All · Faith · Schools · Markets & malls · Health · Government · Parks & plazas · Terminals — mapped from the D10 categories. Cards (artboard layout): tinted icon tile with **"Photo pending"**, h2 name, "{Category} · from OpenStreetMap", button **"How to commute here"** (sets the destination to the place's coordinate and returns to the map, which plans from the current start or asks for one) and a link to the place detail. List sorted by name; `OsmAttribution` under the list. Empty category: "No {category} on file yet."
- **Directory** (section below, segmented: Mapped stops · Routes · Terminals · Barangays · Leads):
  - Mapped stops: A–Z mapped-pin places with "{n} pins · Loop A, C" and `Mapped candidate` → place detail. (Also resolves the duplicate-row complaint F-18 for browsing.)
  - Routes: grouped by group number (`/api/v1/routes`), chip + name + evidence badge + `Trial` when present → route detail (spec S12 routes list).
  - Terminals: 6 rows "Location not mapped" → terminal detail.
  - Barangays: 27 rows `Not surveyed` → place detail.
  - Leads: feeder leads SF01–SF05 "{name}" / "Documented, not verified" (static cells, spec S13); rail status line "PNR Naga–Lupi Viejo: community reports say operational; Naga–Legazpi: community reports say suspended. Verify with PNR." from the rail note, with sources S19–S21.
- Note under the cards: **"Places come from OpenStreetMap. Entrances, hours and photos are not mapped yet."**

Tests: e2e each category chip lists the OSM fixture places of that category only; "How to commute here" sets the destination; attribution visible; each directory segment lists the right count (mapped-pin places from fixture, 11 routes, 6 terminals, 27 barangays, 5 leads); links open the right panels; axe light/dark.

### Task 8: Saved places, saved trips, Save and Share, history

Files: `src/domain/saved/saved.ts` (Zod schemas for cards/places/history, `revalidateSavedTrip`), `src/client/storage/db.ts` (`idb` — add the dependency, pinned exact; stores `savedTrips`, `savedPlaces`, `history`, `snapshotMeta`), `src/client/saved/use-saved.ts`, `src/ui/saved/saved-screen.tsx`, `src/ui/saved/save-place-dialog.tsx`, `src/ui/saved/saved.css`, `src/app/app/saved/page.tsx`, `src/ui/trip/trip-detail.tsx` (Save, Share), `src/ui/places/place-detail.tsx` (save button), `src/ui/home/endpoint-sheet.tsx` ("Save this place" on a set endpoint), `src/ui/app-shell/app-frame-context.ts` (`requestTrip`), tests.

- **Saved trip card** (self-contained, works with no network and no tiles): `{ id, savedAt, revisionId, revisionLabel, publishedAt, start: {label, point}, destination: {label, point}, option }` where `option` is the full `PlanOption` plus the stop names/codes it references (from `planLookups`). Coordinates stay on the device.
- **`revalidateSavedTrip(card, snapshot)` (pure):** same revision → `current`; different revision → `changed` unless every ride leg's variant still exists with the same ordered stop ids between board and alight and every referenced stop still exists → `unchanged_in_new_revision`. Checked on open when online (head + cached snapshot).
- **Trip detail** gets an action row: **Start** (Task 10), **Save** ("Save" → "Saved"; toggles), **Share** (Web Share API with a text-only summary, fallback copy to clipboard with "Copied"; summary lists steps by stop name/code, "Unverified route — confirm with the driver", fare text; **no coordinates, no links**).
- **Saved screen** (artboard `Saved`, segmented Trips · Places · History):
  - Trips intro (verbatim): "Saved trips open without signal. Map tiles may be missing offline, so each card works as text." Card: badge "Available offline"; `Changed since saved` when revalidation says so; "From {start}" / h2 "{destination}"; leg strip; meta line (replaces `[min] · [₱ fare] · Revision [date]`): **"Time not available · {fare chip text} · data from {published date}"**; small "Saved {date}"; CTA "Open trip" or "Review changes" (→ `requestTrip(id)`: home restores both endpoints and shows the stored option in Trip detail; "Review changes" replans and shows "Route changed since you saved this" above the options). Swipe-free delete: "Remove" text button with undo note. Empty: **"No saved trips yet. Plan a trip, then tap Save on its details."**
  - Places: rows "{label}" / "Saved place · {OpenStreetMap | Mapped pin | Pinned location}" → `requestEndpoint("destination", …)` (long-press-free: a trailing "Use as start" text button too); "Add a place" → `/app/search?for=save`; "Rename" and "Remove" per row. Save-place dialog: label input (1–40 chars, plain text) prefilled with the place label or "Pinned location". Empty: "No saved places yet."
  - History: off → verbatim artboard ("History is off" / "ParaNaga keeps no record of your trips unless you turn history on. When on, it stays on this device." / link "Turn on in More"). On → "{from} → {to} · {date}" (labels only, **no coordinates**, recorded when guidance starts, 90-day retention pruned on open) + "Clear history".
- **snapshotMeta** `{ revisionId, publishedAt }` is written whenever head is read (used by Task 12's offline banner).

Tests: unit for schemas (corrupt record skipped, not thrown), `revalidateSavedTrip` cases (same revision; variant removed; stop order changed; stop removed), share summary has no digits-with-decimal-point coordinates; e2e: plan (fixture) → Save → Saved shows the card; go offline (`context.setOffline(true)`) → card opens and shows steps; Share copies text (clipboard permission granted in test); history off by default and nothing is recorded; axe light/dark.

### Task 9: Guidance domain (pure, TDD)

Files: `src/domain/guidance/steps.ts`, `src/domain/guidance/session.ts`, `src/domain/guidance/progress.ts`, `src/domain/geo/bearing.ts`, `tests/unit/guidance-*.test.ts`.

- `guidanceSteps(option)`: from a provisional option's legs → `walk_to_board` (to the first boarding stop), `ride`, `transfer` (alight stop → next board stop, walk estimate), `walk_to_destination`; walk-only options → one `walk_to_destination`. Legs under 15 m become "Start at {stop}" (no "Walk ≈ 0 m", audit F-20).
- `session` reducer: `start(option, now)`, `atStop`, `boarded`, `paraAcknowledged`, `gotOff`, `missedStop`, `arrived`, `end`; current step index; invalid transitions ignored; serialisable for `sessionStorage` (Zod).
- `progress` (all optional, only with a fix of accuracy ≤ 50 m):
  - walk: straight-line metres to the target stop, rounded to 10 m; `nearTarget` when ≤ max(30 m, accuracy); `bearing` (8-point compass from fix to target) only when accuracy ≤ 50 m and distance ≥ 40 m.
  - ride: index of the last passed stop along the leg's pin order — monotonic (never decreases), advances only when a fix is within 120 m of a later stop; `nextIsAlight` when the next stop in the order is the alighting stop or the fix is within 300 m of it; `stopsRemaining`.
  - No off-route detection (no shape exists); no time estimates anywhere (types have no time fields).

Tests (TDD, `fast-check` properties): ride index monotonic under any fix sequence; `nextIsAlight` never fires before the stop before alighting has been reached or 300 m; poor-accuracy fixes never change state; steps for 0/1/2-ride options; bearing octants; serialise → parse round trip.

### Task 10: Guidance screens — Walk, Ride, Transfer, Arrive

Files: `src/ui/guidance/guidance.tsx` (step router inside the home sheet), `walk-step.tsx`, `ride-step.tsx`, `transfer-step.tsx`, `arrive-step.tsx`, `guidance.css`, `src/client/guidance/use-guidance-session.ts` (sessionStorage, watcher lifecycle, Screen Wake Lock if supported, released on end/visibility hidden), `src/ui/home/home-screen.tsx` (mode switch: trip detail → guidance; map highlights the current target stop only; user dot), `src/ui/trip/trip-detail.tsx` (Start), tests.

- **Start** in Trip detail starts the session. Location is **not** requested automatically: each step shows "Use my location for progress" (tap → existing `useGeolocation` watch). Without location every step works by buttons. Header for all steps: round "End guidance" (confirm "End guidance? Your trip stays in the options.") + "Step {i} of {n} · {Walk|Ride|Transfer}" + accuracy pill "± {m} m" when watching. Banner (all steps): **"Keep ParaNaga open for guidance."**
- **Walk** (artboard `Walk`): big value **"≈ {m} m"** (with GPS: live straight-line; without: the plan's estimate) + "to {stop} ({code})" + "Straight line · path not verified"; with a usable bearing: "Head {north-east}". Boarding-side card (replaces "[landmark]" copy): **"Boarding side: not yet surveyed. Ask the driver or people waiting which side {Loop A} stops on."** No landmark check (no landmarks on file). When `nearTarget`: "You look close to {stop}." Next card: "Next:" + route chip + "{direction} · Signboard not yet verified". Primary button **"I'm at the stop"**. GPS denied: "Location is off. Follow the steps and tap “I'm at the stop” when you get there."
- **Ride** (artboard `Ride`): route chip + "Direction: {clockwise} (from pin order, unverified)". Before boarding: primary **"I boarded"**. Progress (`aria-live="polite"`): title "{k} of {n} stops" (pin order, provisional) with the dot rail from the artboard; labels "{board stop} · boarded" and "Get off · {alight stop} ({code})". With GPS, the rail advances automatically; without GPS, a text button "Passed a stop" advances it manually. **Para alert** (`role="alert"`, only once per ride, when `nextIsAlight` or manually reaching the stop before): **"Para! Next stop is yours"** / "Get off at {stop} ({code}). Tell the driver now." / button **"I said “Para”"** → "Step off when the jeepney stops at {stop}, then tap “I got off”." No sound, no vibration, no promise. Actions: **"I got off"**, "I missed my stop" (→ ends guidance and replans from the current GPS fix if inside Naga, else opens pick mode for the start: "Choose where you are on the map"), text link **"Problem with a driver? Report it in MyNaga"** → `/app/mynaga`. Note: "Stop alerts work only while ParaNaga is open on your screen."
- **Transfer** (artboard `Transfer`): card "{alight stop} → {board stop}" + next route chip + "· walk ≈ {m} m"; ordered steps: 1 "Get off at {stop} ({code})" / "Drop-off side not yet surveyed"; 2 "Walk ≈ {m} m to {stop} ({code})" / "Straight-line estimate · path and crossings not verified"; 3 "Wait for {Loop B} ({direction})" / "Boarding side not yet surveyed". Signboard card: "Look for the signboard" / **"Signboard not yet verified. Ask the driver if this jeepney goes to {next alight stop}."** Buttons step by step: "I'm at {board stop}" → "I boarded {Loop B}" (goes to Ride).
- **Arrive** (artboard `Arrive`): header "Trip complete · Step {n} of {n}"; h1 **"You've arrived"**; p **"{destination label}. Guidance has ended and location tracking is off."** (watchers and wake lock stopped **before** this renders); summary strip from the option (walk ≈ m, route chip, {k} stops, walk ≈ m); save toggle "Save this trip" / "Keep it for next time, works offline" → "Trip saved" / "Available offline in Saved"; **"Done"** → clears the trip and returns to the map. No rating (D7).
- History: when history is on, starting guidance records `{from label, to label, date}`.
- Reload during guidance restores the step from `sessionStorage`; location stays off until tapped again.

Tests: unit for watcher lifecycle (no `watchPosition` call until tap; cleared on end/arrive/unmount; wake lock released); e2e (plan fixture, mocked geolocation via `context.setGeolocation`): Start → Walk shows the estimate and "Boarding side: not yet surveyed" → "I'm at the stop" → "I boarded" → move the fake fix along A-loop pins → rail advances and the Para alert appears once → "I got off" → Arrive with tracking off (assert no active watch via a test hook) → Done; a 2-ride fixture walks through Transfer; without geolocation permission every step completes by buttons; no element contains "min", "arriv" in the time sense, "live" or "₱" without "Estimate"; axe light/dark on each step.

### Task 11: Help, sources register and MyNaga handoff

Files: `src/ui/help/help-screen.tsx`, `src/ui/help/help-article.tsx`, `src/ui/help/articles.ts` (copy below), `src/ui/help/sources-screen.tsx`, `src/ui/mynaga/mynaga-screen.tsx`, `src/domain/mynaga/links.ts`, `src/app/app/help/page.tsx`, `src/app/app/help/[article]/page.tsx`, `src/app/app/help/sources/page.tsx`, `src/app/app/mynaga/page.tsx`, `src/ui/settings/more-screen.tsx` (Help row), tests.

- **Help** (artboard `Help`, tabs Help · Safety · About data, back → More):
  - Help tab links: "How trips are planned", "Why stops are not verified yet", "Using ParaNaga offline", "Report a problem with a driver" (→ `/app/mynaga`). (Correction, private driver report and My reports links arrive in Increment B.) Footer verbatim: "ParaNaga is an independent commuter guide. It is not an official City Government app."
  - Articles (`/app/help/[article]`), exact copy:
    - *How trips are planned:* "ParaNaga suggests trips on Loops A and B only. Their stop order comes from the order of pins on a public map, not from a field survey, so every suggestion carries the badge “Unverified route — confirm with the driver”. Walks to and from a stop are capped at 600 m, and 400 m between rides. Walking distances are straight-line estimates (× 1.3); paths and crossings are not checked. Fares are estimates from reported fare rules; the official matrix is not verified and discounts are not applied. There are no times: ParaNaga does not know when jeepneys run."
    - *Why stops are not verified yet:* "Every stop on the map comes from a public My Maps snapshot (retrieved 15 October 2026). Nobody has checked yet which side of the street a jeepney stops on, whether there is a sign, or whether boarding is allowed there. Until a reviewer attaches field evidence, stops stay “Mapped candidate”. Loops C and D are shown as pins only, because their stop order is unknown."
    - *Using ParaNaga offline:* "After you open ParaNaga once with a connection, the app and the transport data work offline. Saved trips open as text even when the map background can't load. Planning offline uses the data from {published date}; fares may have changed. Location works offline if your phone has GPS."
  - Safety tab: card **"In an emergency, call 911."** + "ParaNaga does not monitor reports and cannot send help." Tips (artboard list, adjusted for honesty): "Wait off the road, where other passengers wait." · "Ask the driver where the jeepney goes before you board; signboards are not verified yet." · "Keep valuables in front of you in crowded vehicles." · "Note the plate or body number if something feels wrong." · "Share your trip summary with someone you trust." Button **"Report a driver to the City in MyNaga"** → `/app/mynaga`.
  - About data tab: "What the badges mean": `Verified` "Checked against field evidence. Nothing in Naga is verified yet."; `Mapped candidate` "From a public map, not yet checked. Loops A and B use these pins for unverified trip suggestions."; `Documented only` "Named in documents, with no mapped location yet. Treat it as a lead, not a route."; `Unverified route` "A trip built from mapped pins. Confirm with the driver before you ride." Rows "Data revision · {label} · {published date}", "Sources and dates" → `/app/help/sources`. Footer verbatim: "No live arrival times. Stop alerts work only while ParaNaga is open on your screen."
- **Sources register** (`/app/help/sources`, spec S22): list from `/api/v1/sources`: "{code} · {title}" / "{evidence type} · published {date or text} · checked {date}" with an external link "Open source" (`rel="noopener noreferrer"`, new tab) when a URL exists. Footer: "The public My Maps owner is listed as “Tan Gumba”; the owner's identity is not verified." (from the `public_stop_map` note; no other attribution).
- **MyNaga handoff** (`/app/mynaga`, artboard `MyNagaHandoff`, informational version — a ParaNaga report does not exist yet, so nothing is prepared, copied or recorded):
  - Note (verbatim): **"ParaNaga is independent. It is not affiliated with MyNaga or the City Government and is not an official channel. Opening MyNaga does not submit your report."**
  - Step 1 "Prepare what you will share": checklist text "When it happened (date and time)", "Route and direction, if you know them", "Plate or body number, if you saw it", "What happened, in your own words", "Photos you are entitled to share".
  - Step 2 "Open MyNaga and submit there": buttons from `links.ts` (the four entry points verified 15 Oct 2026 in `ParaNaga_Build_Prompt.md` §9E): **"Get MyNaga on Google Play"**, **"Get MyNaga on the App Store"**, **"Open mynaga.app"**, **"About MyNaga (City of Naga)"**; the store button matching the platform is listed first. No deep link, no query string.
  - Step 3 (replaces "Tell us if you submitted it"): "Private ParaNaga reports, with a summary you can copy and a place to note your MyNaga reference, arrive later." — plain note.
  - Footer verbatim: "We can't see or confirm what happens in MyNaga."

Tests: unit: `links.ts` URLs exactly equal the brief's four URLs and contain no `?`; e2e: Help tabs and articles render; sources list shows S01–S42 subset from the fixture with checked dates; MyNaga links have `target=_blank` and `rel` containing `noopener`; clicking a link changes nothing in the app (no request to our server); axe light/dark on Help, an article, Sources, MyNaga.

### Task 12: PWA — service worker, offline shell, offline data, install

Files: `package.json` (Serwist packages pinned exactly, `idb` already from Task 8), `next.config.ts` (`experimental.useOffline: true`, Serwist wrapper or route), `src/app/sw.ts` (or `public/sw.js` per D6), `src/app/offline/page.tsx`, `src/ui/pwa/offline-banner.tsx`, `src/ui/pwa/update-prompt.tsx`, `src/ui/pwa/install-row.tsx`, `src/client/pwa/register-sw.ts`, `src/client/map/use-stops-in-view.ts` → snapshot-backed (D2), `src/client/network/use-snapshot.ts`, `src/client/trip/use-trip-plan.ts` (offline fallback), `src/ui/app-shell/tab-bar.tsx` (offline document navigation), `src/ui/detail/detail-frame.tsx` (offline-aware loading), `scripts/check-sw-cache.ts` (optional CI helper), `tests/e2e/offline.spec.ts`, `tests/unit/sw-routes.test.ts`.

- **Spike first** (≤ half a day): Serwist Turbopack integration builds and registers on Next 16.4.1 with `cacheComponents` and the Report-Only CSP (`worker-src 'self'`). Record the result; otherwise D6 fallback.
- **Registration:** production only, after `load`, scope `/`. The SW script is served `Cache-Control: no-cache` and with the same security headers.
- **Precache:** build assets (`/_next/static/**`), icons, manifest, and the static shells `/app`, `/app/saved`, `/app/more`, `/app/help`, `/app/explore`, `/app/mynaga`, `/offline`.
- **Navigation:** NetworkFirst (3 s timeout) for the precached shells; any other navigation falls back to `/offline`. `/offline` (static, client-rendered from IndexedDB): h1 **"You're offline"**, "Data from {published date}. Fares may have changed.", list of saved trip cards (open as text inline), links "Open the map" (`/app`) and "Saved" (`/app/saved`).
- **Runtime caches (allow-list only, §3.11):**
  - `/api/v1/network/snapshot/:id` and `/api/v1/network/search-index/:id` → CacheFirst (immutable), max 3 revisions each.
  - `/api/v1/network/head` → NetworkFirst (2 s timeout), cache fallback.
  - `/api/v1/stops/:id`, `/api/v1/routes`, `/api/v1/routes/:code`, `/api/v1/terminals/:code`, `/api/v1/sources` → StaleWhileRevalidate, max 200 entries, 30 days.
  - Everything else network-only: `/api/v1/plan`, `/api/v1/stops?bbox=`, `/api/auth/**`, `/api/csp-report`, any `RSC`/`_rsc` request, `/admin/**`, `/account/**`, any response with `Cache-Control: private` or `no-store`. Tiles are never cached (MapTiler terms; no offline map download is offered).
- **Soft navigation offline (fixes F-03):** `experimental.useOffline` keeps panel navigations pending instead of falling back to a browser error page; `DetailLoading` uses `useOffline()` to show **"You're offline · This opens when you're back online."** with the home trip intact. Tab bar links do a document navigation (`<a href>`) while `useOffline()` is true, so the SW serves the precached shell.
- **Pins from the snapshot (D2):** `useStopsInView` filters the cached snapshot's stops by the view (same snapping, same `MAX_STOP_PINS`), deriving `routeCodes` from snapshot variants; `/api/v1/stops?bbox=` is no longer called by the app.
- **Offline planning:** when `/api/v1/plan` fails with no connection and a snapshot is cached, `use-trip-plan` runs the same pure planner (`src/domain/planner/plan.ts`) in the browser on the cached snapshot and marks the result: note **"Planned offline from data of {published date}. Fares may have changed."** (Planner code is already pure; check the client bundle stays reasonable and `check:bundle-secrets` passes.)
- **Offline banner** (spec §3.11, in the app frame, `role="status"`): **"Offline — data from {date}. Fares may have changed."**
- **Revision change:** on reconnect compare `snapshotMeta` with `/network/head`; if changed, fetch the new snapshot and re-run saved-trip revalidation (Task 8) so changed cards get the flag.
- **Update prompt:** a new SW waits; a small card "A new version of ParaNaga is ready." [Reload] (skipWaiting on tap); never during guidance.
- **Install row** in More: Android/Chromium `beforeinstallprompt` → button "Install ParaNaga"; iOS Safari → text "On iPhone: tap Share, then “Add to Home Screen”."; already installed (`display-mode: standalone`) → "Installed".
- **Clear data** (Task 2) also deletes runtime caches.

Tests: unit for the route matcher (each allow-listed and denied URL pattern, including `?_rsc=` and `RSC: 1` header); e2e (production build, mobile): first visit online → reload offline → `/app` renders with pins from the cached snapshot and the offline banner; offline plan returns the offline-note result for the fixture snapshot; tap a stop offline → offline panel copy, trip still in the sheet (F-03 AC); unknown URL offline → `/offline` with saved cards; **Cache Storage inspection**: no entry for `/api/v1/plan`, `/api/auth`, `_rsc`, `/admin`, or any response with `private`; `navigator.serviceWorker.controller` present after reload; axe on `/offline` light/dark.

### Task 13: Verification, docs and readiness

- `pnpm verify`, `pnpm test:e2e`, `pnpm test:integration` (throwaway branch) green; `ecc:react-reviewer`, `ecc:typescript-reviewer`, `ecc:security-reviewer` (service worker, storage, external links) and `ecc:a11y-architect` passes on the whole increment.
- Visual check with `ecc:browser-qa` on Pixel 7 and 360×640, light/dark/high-contrast, every new screen.
- Copy audit: grep the built UI for `[`, "min", "live", "arriving", "official", "Exact", "verified trip"; every hit justified.
- Docs: `docs/spec/07-delivery.md` new §7.9 readiness for this increment (template §7.6), `docs/spec/03-architecture.md` §3.4 (search-index endpoint replaces `/search?q=` for now; pins from snapshot), §3.11 (what is cached), `docs/spec/06-screens.md` notes for D4/D5, `docs/spec/04-data-model.md` (`transit.place` / `place_version`, OSM source), `docs/setup.md` (OSM snapshot refresh procedure), README commands if any changed. Verify the ODbL attribution appears on Search, Explore and Place detail.

## Task order and sizing

Each task is sized for one implementer and one reviewer. Dependencies: 1 → (2, 3) → 4 → 5 → (6, 7) → 8 → 9 → 10 → 11 → 12 → 13. Task 2 and Task 3 can run in parallel after Task 1 (Task 3 is data work and can even start before Task 1); Tasks 6 and 7 in parallel after Task 5; Task 9 can start any time after Task 1 (pure domain). Task 3's real snapshot fetch and the import on Neon `main` are controller/owner steps after review.

1. App shell — tab bar, page frame, endpoint channel, UI kit
2. Preferences, theme, low-data map and the More screen
3. OpenStreetMap places — pinned snapshot, import and read model
4. Read model — views, search index, terminals, sources
5. Search screen and endpoints from search
6. Place detail and Terminal detail
7. Explore — OpenStreetMap places by category, plus directory
8. Saved places, saved trips, Save and Share, history
9. Guidance domain (pure, TDD)
10. Guidance screens — Walk, Ride, Transfer, Arrive
11. Help, sources register and MyNaga handoff
12. PWA — service worker, offline shell, offline data, install
13. Verification, docs and readiness

## Out of scope here (Increment B or later)

Sign-in, account sync of saved items, corrections ("Report a correction", "Help verify this stop", photo uploads), community, private driver reports and the report-bound MyNaga handoff (copy summary, self-reported reference), helpfulness rating, OSM entrances/hours/photos, mapping legacy route names to current routes, live geocoder, offline map tiles, Filipino and Bikol translations, verified routing (blocked by §7.5).

## Open questions for the user

None remaining for Increment A. Q1–Q3 were answered on 2026-10-15 (see Decisions). D10 (the OSM category list) follows the categories you named; adjust it before Task 3 if you want more or fewer.
