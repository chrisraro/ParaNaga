# 1. Product spec

## 1.1 Problem

Naga City has an approved jeepney network (Ordinance 2025-070: 8 route groups, 11 route/variant records, 282 allocated Class 2 units), four Centro–Magsaysay loops with a public pin map, regional terminals, and tricycle/padyak feeders. None of it is navigable for a newcomer:

- Route plans are street lists, not shapes. Loops run in one direction, and downtown streets are one-way, so the return trip uses different curbs.
- Boarding points are informal or newly designated; signs are going up along Magsaysay and Peñafrancia, but no current register is public.
- Fares come from a national announcement (₱14 / ₱17 minimum, 28 Sep 2026), a 2024 local tricycle ordinance (₱15, 20% discount), and conflicting reported practice (EASTTODA ₱13 student).
- Tourists, students and newcomers do not know which side of the road to wait on, which signboard to read, or when to get off.

## 1.2 Who it is for

| Persona | Situation | Top questions |
|---|---|---|
| **Tourist / pilgrim** (Peñafrancia season) | First visit, mobile data, English or Filipino | How do I get from BCS to the Basilica? What do I tell the driver? |
| **New student** (ADNU, UNC, BISCAST, NCF) | Daily commute, tight budget, discount-eligible | Cheapest way to school? Do I get a student fare on this mode? |
| **Resident commuter** | Knows some routes, not all | Is there a jeepney from Pacol to the hospital? Did the loop change? |
| **Contributor** | Rides daily, notices errors | The pin is on the wrong side; the fare is now ₱15 |
| **Transport-data reviewer** (city/partner volunteer) | Owns data truth | What evidence supports this curb? Can I publish this revision? |
| **Community moderator** | Keeps the hub useful | Is this post spam, harassment, or legitimate criticism? |
| **Complaint reviewer** | Handles private driver reports | Is this report complete enough to help the reporter escalate to MyNaga? |
| **Administrator** | Runs the system | Who has which role, what changed, is Jev healthy? |

## 1.3 Product principles

1. **Useful map first.** The home screen is a map with search and a draggable trip sheet; no marketing wall.
2. **Honest over complete.** Every fact carries an evidence level. An empty, clearly labelled state beats a confident wrong answer.
3. **Guest by default.** Search, explore and plan need no account. Accounts sync favourites and enable contributions.
4. **Outdoor-readable, one-handed.** Large targets (≥ 48 px), high contrast, bottom sheet on mobile, map/list split on desktop.
5. **Landmarks over left/right.** "Wait beside NCF Magsaysay, toward Centro" beats "turn left".
6. **Least data collected.** No continuous location history, no ID scans, no device fingerprinting.
7. **Bilingual from day one.** English and Filipino; structure ready for reviewed Bikol (Central Bikol, `bcl`).

## 1.4 Scope

### In scope (v1)

- Consumer PWA: map, search, explore, trip options, trip detail, walk/ride/transfer/arrive guidance, stops, routes, saved trips, settings, offline cards.
- Contributions: corrections with evidence, community hub with Jev moderation, private driver reports with MyNaga handoff.
- Admin: import/preview, route/variant/shape/stop editing, curb reconciliation, fares, service windows, disruptions, moderation queues, coverage audit, publication/rollback, Jev health.
- Modes modelled: walk, traditional jeepney, modern jeepney. Schema supports trimobile, e-trike, padyak, van, bus, rail, ride-hail link-outs.

### Explicit non-goals (v1)

- Live vehicle positions or arrival countdowns (no fleet feed exists).
- Background tracking or alighting alerts while the browser is suspended.
- Ride-hailing price quotes (link out only).
- Face recognition, automatic driver identification, public driver blacklists.
- Automatic submission to MyNaga or any government system.
- Bulk download of third-party map tiles.

## 1.5 Day-one truth (what the data supports today)

| Capability | Supported by current data? | Behaviour at launch |
|---|---|---|
| Explore 128 mapped loop pins (A 30 / B 31 / C 34 / D 33; 114 distinct coordinates) | Yes, as **candidates** | Shown with "Mapped candidate — not verified" badge |
| Route catalogue for R1–R8-D with street lists and allocations | Yes, documentary | Route pages show legal plan text, no drawn shape |
| Verified itineraries | **No** — no reviewed shapes, stop orders, curbs | Planner returns "No verified coverage yet" + nearby candidates |
| Exact fares | **No** — no applicable local matrix | "Minimum reported fare ₱14 (traditional) / ₱17 (modern); matrix verification pending" |
| Terminals (T01–T06) | Names and addresses; no coordinates | Listed by name; map pin only after a reviewer geocodes with evidence |
| Feeders (SF01–SF05) | Documentary leads | Shown as "documented, unverified" in Explore only |
| 27 barangays | All "not surveyed" | Coverage dashboard shows all 27 as gaps |

The product launches as an honest explorer and contribution tool, then gains verified planning corridor by corridor as reviewers publish revisions. That is the intended path, not a gap to hide.

## 1.6 Success measures

| Measure | Target (first 6 months after first verified corridor) |
|---|---|
| Verified corridors published | Loops A–D both directions, then R2/R5/R6 |
| Trip plans returning ≥1 verified itinerary (inside covered area) | ≥ 80 % |
| Reported "wrong side / wrong stop" per 1 000 started trips | < 5 |
| Corrections triaged within 7 days | ≥ 90 % |
| Community posts auto-decided by policy (not human queue) | 60–80 %, with appeal overturn rate < 10 % |
| Moderation false-publish of prohibited content | 0 known incidents per month |
| Private evidence access outside complaint-review role | 0 (audited) |
| Core Web Vitals on mid-range Android over 4G | LCP < 2.5 s, INP < 200 ms |

## 1.7 Key risks

| Risk | Mitigation |
|---|---|
| Data never reaches "verified" | Field-survey kit (template CSV), reviewer tools, contributor pipeline, per-barangay coverage dashboard |
| Users treat candidates as truth | Persistent badges; planner refuses candidates; copy reviewed |
| Moderation errors harm trust | High-certainty thresholds, human review when uncertain, one appeal per decision, replayable policy |
| Driver complaints become defamation vectors | Private by design, no public allegations, neutral outcomes, no findings of guilt |
| Provider cost spikes (tiles, Jev) | Self-hosted PMTiles; Jev budget caps and circuit breaker; rate limits |
| Name/brand conflict | "ParaNaga" is a working name; trademark/domain unchecked |
| Map attribution confusion | My Maps owner shown as display name "Tan Gumba" only; no authorship or city endorsement implied |
