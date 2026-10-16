# Photo assets and source-rights handoff

Updated 16 October 2026. Owner: Codex. Branch: `codex/place-media`, based on `feat/modes-lines-eta` at `39886fe`. Isolated managed worktree; no changes to the peers' map-rendering, import, ETA or database tasks.

## Implemented

- Inventoried all **233 Explore OSM places and 128 source stop pins**. `data/media-inventory.json` records candidates, selected asset, evidence status and manual reference links. `data/stop-photo-coverage.csv` and `stop-coverage.html` cover every original stop, including duplicate landmarks and unlabelled pins.
- **17 licensed photographs**, linked to **16 Explore places and 20 nearby stop landmarks**. The seventeenth photo is a separate streetscape in the credits register. Capture dates are preserved; the collection includes older images and is not described as current field verification.
- **217 Explore places and 108 stop records have no selected photograph. Zero stop-sign photographs are field verified.** This task is not represented as complete coverage. No missing photo is replaced with a generic or invented scene. Some individual Commons queries were rate-limited; missing candidate rows do not prove that no photo exists online.
- Jev `typesafe/jev-1.14-20261014` ranked metadata in bounded batches. Raw decisions are in `data/media-jev-*.json`. Six candidates with `review`/`abstain` were explicitly approved by the user on 16 October; approval evidence is recorded in `data/media-human-approvals.json`. Their original Jev decisions are retained. Bicol Medical Center is excluded pending creator-attribution resolution.
- Photos load from the same origin, with creator, original source link, license link, capture date and modification notice. Explore cards link to the existing Sources screen; place and stop details show captions. A stop landmark image does not assert installed signage, a legal boarding curb or permission to board.
- Sources screen includes all **86 data/research records**, revision-cited sources, OSM licenses and extracts, font license and software notices. Bundled credits remain accessible when the revision Sources API fails. This does not expand the existing service worker's navigation-offline coverage.
- Provider attribution cannot silently omit MapTiler/OSM credits; unknown production providers without configured credits render no basemap.
- Photographs and large legal/data downloads are excluded from automatic precaching. The final measured install manifest is **1,576.38 KiB**, instead of automatically fetching the additional 5+ MiB.

## Validation

`pnpm verify` passed: type generation/typecheck, full ESLint, layer boundaries, **99 unit files / 1,299 tests**, production build and client-bundle secret scan. Affected unit suite also passed independently (62 tests). Initial affected mobile browser run: 26 passed, one credit-link accessibility failure; explicit link underlines fixed it. The three media browser tests then passed, including image load, broken-image fallback, Sources API failure and stop-detail axe checks. Final browser rerun is recorded below.

Final affected browser suite: **27/27 passed** across Explore, place details, Help/Sources and media, including light/dark accessibility checks. Uses the existing recorded network fixtures against the production build; it does not verify live transport data or contact a database. No integration database run was needed because no schema/import/query behavior changed.

`node scripts/check-source-rights.mjs` checks asset hashes, attribution completeness, unresolved Jev decisions, shipped uncredited photos and coverage of the existing data-source catalogs. Dedicated CI workflow runs this check on PRs and master.

`node scripts/check-source-rights.mjs --release` is deliberately failing while rights remain unresolved. Manual dispatch of the Source rights workflow runs this stricter gate. **This is not a configured Vercel promotion blocker or branch-protection rule**; the integration owner must enforce it before release.

## Unresolved release rights

- **S39/S40:** the user confirmed the map was shared publicly by Tan Gumba and approved the attribution “Naga City Designated Stops — shared publicly by Tan Gumba”, linked to the original. Status is **reuse basis unconfirmed**, not a finding that permission is necessarily required or that use is prohibited. Assess any existing license, the factual-data basis and coordinate provenance; permission is one possible basis, not the only one. Do not copy Google basemap/Street View imagery into the app.
- **S33/S34:** the Loop A labels were transcribed from an LGU-branded graphic hosted by SafeTravelPH. Hosting and branding do not establish the rights to the graphic or extraction. Resolve the creator/owner permission or replace with an independently sourced official register. The graphic itself is not shipped as a photo.
- **Installed software:** `@triplit/react@1.0.51`, `@triplit/db@1.1.10`, and `@triplit/logger@0.0.3` lack license metadata/text in their installed artifacts. They enter through Neon's optional auth UI dependency tree. **No Triplit matches were found in the checked production JS or `.nft.json` traces**, and the app imports the Neon server entry point, not that UI. The upstream repository has an AGPL license, which is not sufficient evidence of the exact package-version terms. Confirm before distributing/using these modules; no claim of a deployed violation is made.
- Provider account-plan compliance, third-party architectural/artwork rights and any additional permissions remain matters for the relevant owner to verify. Citation and an uploader's license are not a blanket legal warranty.

## Integration

Street View follow-up: the 128-stop gallery, CSV and inventory now include coordinate-specific Google Maps Street View links. No screenshots or Google imagery were downloaded. Coverage, panorama location, capture date and signage visibility remain unchecked. Google's Geo Guidelines explicitly prohibit screenshotting Street View and downloading its imagery for separate use; supported links/embeds/API displays are the alternative. No Street View API configuration was found in this worktree. References: https://about.google/brand-resource-center/products-and-services/geo-guidelines/#street-view and https://developers.google.com/maps/documentation/streetview/policies .

Claude Code owns the integration branch; Antigravity owns Tasks 10–12. Their active worktrees are unchanged. Updates were appended to the integration worktree's `.superpowers/sdd/HARNESS-SYNC.md` and `progress.md`. This branch adds one small service-worker manifest exclusion in `src/app/serwist/[path]/route.ts`; preserve it when doing Task 15. No intermediate production deployment or merge was performed.

Review `contact-sheet.jpg`, the mobile screenshots, and `stop-coverage.html`. `review.html` is the historical candidate review; six named-creator selections are now approved and in the app. Bicol Medical Center remains staged.

## Embedded Street View (2026-10-16)

Implemented an on-demand Street View section on every stop detail with valid coordinates. It sends the recorded stop coordinate to Google's supported Maps Embed API only after the user opens it. Google retains its own attribution in the viewer; the Sources screen links Google's terms and privacy policy. No panorama imagery is downloaded, captured, bundled or cached by ParaNaga. A keyless external Google Maps link remains available. Offline opening is prevented; coverage and cross-origin viewer errors cannot be reliably detected, so the fallback link is always shown. This is surroundings reference, not verified stop signage or boarding position.

Configure `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` in Vercel Production and Preview, then redeploy: Next.js embeds this public browser value at build time. Restrict the key to Maps Embed API and allow only the intended website referrers (production domain, authorized preview hosts and localhost for development). Never use a server credential here. The local key was tested successfully in Google's actual viewer; production-domain authorization still requires a deployed check. Automated browser tests intercept the Google embed and use no Google imagery. Playwright's standard builds use a harmless test key.

This feature does not resolve the existing data-source release-rights items above, nor add verified signage photos. Prior 128-stop external links remain useful for coverage review.

Validation for embedded viewer: typecheck, full ESLint, layer boundaries, production build and client-bundle secret scan passed. All 100 unit files / 1,303 tests passed on rerun. One preceding run exposed an unrelated randomized walking-route floating-point assertion (seed 1201097308, 156.22052959123596 versus 156.2205295912359); no routing code was changed. All 10 affected mobile browser tests passed, including the intercepted embed, stop media, Sources attribution and light/dark accessibility. Updated the existing Sources test to the user's approved Tan Gumba credit. Refreshed the Sources screenshot through the existing test; no Google panorama was captured. Precache is 1,579.84 KiB; Google frames are not precached. Source-credit integrity passes; the existing seven release-rights items remain unresolved.
