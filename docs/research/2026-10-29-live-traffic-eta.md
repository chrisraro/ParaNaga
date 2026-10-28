# Live traffic ETA for the in-trip screen: options and cost

> **AI-written draft (Claude, 2026-10-29).** Not owner-approved. Numbers come from the fetched pages listed in Sources. Anything marked **UNVERIFIED** could not be confirmed from an official page and must be rechecked before it drives a decision. Not legal advice: licence terms need a human read.

## Bottom line

1. Google's live-traffic ETA is not free at this app's volume, and it is the most restricted for display: Routes API results shown on a map must be on a Google Map. Our map is Leaflet/OSM, so Google ETAs cannot go on it. Showing Google ETA as text only is allowed, with the Google logo and attribution (Google policies page, see below).
2. Google traffic-aware routing is a **Pro** SKU: 5,000 free calls per month, then $10 per 1,000 up to 100k. At 1,000 trips/day with a single call per trip that is roughly $250/month.
3. No free source gives real-time traffic for Naga with a clean licence for a Leaflet map. OSM has no traffic. The free routers (OSRM, Valhalla, openrouteservice, GraphHopper free) are static or non-commercial.
4. Cheapest accurate approach: **an on-device ETA that blends the rider's own GPS speed with stored time-of-day speed profiles per route segment.** Cost is $0 beyond the existing Neon/Vercel. Jeepneys follow fixed routes at predictable speeds, so this fits better than car-traffic data, which models private cars, not jeepneys that stop to load.

## 1. Google Maps Platform (as of 2026-10-28)

### Routes API (computeRoutes, computeRouteMatrix)

Prices are USD per 1,000 billable events (pricing page, last updated 2026-10-28 UTC).

| SKU | Free per month | To 100k | 100k-500k | 500k-1M | 1M-5M | 5M+ |
|---|---|---|---|---|---|---|
| Compute Routes Essentials | 10,000 | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Compute Routes Pro | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.75 |
| Compute Routes Enterprise | 1,000 | $15.00 | $12.00 | $9.00 | $4.50 | $1.14 |
| Compute Route Matrix Essentials | 10,000 | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Compute Route Matrix Pro | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.75 |
| Compute Route Matrix Enterprise | 1,000 | $15.00 | $12.00 | $9.00 | $4.50 | $1.14 |

- **Tier mapping (usage-and-billing page, 2026-10-28):** Essentials is basic requests with at most 10 intermediate waypoints. **Pro** is any request using an advanced feature, and the page names `TRAFFIC_AWARE` and `TRAFFIC_AWARE_OPTIMAL` as examples. Enterprise is for features like two-wheel or large-vehicle routing. So both traffic preferences bill as Pro. The usage-and-billing page itself lists no free caps (the pricing page does).
- `TRAFFIC_AWARE_OPTIMAL` on Route Matrix is capped at 100 elements per request. Matrix is billed per element (origins x destinations).
- Not verified: the per-SKU free caps are as shown on the pricing page. I did not find a separate March 2025 announcement page; the table above is the current state.
- Which Google tier a plain `TRAFFIC_AWARE` call without other advanced options lands in: page says Pro. Stated plainly, treat Pro as the planning number.

### Distance Matrix (legacy) and Roads API

- Distance Matrix (Essentials): 10,000 free, $5.00 per 1,000 to 100k, then $4.00. Distance Matrix Advanced (Pro): 5,000 free, $10.00, then $8.00. Billed per element.
- Directions API (Legacy): the policies page says it is in Legacy status, and that as of October 2026 it can no longer be enabled for new Google Cloud projects. Use Routes API for anything new. A similar notice for Distance Matrix was not on the page I read (UNVERIFIED).
- Roads API: Nearest Road and Route Traveled are Pro, 5,000 free, $10.00 per 1,000. Speed Limits is marked "Limited access", $20.00. Roads API snaps GPS traces and returns speed limits; it returns no live traffic or ETA, so it does not help here.

### Terms: display, caching

- **Display (Routes API policies page, 2026-10-28):** "Routes API results displayed on a map must be shown on a Google Map, and attribution, including the Google logo, is required if not displayed on a Google Map." So a Google-derived route line or ETA overlay on our Leaflet/OSM map is out. A text-only ETA with Google attribution is the permitted form, but that reading is mine; confirm with the full terms.
- **Directions (legacy) policies page:** same rule, "Directions API results displayed on a map must be shown on a Google Map."
- **Caching:** the Routes policies page says caching of most Routes content is restricted and only place IDs can be stored indefinitely. The detailed clause in the Service Specific Terms (cloud.google.com/maps-platform/terms/maps-service-terms) did not load in my fetches, so the exact Routes caching rule and any "no use with a non-Google map" clause number is **UNVERIFIED**. A search snippet showed that the Directions section has such a clause (3.2) and a 30-day lat/lng caching limit; do not assume Routes is identical. Practical consequence: do not store Google ETAs to build our own speed profile.
- EEA customers have stricter rules (route steps cannot be shown with a non-Google map). Not relevant to the Philippines.

### Coverage in Naga / Bicol

**UNVERIFIED.** I found no official Google coverage list for Philippine cities. Test it directly: in Google Maps for Naga, open the Layers menu and check the Traffic layer for coloured segments, then call `computeRoutes` with `TRAFFIC_AWARE` and compare `duration` against `staticDuration` at peak and off-peak. If they are equal, there is no live signal there and the Pro price buys nothing. Also note Google DRIVE mode models private cars, not jeepneys.

## 2. Free and open alternatives

| Option | Free quota | Traffic | Licence for Leaflet/OSM map | PH coverage |
|---|---|---|---|---|
| OpenStreetMap | Tiles per OSM tile usage policy; no routing API | No traffic | Open (ODbL, attribution) | Road network yes |
| OSRM | Self-host free; public demo server is not for production | No live traffic out of the box (can take custom speed updates) | Open (BSD/ODbL data) | OSM-based. Not fetched: from general knowledge, UNVERIFIED |
| Valhalla | Self-host free | Can ingest traffic speed tiles you supply; no feed included | Open (MIT) | OSM-based. UNVERIFIED |
| openrouteservice | Free Standard plan: Directions 2,000/day, 40/min; Matrix 500/day (from search snippet quoting the official plans page; the page itself returned 404 for me) | No (static); only a third-party review said so, UNVERIFIED | Open data; check plan terms | OSM-based |
| GraphHopper | Free package: 500 credits/day, **non-commercial only**, 5 locations per request. Paid: Basic EUR 69/mo for 5,000 credits/day (third-party quote; official page snippet differed) | Not shown in what I found | Open data | OSM-based |
| TomTom | Free monthly (docs.tomtom.com/pricing): Routing 20K, Traffic Flow Segment Data 20K, Traffic Incidents Details 2.5K, Traffic tiles 200K. (No "2,500 per day" tier found; it is 2.5K/month for incidents) | Yes: Routing API `traffic=true` by default, `trafficDelayInSeconds` is real-time, `departAt`, `computeTravelTimeFor=all` gives live vs historic vs no-traffic | Page did not state; terms not read, **UNVERIFIED**. Commercial use on free tier not stated | Traffic API market coverage page 404; **UNVERIFIED** for Bicol |
| HERE | Base plan has a free monthly allowance per product. Conflicting figures: Traffic 5,000, vector tile 30,000, third parties claim 250,000. Official 2026 Routing v8 number not confirmed | Yes (Traffic API / routing with traffic) | Not confirmed | Not confirmed |
| Mapbox | Directions 100,000 requests/month free, then $2.00 per 1,000 (100k-500k), $1.60 (500k-1M), $1.20 (1M+). Matrix: 100,000 elements | `driving-traffic` profile uses live + typical traffic; reverts to `driving` where no traffic coverage (Mapbox docs via search). The pricing page itself did not name the profile | Mapbox docs show Directions GeoJSON drawn on Leaflet; ToS page read had no non-Mapbox-map ban, but the Product Terms were not included, **UNVERIFIED** | Traffic coverage in Naga **UNVERIFIED** |
| Waze for Cities | Free two-way data exchange for public agencies (city, LGU, DOT), not private apps | Yes, but partners only | Redistribution terms not read, UNVERIFIED | MMDA partnered in 2016 (older news); no Bicol partner found |

Notes:
- Waze for Cities is a route for the LGU (Naga City government) to join, not for us. Worth asking the city, but it will not ship in time and gives incident feeds rather than a routing API.
- Mapbox is the only paid-capable option here with a 100k/month free allowance and no explicit ban found on Leaflet, which makes it the best "if we must buy traffic" candidate, subject to a ToS check and a real coverage test in Naga.
- TomTom free allowance is too small for even 1,000 trips/day with one call per trip (30k/month vs 20k free).

## 3. No-cost technique: own-data ETA

### How it works

1. Plan stores the route as an ordered list of segments (stop to stop) with length. The planner already has these.
2. During the trip, take GPS fixes (already needed for live progress). Compute speed from distance over time, smooth with an exponential moving average (for example alpha 0.2-0.3 over about 60 seconds), drop fixes with poor accuracy, and treat a stationary period as dwell, not as the cruising speed.
3. Remaining-time estimate = sum over remaining segments of `length / v_seg`, where `v_seg = w * v_live + (1 - w) * v_profile(segment, weekday, hour)`. Start with a small `w` (for example 0.3) and raise it as the trip accumulates evidence. Add a fixed dwell per upcoming stop.
4. `v_profile` starts as a flat per-route default from the planner's existing assumption and is refined from aggregated, anonymised trip results: after a trip, upload only per-segment elapsed seconds and the time bucket, never coordinates (coordinates are personal data in this project and must never be logged or cached). Medians per bucket are cheap in Neon.
5. Show the ETA as a range ("about 12-16 min") and label it an estimate. Never fabricate fares or routes; if no profile and no GPS, show "unknown".

This is all client-side maths plus one small upload per trip, so server cost is negligible and nothing leaves the user's phone in real time.

### How other apps handle it

I did not find primary-source documentation of Transit's, Moovit's or Citymapper's ETA algorithms, so treat this as unconfirmed:
- Sakay.ph (Manila): crowd-sourced route database; in 2020 it launched GPS tracking for jeepneys and buses and shows live jeepney locations (tracker.sakay.ph) - App Store listing and Sakay blog via search. Its coverage is Metro Manila only.
- A 2025 workshop paper (Lakbayan, WCTP 2025) says Sakay.ph and Moovit lack frequent updates and real-time information for unregulated modes, and notes Moovit shows how many users validated a route by GPS. That supports using rider GPS to validate and tune, not a hosted traffic feed.
- General pattern across informal-transit apps: no official AVL feeds, so use scheduled/historic speeds plus crowdsourced vehicle traces. This is common knowledge, not a quoted source.

## 4. Recommendation and cost

**Ship the on-device blended ETA (section 3) now. Do not integrate Google traffic.** Reasons: Google bills traffic-aware as Pro, forbids showing it on our Leaflet map, restricts caching so we cannot learn from it, and may have no live signal in Naga. If the owner still wants a car-traffic signal later, run a one-week coverage test of Mapbox `driving-traffic` (free 100k/month) and Google `TRAFFIC_AWARE` (use the free 5,000) in Naga, and only proceed if live differs from static at peak.

### Cost table (USD/month, 30 days; calculated from the pricing tables above)

Scenario A: 1 traffic-aware call per trip (ETA at start). Scenario B: 6 calls per trip (refresh about every 3 minutes on a ~20-minute trip). Assumes the tier prices apply to cumulative monthly volume and that traffic-aware uses Google Pro.

| Trips/day | Calls/mo (A / B) | On-device ETA | Google Routes Pro A | Google Routes Pro B | Mapbox Directions A | Mapbox Directions B |
|---|---|---|---|---|---|---|
| 1,000 | 30k / 180k | $0 | $250 | $1,590 | $0 | $160 |
| 3,000 | 90k / 540k | $0 | $850 | $4,390 | $0 | $864 |
| 10,000 | 300k / 1.8M | $0 | $2,550 | $9,550 | $400 | $2,560 |

For reference, Google Routes Essentials (no traffic) in scenario A: $100, $400, $1,250.

Mapbox figures assume the Directions API price tiers read from the pricing page and are only valid if the Naga traffic coverage exists and the ToS permits the Leaflet display (both UNVERIFIED). TomTom is omitted because its post-free pay-as-you-go price was not on the page I read.

### Keep the key server-side

- Any traffic provider call goes through a route handler following the repo's request pattern (`publicPost`, domain Zod parser, `checkRateLimit`, `CACHE.none` for anything with coordinates). Never ship the key to the browser; `pnpm check:bundle-secrets` guards this.
- Do not call the provider from the client "because the key can be referrer-restricted": that exposes the key to scraping and removes the per-user rate limit.
- Set a hard daily quota in the provider console (Google documents quotas you can set to control costs) and a budget alert, so a bug cannot run up a bill.
- Do not log request bodies or coordinates; do not put coordinates in the provider URL if the provider supports POST (Google Routes does).

## Open questions for the owner

1. Is a car-traffic signal required at all, given jeepney dwell dominates travel time? The on-device approach answers "how long until I arrive" without it.
2. Will the owner approve a one-week coverage test of Mapbox and Google traffic in Naga before any spend?
3. Should we ask Naga City hall about Waze for Cities participation (long-term, benefits the LGU)?

## Sources (fetched or surfaced 2026-10-29)

- Google Maps Platform pricing: https://developers.google.com/maps/billing-and-pricing/pricing (page updated 2026-10-28 UTC)
- Routes API usage and billing: https://developers.google.com/maps/documentation/routes/usage-and-billing (2026-10-28 UTC)
- Routes API policies and attributions: https://developers.google.com/maps/documentation/routes/policies (2026-10-28 UTC)
- Directions API policies (legacy status): https://developers.google.com/maps/documentation/directions/policies
- Google Maps Platform Service Specific Terms (body did not load; snippets only): https://cloud.google.com/maps-platform/terms/maps-service-terms
- TomTom pricing: https://docs.tomtom.com/pricing
- TomTom Calculate Route: https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
- Mapbox pricing: https://www.mapbox.com/pricing
- Mapbox terms of service: https://www.mapbox.com/legal/tos
- Mapbox in Leaflet: https://docs.mapbox.com/help/dive-deeper/mapbox-in-leaflet/
- HERE plans (search results only; fetches failed): https://developers.here.com/plans
- openrouteservice plans (search snippet): https://openrouteservice.org/plans/
- GraphHopper pricing and plans (search snippets): https://www.graphhopper.com/pricing/ and https://docs.graphhopper.com/openapi/section/plans-and-rate-limits
- Waze for Cities: https://support.google.com/waze/partners/answer/10618477 and https://www.autodeal.com.ph/articles/car-news-philippines/mmda-announces-data-sharing-partnership-waze
- Sakay.ph: https://apps.apple.com/app/id937998546 and https://blog.sakay.ph/sakays-mobility-as-a-service-solutions/
- Lakbayan paper (WCTP 2025): https://www.atlantis-press.com/proceedings/wctp-25/126023796
