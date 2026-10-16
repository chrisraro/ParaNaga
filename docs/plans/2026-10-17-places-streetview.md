# Increment E2: all-places search and in-app Street View (user request 2026-10-17)

Runs after Increment E Task 4 lands, in its own worktree off feat/anywhere-alight. Same workflow: Jev tiers, ECC reviewers, ponytail, caveman chat.

## User requirements
1. Search must find every registered place on the map: businesses, restaurants, cafes, malls and so on, not only stops or the Explore list.
2. Use OpenStreetMap data and the Google Maps APIs the owner enabled (Places, Street View embed).
3. Street View must preview inside the app (embedded), not only redirect.
4. API usage must be cost-controlled. The owner must not be charged hundreds of dollars.

## Findings (2026-10-17)
- Street View: `src/ui/street-view/stop-street-view.tsx` already embeds via the Maps Embed API when `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` is baked into the build. Vercel has that variable for Production (created about 10h before this plan). A scan of production /app chunks found no key, so the build either predates the variable or the stop-detail chunk was not scanned. Redeploy, then confirm. Also check the CSP `frame-src` allows `https://www.google.com/maps/embed/`. The Maps Embed API is free per Google, so it adds no cost.
- Search: client-side index over the published revision (`src/domain/search`). It only holds OSM places in `OSM_PLACE_CATEGORIES`, mapped pins, routes, terminals and barangays.
- No server-only Google Places key was seen by name. Places must be called from the server so the key never ships to the browser.

## Owner decisions (2026-10-17)
- Google Places is used for text suggestions only. OSM stays the source for locations on our map. Picking a Google suggestion resolves to a pin on our map. The owner accepted the terms risk of using Google Places with a non-Google map. The Sources screen must say Google results are third-party and unverified, and show Google's attribution.
- The owner says the Google keys are already in Vercel. If `GOOGLE_PLACES_API_KEY` is missing, Task 15 ships with Places off and OSM search still works.

## Cost controls (binding for Task 15)
- OSM first, free, on-device. Google is called only when OSM and local results are fewer than 3, after 3 or more typed characters and a 400 ms pause, or when the rider taps "Search more places".
- Session tokens for autocomplete, one Place Details per chosen result, smallest field mask. The implementer reads Google's current pricing page, picks the cheapest SKU path, and records the price per 1,000 calls in the task report.
- Server cache by normalized query and location bias: 24 hours. Cache place_id longer.
- Per-IP rate limit and a global daily cap persisted in Postgres (default 300 Google calls per day, a constant). At the cap the route answers "no more suggestions today" and the UI falls back to OSM. A kill-switch env flag turns Google off.
- Never call Google from tests, CI or dev unless a test key and the flag are set. Tests use a fake server.
- Owner actions outside code (listed in the final report): a Google Cloud budget alert and a per-API daily quota for Places; restrict the browser key to the production referrer and the Maps Embed API only; restrict the server key to Places API (New).

## Tasks
### Task 14: All named OSM places in search (Sonnet)
Extend the OSM places snapshot to every named element tagged shop, amenity, tourism, leisure, office, craft, healthcare or historic (nodes, ways and relations, centroid for areas), pinned as with roads. The importer stores them in the revision. Search loads them as a separate lazy chunk. Categories get human labels (Restaurant, Cafe, Mall, Pharmacy and so on). Budget: under 400 KB gzip, report the real size. Tests for category mapping and ranking (a business name beats a street substring).

### Task 15: Google Places proxy with cost guard (Opus, Jev 0.97)
`/api/v1/places/suggest` and `/api/v1/places/resolve`, server only, key from `GOOGLE_PLACES_API_KEY`, never sent to the client or logged. Implements every cost control above, Zod schemas, strict input limits, bias fixed to Naga, no user text stored, cache and cap in Postgres (additive migration 0011, RLS forced). The search screen shows Google rows below OSM rows, labelled "Google suggestion", unverified. ecc:security-reviewer and ecc:database-reviewer review.

### Task 16: In-app Street View (Sonnet)
Confirm the embed key reaches the production build, fix CSP `frame-src` if needed, and make Street View a panel inside stop detail and place detail at mobile width. Loads only on tap (keep), with a fallback link when blocked or offline. E2E with a fake embed URL plus axe. Sources and Help: Google attribution and the cost-safe note.

### Task 17: Verification and rollout
Folded into Increment E Task 13. Production check: search a mall, a restaurant, a cafe and a pharmacy; Street View opens inside a stop page; Google call count is below the cap.
