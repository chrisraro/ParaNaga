# Design: Travel out of Naga ("Leaving Naga")

> **Draft written by AI on 2026-10-28 (ecc:architect, opus). Not yet approved by the owner.** No code has been written. Evidence comes from `docs/research/2026-10-28-naga-intercity.md`. Decisions are listed in §9.

## 0. What already exists (and one honesty bug)

- **Regional services:** `transit.regional_service` and `_version` (migration 0006) hold RS01–RS07:
  - RS01 Goa jeepney
  - RS02–RS03 Florencia buses to Goa and Lagonoy
  - RS04 Pasacao jeepney
  - RS05 Tabaco UV Express
  - RS06 PITX bus
  - RS07 Santa Rosa bus

  Current limits on these rows:
  - `mode` must be `uv_express`, `bus` or `jeepney`.
  - `status` must be `community_mapped`.
  - `osm_relation_ids` must not be empty.
  - `destination` is free text.

  They are listed on the terminal detail screen with per-km fare **estimates** (`regional.ts`, F06–F12 and F01), and they are never planned.
- **Terminals:** T01 BCS, T02 Eastbound, T03 LCC/Southbound, T04 Northbound and T06 PNR are versioned, and `kind` already includes `station`. Coordinates come only from OSM. T02's location is in conflict.
- **Unused tables:** `transit.rail_status` and `transit.external_destination_category` are left over from seed v1. Neither has versions.
- **Honesty bug:** RS06 "PITX–Naga (Philtranco; Bicol Isarog)" still appears as a running service. The research found that Philtranco stopped on 2026-03-30 with no sign of resuming, and found no Naga departures for Bicol Isarog. Whatever else is decided, increment IC1 must fix this.
- **Publish path:** draft → validate → step-up → publish (0023). The two-person rule exists, but only as the optional flag `publish_requires_second_reviewer`.

## 1. Goal and non-goals

**Goal.** Someone in Naga can answer three questions for a town or hub outside the city:
1. Which terminal and which mode do I use?
2. How do I get to that terminal? This uses the existing in-city planner.
3. What is known about the fare, departures and status, with the date each was checked and how sure we are?

Every fact keeps its evidence level. Anything we don't know is labelled as unknown.

**Non-goals:**
- Booking, seat availability, or deep links to booking sites.
- Live tracking or "next departure" countdowns.
- Drawing intercity route lines on the map.
- Routing that crosses the city boundary.
- Sea and ferry schedules (notes only).
- "Arriving in Naga" (left for later).
- Fares by seat class, or ranking one operator over another.

## 2. User stories

- **U1 Tourist going to Manila after Peñafrancia.** Picks *Manila (Cubao / PITX / Alabang)*.
  - All buses go from BCS.
  - Operators are shown as "Listed on a booking site, Sep 2026, not verified".
  - "Get to BCS" runs the in-city planner.
  - The LTFRB per-km estimate is shown separately.
- **U2 Student going home to Partido.**
  - BCS buses show "dispatch every 12 min (terminal rule)".
  - Eastbound jeepneys and vans show "fare not found".
  - Terminals with unconfirmed locations show the address text and no planner button.
- **U3 Rider taking the train to Libmanan or Sipocot.**
  - PNR Naga–Lupi Viejo shows "Operating, limited: 3 trips a day each way".
  - Times are labelled "at launch (Nov 2025), current times not confirmed".
  - The fare range is from launch.
  - "Get to Naga station" runs the planner.
- **U4 Rider going to Legazpi by train.**
  - Naga–Legazpi rail shows "Suspended since 10 Nov 2025 (bridge damage). No reopening date."
  - Bus and van options are shown first.
- **U5 Flyer to Clark.** Naga Airport (WNP, Pili) shows "Cebgo to Clark, daily (as of Mar 2026)". Access is given as text steps, and the fare shows "not found".
- **U6 Asking about the Bicol Express.** The rail status card says "South Long Haul: planned, not funded. No trains run." It never appears as an option.

## 3. Data model

### 3.1 The city-boundary assumption

The current code assumes everything is inside Naga. Out-of-city places would break these parts:

| Code | Today | What breaks |
|---|---|---|
| `domain/api/plan.ts` | refuses points outside `isInsideNaga` | 400 for airport and Legazpi |
| `planner/plan.ts` | coverage `none` / `outside_city` | no options returned |
| `terminal_version_in_city`, `place_version_in_city` | envelope 123.05–123.40 E, 13.45–13.80 N | Pili fits. Goa, Iriga, Legazpi and Manila are rejected |
| `NAGA_MAX_BOUNDS` and polyline refines | city + 0.01° | any out-of-city point fails validation |
| walk graph, far areas, ETA | city only | no walking leg or time estimate |
| search | city geography plus a "regional" toggle | town names are free text only |

**For IC1, destination towns have no coordinate.** They are named records, with an optional PSGC code, linked to services. The only places the app routes to are in-city terminals. The airport gets a terminal row (its location fits the envelope), but it is not a planner destination.

### 3.2 Changes to existing tables

1. **`ingest.source`**
   - Add the code family `^IC[0-9]{2}$`. Research codes R1–R35 become IC01–IC35, because R-codes collide with the `R[TLPH]` families.
   - Add `evidence_type` values `booking_site` and `travel_guide`.
   - Copy the research doc into `data/source/research/` with its sha256.
2. **`regional_service_version`** (all additive)
   - `mode`: add `rail` and `air`.
   - `status`: add `operating`, `operating_limited`, `suspended`, `discontinued_reported` and `unconfirmed`.
   - New columns:
     - `status_since date`
     - `status_note_code` (an enum, so it can be localised)
     - `as_of date not null`
     - `review_by date not null`
     - `destination_codes text[]`
     - `access_note_code`
   - `osm_relation_ids` may be empty, but only when `distance_km` is null.
   - CHECKs:
     - `operating` needs an official or news source.
     - `suspended` needs `status_since`.
3. **`terminal_version`:** add kind `airport` and mode `air`. T02 stays as address text until it is checked on site.
4. **`fare_rule` F06–F12 and F01:** no change. The 4 km vs 1 km jeepney minimum is recorded as an open `fare_conflict`, so the app shows the rates without a computed total.
5. **`transit.fare_observation`:** reuse it for fares from booking sites and old listings.
   - Add `kind = 'operator_listing'`.
   - Add `regional_service_id` and `seat_class_text`.
   - `observed_at` (the month) is required.
   - Observations are never treated as rules and are never added together.
6. **`rail_status` and `external_destination_category`:** keep them read-only, as history only.

### 3.3 New tables

| Table | Fields | Why the existing tables don't fit |
|---|---|---|
| `transit.regional_destination` and `_version` (membership kind `regional_destination`) | `code` (e.g. `D-LEGAZPI`), `name`, `aliases[]`, `group_code` (partido, rinconada, albay, cam_norte, nw_camsur, manila, luzon_air), `psgc_code`, `kind` (town, hub, airport, station), `geog` (null in IC1), `source_codes`, `content_hash`, `is_synthetic` | today's destinations are free text and have no versions |
| `transit.regional_departure` (child rows of one `regional_service_version`, no new membership kind) | `pattern` (listed_times, headway_rule, when_full, operating_hours, daily_unspecified), `times time[]`, `headway_min`, `hours`, `day_type`, `basis` (official, terminal_rule, booking_site, news, at_launch), `observed_on`, `source_codes` | `service_window` belongs to the in-city variants |

The service version's `content_hash` covers its departures and observations, so publish validation sees every change.

## 4. Planner and screen design

| | **A. "Leaving Naga" guide** | **B. Full intercity routing** |
|---|---|---|
| What it is | Pick a destination. See its services by mode, the terminal, and a "Get to {terminal}" button that runs the in-city planner. Fares and status carry badges | One plan from the origin all the way to Legazpi |
| Data needed | What the research already has | Destination coordinates, egress stops, timetables and fares per leg (mostly unknown) |
| Code impact | New screen, an endpoint, a seed import and validation. **The planner is untouched** | Boundary changes in 5 places, new edge types, ranking with unknown values |
| Honesty risk | Low | High: ranking would rest on unknown data |
| Size | One increment | Several increments, blocked on field data |

**Recommendation: A for IC1.**

**Screen S24 "Leaving Naga"** (`/app/leaving`, `/app/leaving/{code}`)

- **Entry points:**
  - an Explore section card
  - search under "Include regional connections"
  - a "Destinations from here" link on terminal detail
  - Help
- **List view:**
  - destinations grouped by `group_code`, with a search box
  - rail status and airport cards pinned at the top
- **Detail view:**
  - One card per service, sorted operating → limited → unconfirmed.
  - Suspended and discontinued services go in a muted "Not running" section.
  - Each card shows:
    - mode
    - the operators as listed
    - the terminal
    - "Get to {terminal}" (opens S4 with To set to the terminal), or "Location being confirmed" with no button
    - a status pill with its "as of" date
    - departures and fare blocks
    - a sources link
- **Copy rules:** never use "schedule", "next bus", "on time" or "book". Keep each card to 24 words or fewer.

## 5. Trust and badging

| Case | What the app shows | Rule |
|---|---|---|
| Rule estimate | "Estimate ₱X–₱Y (28 Sep 2026 rate) · operator prices may differ" | uses the existing `regional.ts` |
| Booking-site fare | "₱1,112 regular · listed on a booking site, Sep 2026 · not verified" with a Low chip | shown next to the estimate, never merged with it or ranked; hidden after `review_by` |
| Old or undated listing | "₱140 (listing from Oct 2023) · likely changed" with an Old chip | stale from the start |
| Official at launch | "₱15–₱75 regular at launch (Nov 2025) · current fares not confirmed" | `basis = at_launch` |
| Single source | a "Single source" chip | computed, not stored |
| Suspended | a grey pill: "Suspended since 10 Nov 2025 · bridge damage · no reopening date"; no fare, no departures | a CHECK blocks fares and departures on suspended versions |
| Reported discontinued | "Stopped service reported (Mar 2026) · no resumption found" | listed under "Not running" |
| Planned only (South Long Haul) | one line in the rail card: "Planned project · not funded · **no trains run**" | a `dataset_note`, never a service row; validation fails if it is cited as operating |
| Stale (today is past `review_by`) | an amber "may be out of date · as of {date}"; booking-site amounts hidden | computed on the device in Manila time, so it also works offline |
| Unknown | "Fare not found — tell us what you paid" / "Departure times not found — ask at the terminal" | NULL never becomes 0 |

Evidence chips come from the source's `evidence_type`, which a reviewer assigns. The AI's High/Medium/Low labels are stored as `ai_confidence` for reviewers only and are never shown to users.

## 6. Admin and review flow

1. **Seed.** `data/source/research/naga-intercity-seed-2026-10-28.json`. Every record has a review block: `{ decision, reason, reviewedOn, reviewer }`.
   - Excluded by default:
     - the 2025 Naga–Legazpi fares
     - ALPS
     - Roger Lines and the R34 snippet
     - fares from blog posts dated 2013–2019
2. **Import.** `scripts/import-intercity.ts --dry-run|--commit` writes into the one open draft. It never publishes.
3. **Validation.** New `publicationBlockers` checks:
   - **Errors:**
     - suspended or planned services with fares or departures
     - a booking-site observation without a month
     - `review_by` earlier than `as_of`
     - a service whose terminal is not a member
     - `is_synthetic`
     - planned-project text on an operating service
     - an unknown destination code
   - **Warnings:**
     - `operating` with `as_of` older than 180 days
     - a destination with no service
     - a terminal without a coordinate
4. **Publish** with step-up and a second reviewer.
5. **Upkeep.**
   - The A1 dashboard gets a "Regional facts past review date" count.
   - In IC1, edits are made with a new seed plus import.
   - Admin editors and correction types come in IC2.

## 7. i18n, offline and performance

- **i18n:**
  - Write English first. Filipino must be complete, since typecheck enforces it.
  - Bikol falls back to Filipino, then English.
  - Proper nouns are not translated. Aliases are searchable.
  - Use note codes rather than free text.
  - Admin screens stay English-only.
  - Times use the 24-hour clock in Manila time.
- **Offline:**
  - `GET /api/v1/network/intercity/:revisionId` is immutable and returns 404 unless the revision is published.
  - The service worker caches it CacheFirst and keeps the last 3 revisions. It is fetched the first time S24 opens.
  - Expiry is computed on the device.
- **Performance:**
  - About 25 KB raw, 6 KB gzip.
  - No effect on the planner snapshot, the walk graph or `/plan`.
  - S24 is a client island with no map on the list view.
- Read `node_modules/next/dist/docs/` before implementing.

## 8. Increment plan

### IC1 "Leaving Naga" guide

**Scope:**
- the migration (§3)
- the seed and its import
- the validation rules
- the intercity endpoint and its service-worker rule
- S24 list and detail
- the rail status and airport cards
- the entry points
- the S23 `?service=` view
- en and fil strings
- the RS06 correction

**Acceptance criteria:**
- **AC-IC1:** No point outside the city reaches the planner. "Get to" appears only for member terminals inside `isInsideNaga`.
- **AC-IC2:** On *Legazpi*, PNR is under "Not running" as "Suspended since 10 Nov 2025", with no fare and no departures. Importing a suspended service with a fare fails validation.
- **AC-IC3:** The South Long Haul never appears as a service. It shows only as "no trains run".
- **AC-IC4:** Every fare shows its basis and its month. Fares are never added together and none is labelled "cheapest".
- **AC-IC5:** Once the device date is past `review_by`, the card shows "may be out of date" and booking-site amounts are hidden, including offline.
- **AC-IC6:** RS06 is no longer shown as operating. Philtranco shows "Stopped service reported (Mar 2026)".
- **AC-IC7:** Every seed record has a human decision. Re-running the import writes nothing new. Publishing needs step-up and a second reviewer.
- **AC-IC8:** S24 works offline after one visit. Unknown values read "not found" with a next step. axe passes in light and dark modes.

### Later increments

- **IC2 Stewardship:**
  - admin editors for services, departures and observations
  - correction types ("I paid ₱X", "left at 20:00", "terminal moved")
  - an expiry queue
  - an on-site check of T02
- **IC3 Geography:**
  - out-of-city points, kept inside a "Bicol envelope"
  - pins for the airport and terminals
  - "Arriving in Naga"
- **IC4 Planner handoff:** when a trip ends at a terminal, trip detail adds "Then: buses to Legazpi from here".
- **Option B** waits until verified timetables and fares exist.

## 9. Open decisions

The first option listed in each is the recommendation.

1. **Where S24 lives:** (a) an Explore section, plus regional search results and terminal links; (b) a new bottom tab; (c) only under More > Help.
2. **Booking-site fares:** (a) shown with "booking site, {month}, not verified" and hidden after 120 days; (b) always shown, with the date; (c) never shown.
3. **South Long Haul:** (a) one line in the rail card, "planned, not funded, no trains run"; (b) not mentioned; (c) a service row with status `planned_only`.
4. **Suspended Naga–Legazpi rail:** (a) shown under "Not running" with the date and cause, alternatives listed first, `review_by` 30 days; (b) hidden; (c) shown on the rail card only.
5. **Expiry windows:** (a) set per basis: official 365 days, terminal rule 365, news 180, booking site 120, travel guide or undated stale from the start; (b) one 180-day window for everything; (c) no expiry, only the "as of" date.
6. **Two-person publish:** (a) turn it on now and name a second reviewer; (b) turn it on only for intercity changes; (c) leave it off and show "reviewed by one person".
7. **Old or undated van fares:** (a) drop the 404 snippet, and show the 2023 listing as "Old listing, likely changed" next to the estimate; (b) drop both; (c) include both with an Old chip.
8. **Airport:** (a) terminal kind `airport` plus a Cebgo service row, with text steps and no planner; (b) a Help article only; (c) wait for IC3.
9. **RS06 Philtranco / Bicol Isarog:** (a) a new version with status `discontinued_reported`, Bicol Isarog removed, shown under "Not running"; (b) dropped; (c) marked `unconfirmed`.
10. **Destination scope for IC1:** (a) the Ordinance 2024-032 groups' towns, the Manila hubs, Daet, Tabaco, Clark and the Lupi Viejo line stations; (b) every Bicol municipality; (c) groups only.
11. **Research source codes:** (a) a new `IC01–IC35` family with a mapping table; (b) widen the code pattern to `R[0-9]{2}`; (c) file them under N codes.
