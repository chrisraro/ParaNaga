# Map-first home (no default sheet): design and plan

Status (2026-10-22): finished (design approved and built; see the handoff note).

Date: 2026-10-18 · Branch: `feat/home-map-first` (from `origin/master` 31dcb3b) · Status: design, awaiting owner review
Mock: `docs/design/home-map-first-mock.html` (a design mock, not the product). Working notes: `.superpowers/sdd/home-notes.md`.

Owner request (binding, verbatim): "The modal sheet design bothers me, it seems like it was not an effected user experience, lets redesign it, remove that modal sheet on homepage default, maybe we get the actual native user experience of Google Maps navigation, study it and use again /impeccable /gpt-taste /ecc:motion-advanced how can we implement it effectively."

Skills applied: impeccable `shape` (Operate mode, mobile PWA; layout, adapt, animate, craft-floor read before the mock), gpt-taste (anti-slop rules only), ecc:motion-advanced (its `motion` patterns translated to pointer events, WAAPI, CSS and View Transitions; **no motion library is added**).

Context substitution: `impeccable context` ran and asked for PRODUCT.md through `init`. This task may write only three files, so PRODUCT.md was not created. Product truth comes from `docs/spec/01-product.md`, the code, and the standing owner decisions (honest estimates, no live positions, no e-jeep, Leaflet, Neon). Follow-up: run `/impeccable init` and `document` once this lands.

---

## 1. Study: Google Maps mobile, what to borrow

Verification key: **V** means seen in a fetched page or search result. **G** means general knowledge of the shipping app; no official text was fetched (the m3.material.io pages render client-side and returned only their titles).

| Pattern | What Google does | Borrow | Do not borrow | Source |
|---|---|---|---|---|
| Home / Explore | Full-bleed map, a floating search pill, a horizontal chip row, layers and my-location controls, bottom nav. In 2024 the nav went from 5 tabs to 3 (Explore, You, Contribute), and Updates moved to a bell. | A full-bleed map with nothing covering it by default. The floating pill. A chip row. Right-side controls. Keep our existing 4-tab pill. | The peeking "Latest in the area" sheet (that is exactly what the owner wants gone). Google colours and iconography. Any "live" or "latest" framing. | V: [9to5google 2024 bottom bar](https://9to5google.com/2024/07/31/google-maps-bottom-bar-redesign-rolling-out/), [Android Central](https://androidcentral.com/apps-software/google-maps-simplified-bottom-nav-bar). G: the rest. |
| Search focus | The bar expands into a full-screen search view. History shows on open, suggestions as you type, results on submit. There is a back arrow. | The pill morphs into our existing full-screen `/app/search`. Recents (on this phone), saved places, Choose on map, then results as you type. | Server autocomplete that blocks typing. Our index is local and works offline. | V: [Material Components Search docs](https://github.com/material-components/material-components-android/blob/master/docs/components/Search.md) (SearchView expands from SearchBar; history, then suggestions, then results; predictive back) |
| Directions | A top card with origin and destination, swap, and mode tabs. Route options sit in a standard bottom sheet with detents. The map fits the route above the sheet. Each route has Start, Steps and Preview. | The top From/To card with swap. A **standard (non-modal) sheet** with peek, half and full detents, used **only here**. The map fits the route between the card and the sheet. "Steps" and "Start trip" on the best option. | Mode tabs: our planner returns one honest ranked list across jeep, tricycle and walk, and a filter would hide the comparison. Clock departure and arrival times. Exact fares. | V: [Material Components BottomSheet docs](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md) (standard sheets have no scrim; collapsed, half-expanded and expanded states; the drag handle lets TalkBack and Switch Access expand and collapse the sheet, and tapping it cycles states), [Get directions](https://support.google.com/maps/answer/3093448) |
| Navigation | A top instruction banner with a "then" step. A bottom bar with ETA, time and distance, and an X to exit. Recenter appears after a pan. Sound control. Transit got a Start mode in 2017. | The top banner with a "then" line. A bottom strip with End (X), the step count, the estimate and Steps. Recenter after a pan. Our tap-to-confirm step button ("I'm at the stop"). | Any arrival clock or live ETA, auto-advance from an ETA, and the green banner. Sound and mute: guidance has no audio today. Haptics: not guaranteed on the web. | V: [Navigation sound settings](https://support.google.com/maps/answer/3273406?hl=en), [Ars Technica 2017 transit navigation, via a feed](https://tagteam.harvard.edu/hub_feeds/3382/feed_items/2337548). G: banner and strip layout. |
| Transitions and gestures | The search bar morphs into the view. The sheet snaps to detents with fling, the map stays live above it, and list scrolling hands off to the sheet at the top. The camera re-fits after the sheet settles. Back steps out one state at a time. | A shared-element morph (View Transitions, which React 19 `<ViewTransition>` already uses in `app-frame.tsx`). Pointer-event drag with rubber-banding and a velocity projection. WAAPI settle. Re-fit after settle only. Back and Escape step out through guidance, detail, directions, then home. | Hijacking browser edge-swipe or pull-to-refresh. Animating the camera during a drag (it causes layout thrash). | V: [Chrome: same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document) (unique `view-transition-name`; reduced motion may keep a subtler animation). G: sheet hand-off. |

The research subagent could not fetch official text on transit "get off" alerts or Google's own TalkBack behaviour. Nothing in this design depends on either.

## 2. Audit of the current home

Evidence: the code in this worktree, plus the live site at 375x812 in dark mode (https://para-naga.vercel.app/app, captured 2026-10-17).

**What is wrong with the default sheet**

1. **It covers the map on arrival.** `useSheet(1, …)` (`home-screen.tsx:237`) opens at half (444 px visible, `HALF_VISIBLE`). On a 812 px phone that is more than half the screen, before the rider has done anything. The live capture shows the map cut off just below Naga centre.
2. **It opens in a form, not a map.** The Start row is focused by default, so "Set start / Use current location / Choose on map" are listed under the rows. That reads as a modal task, not a place to look around.
3. **Search is entered three ways.** Destination row → options → "Search places and stops" (`endpoint-sheet.tsx:457`). The Explore tab search button. The rows themselves. There is no single, obvious "Where to?".
4. **It competes with the map for gestures and space.** It has three detents, a grabber, rows, options, nearby stops and trip results in one surface. The tab bar overlaps "Nearby stops" at half, and the update prompt overlaps the options (live capture). The Leaflet attribution floats mid-screen (`mapInsetFor`).
5. **The tiny-screen rules are complex.** Grabber-only peek, the tab bar stepping aside, and `.pn-sheet__rest` inert at peek with focus-lift heuristics (`endpoint-sheet.tsx:416-434`). Most of this exists only because the sheet is always there.
6. **Every drag frame re-renders.** `setDrag` is React state, so each `pointermove` re-renders the whole `HomeScreen` (about 1,050 lines, the map props included). Transform-only CSS, but not render-free.
7. **The map is inert at full**, by design, but that is the default state's ceiling: the user can reach a state with no map at all from the home tab.

**What must be preserved**

- **Honest copy**, unchanged: "Est." (screen readers hear "Estimate"), "+ waiting (unknown)", "Unverified route", "Time not available" / "Time not estimated", the tricycle "₱15 minimum", "How times are estimated", the offline and changed-since-saved notes, and no ETA, "arriving" or live language anywhere.
- **Product facts:** no e-jeep; modern jeeps on R4 and R7 only; traditional jeeps on all routes.
- **Map:** the legend, the overview lines, terminals, stop pins, the trip lines (walks dotted, rides solid), `route-fit.ts`, and the crosshair pick mode with its "Pin must be in Naga City" and same-place guards.
- **Accessibility:** WCAG 2.2 AA. 44 px targets (2.5.8). Single-pointer alternatives to dragging (2.5.7): zoom buttons, a tap or arrow keys on the handle. Focus return when a panel closes. The `home-announcer` live region. The guidance focus rules and its assertive "Para!" alert. Forced colours, high contrast (`data-contrast="more"`), reduced motion.
- **PWA:** the offline banner, the update prompt, offline plans, and the static shells.
- **Tests:** about 300 tests across 23 Playwright spec files on 3 projects (mobile Pixel 7, desktop, no-tiles); CI gates every merge. The full map of the dependencies is in §5 (spec mapping).

## 3. Design

### 3.1 States and transitions

```
HOME ──tap pill / chip──▶ SEARCH ──pick place──▶ DIRECTIONS ──tap option / Steps──▶ TRIP DETAIL ──Start trip──▶ GUIDANCE
  ▲          ◀──Back/Esc──┘   │                     │  ◀──Back/Esc──────────────┘  ◀──End (confirm)──────┘
  └──────────Back/Esc / ✕ Clear trip────────────────┘
  HOME ──"Choose on map" (from SEARCH or a From/To row)──▶ PICK (existing crosshair panel) ──▶ DIRECTIONS
```

| State | On screen | Sheet | Tab bar |
|---|---|---|---|
| **HOME** | A full-bleed map. The search pill "Where to?" (top, safe area + 8 px, height 52). A chip row (saved places first, then place categories). The layers FAB at top right under the chips. The zoom capsule and locate button at bottom right. Legend and the accuracy chip at bottom left. | **None** | Shown |
| **SEARCH** | The existing `/app/search` panel. The field is the shared element. Options: Choose on map (plus Use current location when choosing the start), Saved, Recent (new, on this phone only), **Stops near the map** (`NearbyStops`, moved here as the list alternative to the pins), then the regional switch. | None | Hidden (as today) |
| **DIRECTIONS** | The top From/To card (Back, Start row, Destination row, Swap). The map fits the route between the card and the sheet. Locate rides above the sheet. | **Results sheet**, non-modal, peek (best option and its actions) by default. Half and full on demand. | Hidden |
| **TRIP DETAIL** | The From/To card collapses to a one-line bar ("Jeep R8-C to Ateneo de Naga University" with Back). The route and its stops are highlighted. | The same sheet at half. The footer (Save, Share, Start trip) is pinned to the visible edge. | Hidden |
| **GUIDANCE** | A top instruction banner (icon, step title, distance or stops, and a "Then ride R8-C toward Ateneo" line). Re-center appears after a pan. A bottom strip: End ✕, "Step 1 of 3 · Walk", the estimate, Steps, and one large confirm button ("I'm at the stop"). | Steps open the same sheet over the strip, non-modal. | Hidden |

Transitions (tokens from `globals.css`: `--pn-dur-fast` 120, `--pn-dur` 220, `--pn-dur-slow` 360, `--pn-ease`, `--pn-ease-snap`, `--pn-ease-exit`):

- **HOME → SEARCH (the focal moment):** React `<ViewTransition name="pn-search-field">` wraps the pill (in `HomeScreen`) and the search field (in `SearchScreen`). The route change `/app` → `/app/search` already runs inside a transition (`app-frame.tsx`), so the pill's box morphs into the field in 360 ms with `--pn-ease-snap`. The chips and FABs leave in 120 ms with `--pn-ease-exit`. The list rises 8 px and fades in over 220 ms. Back reverses it. The panel crossfade `pn-panel` stays for every other route.
- **SEARCH → DIRECTIONS:** the panel exits as it does today. The From/To card fades and drops into place (220 ms). The sheet enters from below to peek: WAAPI, `translateY(100%) → peek`, 360 ms snap ease. At the same time the camera `fitBounds` runs with `ROUTE_FIT_DURATION_S = 0.36`, so both settle together.
- **Detents:** see §3.3.
- **DIRECTIONS → TRIP DETAIL:** the sheet content crossfades (existing `usePresence` and `pn-exit`). The sheet animates to half if needed. The card collapses to the one-line bar with a `<ViewTransition>` named `pn-trip-ends`, a box morph.
- **→ GUIDANCE:** the banner drops 12 px and fades in (220 ms). The strip rises from the bottom (360 ms). The sheet hides.
- **Reduced motion:** the view-transition groups get `animation: none` (an instant swap with an opacity crossfade of at most 120 ms). Sheet settles are instant, and drags still track the finger. The camera re-fits without animating (`animate: false`). State changes stay visible and announced.

### 3.2 Layout grid, safe areas, short screens

- **Gutters:** 12 px for floating chrome, 16 px for the tab bar (incumbent), 20 px inside lists. Floating controls are 48 px (visual), and every hit area is at least 44 px; chips are 36 px visual with a 44 px hit area through `::before`.
- **Top stack:** `--naga-map-controls-top` (safe-area top + offline inset + 16, existing) holds the pill, then the chips at pill + 60. The layers FAB sits under the chips.
- **Bottom stack (HOME):** tab bar clearance (`tabBarClearance`, measured) + 16 px, then Legend, the locate button and the zoom capsule.
- **Bottom stack (DIRECTIONS):** locate sits at sheet-visible height + 12 and moves with the sheet. Its transform is written in the same rAF as the sheet's, and it hides at full.
- **Map padding:** `routeFitPadding` gains a `topInset` parameter (the From/To card's bottom edge + 16). Bottom stays the visible sheet height + `ROUTE_FIT_SHEET_GAP`. `ROUTE_FIT_MIN_VISIBLE` (120 px) still guarantees a usable strip.
- **Short or landscape (height < 480 px, or 400 % zoom):** the chips fold into one "Browse" chip at the end of the pill. Peek and half are capped by `MAP_MIN_SHARE` (0.25 of the height stays map, as today). The From/To card shows a single line ("Plaza Rizal → Ateneo…", tap to expand). Below about 300 px of height (`TINY_SHEET`) the sheet keeps today's grabber-only peek. Most of the old tiny-screen code goes away, because HOME has no sheet.
- **Wide screens:** the phone gate stays. At 768 px or more the results sheet docks as a 400 px left panel (Material's docked variant). That is out of scope here and goes to the backlog.

### 3.3 The results sheet: physics in plain JS

New `src/ui/app-shell/bottom-sheet.tsx` (generalised from `endpoint-sheet.tsx`; keeps `offsetFor`, `Snap`, the labels and the keyboard model):

- **Drag surface:** the grabber **and the sheet header** (title row), with `touch-action: none`. The list body keeps native scrolling (`touch-action: pan-y; overscroll-behavior: contain`).
- **Drag path:** `pointerdown` → `setPointerCapture`. Moves past a 6 px slop write `transform: translateY()` **directly to the element in a rAF** (a ref; no React state per frame). `will-change: transform` only while dragging.
- **Velocity:** an exponential moving average (0.8 new / 0.2 old) of px/ms over the last moves.
- **Rubber band** past the top (full) or the bottom (peek): `rb(x) = (1 − 1 / (x·0.55 / D + 1)) · D`, with D = 120 px.
- **Release:** project `y + v·200 ms`, then pick the nearest detent (the same `FLING_MS` as today). Settle with `element.animate([{transform: from}, {transform: to}], {duration: clamp(180, 360, |Δ|·0.9 − |v|·40), easing: var(--pn-ease-snap)})`, then commit the style. A new drag cancels and reads the current matrix (interruptible). React state (`snap`) is set once, on release.
- **Scroll hand-off:** at full, with the list at `scrollTop === 0`, a downward move past the slop on a touch pointer captures the pointer to the sheet and continues as a sheet drag. Otherwise the list scrolls.
- **Non-drag alternatives (2.5.7):** tapping the grabber cycles the detents; ArrowUp and ArrowDown step them. The grabber's `aria-label` reads "Expand sheet to half", "Expand sheet to full" or "Collapse sheet" (kept).
- **The map during a drag:** untouched. On settle, `refitSignal` fires (existing) and the camera fits with the new bottom padding. Locate follows the sheet's transform in the same frame.
- **Detents:** peek = header + best option + its actions (`PEEK_OPTIONS_VISIBLE` recomputed; about 286 px in the mock); half = `HALF_VISIBLE` 444, capped by `MAP_CONTROLS_CLEAR` / `MAP_MIN_SHARE`; full = the card's bottom + 8.

### 3.4 Focus order, ARIA, keyboard

- **HOME DOM order:** `main` → sr-only `h1` "ParaNaga trip planner" (`data-home-heading`, kept) → the pill (a `Link` to `/app/search?for=destination`, accessible name "Search. Where to?") → `ul[aria-label="Browse places"]` of chip links → map region → map controls → Legend → `nav[aria-label="Main"]`.
- **SEARCH:** focus goes to the field on open (existing). Escape and Back close it and return focus to the pill. AppFrame's `returnFocus` already captures the opener.
- **DIRECTIONS:** `section[aria-label="Trip ends"]` (the card), then `section[aria-label="Trip options"]` (the sheet; a region, **not** a dialog, no `aria-modal`). At full the map wrapper is `inert` (kept); the card stays operable. A pick from search moves focus to the options heading. `home-announcer` speaks `planAnnouncement` (kept).
- **Escape / Back:** guidance → (End confirm dialog) → detail → directions → home. Each step returns focus to the control that opened it. The browser Back button is mirrored with one `history.pushState` sentinel entry per state above HOME, holding state data only, **never coordinates in the URL** (privacy rule). See R2.
- **Live regions:** unchanged (the polite home announcer, the guidance polite region, the assertive "Para!"). The banner is not a live region; the guidance announcer already speaks the steps.
- **Forced colours:** floating surfaces get a 1 px `CanvasText` border. The best option and the focus ring use `Highlight`. The grabber gets `forced-color-adjust: none` with `CanvasText`.

### 3.5 Copy (concise, honest)

The pill says "Where to?". The search field placeholder says "Where to?" (destination) or "Choose start" (start). The sheet title is "3 ways to go" or "1 way to go", with the subline "Estimates only. Waiting time is not included." The option, detail and guidance strings are the existing view-model strings, unchanged. No new claims are introduced.

### 3.6 Component inventory

| Piece | File | Action |
|---|---|---|
| Sheet engine (drag, physics, detents, keyboard) | `src/ui/app-shell/bottom-sheet.tsx` (new) ← `home/endpoint-sheet.tsx` | **New**, extracted. `offsetFor` and `Snap` move with it. |
| Footer slot | `app-shell/sheet-bar.tsx` | **Reuse** unchanged |
| Endpoint rows and Swap | `home/endpoint-sheet.tsx` → `home/trip-ends-card.tsx` | **Reuse** the rows inside the new top card. The options group (Set start…) is **deleted**; its actions live in SEARCH. |
| Search pill and chips | `home/home-search-bar.tsx` (new) | **New**. Chips come from `EXPLORE_CATEGORIES` and saved places. |
| Search screen | `search/search-screen.tsx` | **Reuse**, plus the shared-element wrapper, a Recent section and Stops near the map |
| Recents store | `client/storage/db.ts` (+ `domain/search/recents.ts`) | **New**, small: the last 8 picks, on the device only, cleared with the existing data controls |
| Nearby stops | `home/nearby-stops.tsx` | **Reuse**, moved into SEARCH. Home publishes `stopsInView` through AppFrame context. |
| Trip options, OptionsPeek, detail | `trip/trip-options.tsx`, `trip-detail.tsx` | **Reuse**. OptionsPeek becomes the sheet header (best option, Steps, Start trip). |
| Guidance | `guidance/*.tsx`, `domain/guidance/view.ts` | **Reuse** the view models. New layout: `guidance-banner.tsx` and `guidance-strip.tsx`. |
| Map controls | `map/map-controls.tsx`, `naga-map.css` | **Reuse**, re-positioned with CSS variables per state |
| Route fit | `map/route-fit.ts` | **Extend** `routeFitPadding(hiddenBottom, mapHeight, topInset = ROUTE_FIT_PAD_TOP)` |
| Home mode | `home/home-mode.ts` (new, pure) | **New**: `homeMode({endpoints, plan, openedId, guiding, picking}) → "explore" \| "directions" \| "detail" \| "guidance" \| "picking"` |
| Tab bar | `app-shell/tab-bar.tsx` | **Reuse**. Hidden outside `explore` with `useHideTabBar`. |

### 3.7 Performance

- **During a drag:** transform only, written through a ref in rAF. No React renders, no camera work, no layout reads apart from the pointer events.
- **Settle:** WAAPI on the compositor. `will-change` is applied only while dragging or settling.
- **View transitions:** only the named pill/field and the panel layer; no full-page snapshots beyond what `pn-panel` does today.
- **Chips:** a horizontal list with `scroll-snap-type: x proximity`. No JS.
- **Budget:** under 4 ms main-thread time per drag frame, measured with the trace from `ecc:chrome-devtools` on a throttled 4x CPU Pixel 7 emulation.

## 4. Decisions

Jev certainty is recorded as ADR evidence; the act threshold is 0.8.

| Fork | Decision | Certainty |
|---|---|---|
| Directions results: a non-modal sheet with detents, or inline route cards | **Non-modal sheet, directions/detail/guidance only.** It reuses the tested drag code and matches native expectations; cards cannot hold the detail timeline. | Jev 0.82 → act |
| Pill → search shared element: React `<ViewTransition>` or hand-rolled FLIP | **React `<ViewTransition>`**. Already in use in `app-frame.tsx`, and it degrades to an instant swap where unsupported. | Jev 0.98 → act |
| Rollout: a feature flag or staged in-place replacement | **Staged replacement**. Every task lands with its spec updates, so main always has one UI. No flag: a flag would double the UI and defer all test churn to the end. | Jev 0.96 → act |
| Chip contents | Place categories, with transit layers left in the Layers FAB. **Not settled → owner question Q1.** | Jev 0.66 (places) → review |
| Haiku tier for the fixture migration | Not eligible. Every task runs on Sonnet. | Jev 0.38 → abstain |

These follow from the owner's rules and the audit without a fork: mode tabs are not borrowed (§1). Tab bar hiding outside HOME follows Google's directions behaviour and the existing guidance rule, and is listed as Q3 only because it changes navigation reach.

## 5. Implementation path

Each task is one PR with its own spec updates and keeps CI green (the e2e gate). Run only the affected specs during fix rounds, and the full mobile suite at the end of each task.

| ID | Tier | Task | Depends on | Main files |
|---|---|---|---|---|
| **T1** | sonnet | Extract the sheet engine into `bottom-sheet.tsx`: ref-written transforms (no per-frame React state), rubber-banding, WAAPI settle, header as drag surface, scroll hand-off. **No visual change.** Port `sheet-peek` and `tab-bar-clearance` unit tests; add physics unit tests (`rb`, projection, duration clamp). | – | `app-shell/bottom-sheet.tsx`, `home/endpoint-sheet.tsx`, `tests/unit/sheet-*.test.ts` |
| **T2** | sonnet | `home-mode.ts` (pure) with unit tests; wire it into `home-screen.tsx`. Hide the tab bar outside `explore`. The results list now opens at **peek**, not half. Back-stack sentinel (`pushState` without coordinates) with a spike first; fall back to on-screen Back and Escape if Next's router conflicts (R2). | T1 | `home/home-mode.ts`, `home-screen.tsx`, `app-frame-context.ts` |
| **T3** | sonnet | **HOME with no sheet.** Search pill and chips (`home-search-bar.tsx`). FAB re-stack. Legend and accuracy chip moved. Update prompt above the tab bar. `EndpointSheet` renders only when mode ≠ explore. New e2e fixtures `openSearch(page, which)` and `chooseOnMapVia(page, which)`. Update the class B specs that used the home rows and options (map, search, audit-fixes, places, terminals, stops, settings, saved, offline). Re-spec `shell:162-188`. | T2 | `home/home-search-bar.tsx`, `home-screen.tsx/.css`, `naga-map.css`, `tests/e2e/fixtures/*`, listed specs |
| **T4** | sonnet | **SEARCH.** `<ViewTransition name="pn-search-field">` on the pill and the field. Recent section (device-only store, last 8). "Stops near the map" (`NearbyStops` via context). Start-mode "Use current location". Reduced-motion CSS. Re-spec `offline:322` (Nearby stops now in search). | T3 | `search/search-screen.tsx/.css`, `client/storage/db.ts`, `domain/search/recents.ts`, `home/nearby-stops.tsx`, `globals.css` |
| **T5** | sonnet | **DIRECTIONS.** `trip-ends-card.tsx` (rows and Swap keep `endpoint-start`, `endpoint-destination` and their ids). Results sheet (`trip-sheet` and `data-snap` kept, `aria-label="Trip options"`). OptionsPeek as the sheet header with Steps and Start trip. Locate follows the sheet. `routeFitPadding` `topInset`. Sheet enter animation. Re-spec `trip:509/557/574` and `map:469` on the new detents. Re-point `options.ts` fixtures. | T1, T2, T3 | `home/trip-ends-card.tsx`, `trip/trip-options.tsx`, `map/route-fit.ts`, `home-screen.tsx`, `tests/e2e/trip.spec.ts`, `map.spec.ts`, `fixtures/options.ts`, `tests/unit/route-fit*.test.ts` |
| **T6** | sonnet | **TRIP DETAIL and GUIDANCE.** One-line compact bar (`<ViewTransition name="pn-trip-ends">`). Guidance banner and strip from the existing view model. Re-center after a user pan. Steps open the sheet. Re-spec `guidance:553` and `map-lines:456/587/615/633/656/677` (refit and footer on the new structure). | T5 | `guidance/guidance-banner.tsx`, `guidance-strip.tsx`, `guidance.css`, `trip/trip-detail.tsx`, `tests/e2e/guidance.spec.ts`, `map-lines.spec.ts` |
| **T7** | sonnet | **Hardening.** Short screens and landscape (the folded chips, the one-line card). Rewrite `reflow.spec.ts` for the new structure. Axe includes moved from `trip-sheet` to the new regions where the meaning changed. Forced colours, high contrast, reduced-motion checks. Delete dead tiny-sheet code. Full mobile, desktop and no-tiles suites. | T3–T6 | `home-screen.css`, `tests/e2e/reflow.spec.ts`, axe call sites |
| **T8** | opus | Final design, a11y and performance review against the mock: `impeccable detect` on the changed UI; a live check at 375x812 and landscape 812x375, in both themes; a drag trace under 4 ms per frame; an honesty-copy sweep (grep for ETA, arriving, live, e-jeep). Findings follow the ship-fast rule: Critical and Important get a fix round, Minor goes to the backlog. | T7 | – |

**Test strategy**

- **Unit (Vitest):** physics (`rb`, the projection, the duration clamp, nearest detent), `home-mode` transitions, `routeFitPadding(topInset)`, the recents store (cap, dedupe, clear), `offsetFor` (moved).
- **E2E (Playwright mobile):** each state's entry and exit and focus return. Drag with `page.mouse` on the header and with `touchscreen`. Tap-cycle and arrow keys. Map inert at full. The camera re-fits after settle (`fitId`). Back and Escape stepping. Reduced motion (`emulateMedia`). Axe on HOME, SEARCH, DIRECTIONS (peek and full), DETAIL and GUIDANCE.
- **Test ids:** kept where the meaning is unchanged: `home-screen`, `app-home-layer`, `trip-sheet` (now the results sheet, `data-snap` 0, 1, 2), `endpoint-start`, `endpoint-destination`, `options-toggle`, `trip-detail*`, `accuracy-pill`, `pick-*`, `home-announcer`, `tab-*`, `search-*`. New ids: `home-search` (the pill), `home-chip-{id}`, `trip-ends`, `guidance-banner`, `guidance-strip`, `search-recent`, `search-nearby`. Removed: `endpoint-search` (the options link). Its 11 uses in `search.spec` switch to `openSearch()`.

**Spec mapping** (from the dependency sweep; A = unaffected, B = selector or fixture change, C = behaviour re-spec)

| Spec | Tests | Class and owning task |
|---|---|---|
| map | 17 | B (T3, T5); C `:469` (T5) |
| trip | 21 | B through `chooseOption` (T5); C `:509, :557, :574` (T5); axe include stays `trip-sheet` |
| guidance | 12 | B (T6); C `:553` (T6) |
| map-lines | 21 | C `:456, :587, :615, :633, :656, :677` (T6); the rest B |
| reflow | 4 | C, rewritten (T7) |
| shell | 11 | C `:162-188` (T3); the rest A |
| offline | 21 | B (T3); C `:322` (T4) |
| search | 16 | B: "Search places and stops" → `openSearch()` (T3) |
| copy-sources, audit-fixes, anywhere-alight, saved | 10/24/11/8 | B (T3, T5) |
| places, terminals, stops, settings, transitions, places-google | 10/6/15/13/5/3 | A/B (T3) |
| explore, help, media, routes, smoke, street-view | 9/7/4/7/4/3 | A |
| Unit: `sheet-peek`, `tab-bar-clearance` (`offsetFor`), `options-peek`, `theme-css` | 10/4/6/– | Move or adjust (T1, T5); `theme-css` follows the CSS file moves (T3) |

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The e2e churn in T3 is large: most specs set up trips through the home rows. | Shared fixtures first (`openSearch`, `chooseOnMapVia`, `chooseOption`). Re-point setup paths, not assertions. Run the affected specs per round and the full suite at the end. |
| R2 | `history.pushState` can conflict with the Next 16 App Router's own history state. | A spike in T2: read `node_modules/next/dist/docs` on `window.history` integration. If unsafe, ship Escape and on-screen Back only; Android Back then leaves `/app` as it does today. That is no regression. |
| R3 | View Transitions are unsupported in older Safari. | React `<ViewTransition>` degrades to an instant swap. No functional dependency on it. |
| R4 | The scroll hand-off fights native scrolling on iOS. | Touch pointers only. A slop threshold, and only at `scrollTop === 0`. If flaky on real devices, drop the hand-off: the header is still a drag surface. Test on Chromium and WebKit (Playwright `webkit` once). |
| R5 | Losing the always-visible Nearby stops hurts screen-reader users. | The list moves to SEARCH ("Stops near the map"), one tap from the pill, and to stop detail. Axe and a manual screen-reader pass in T8. |
| R6 | Chips duplicate Explore. | A chip opens Explore with that category preselected (`/app/explore?c=food`), so there is one implementation. |
| R7 | Tab bar hidden in directions: users lose one-tap access to Saved and More. | Back and ✕ return to HOME in one step. This is owner question Q3. |

## 7. Rollout

No database, API or service-worker cache-key changes. The static shells for `/app` and `/app/search` change, so the SW precache picks them up through the existing update prompt.

Ship order: T1 → T2 → T3 (HOME without the sheet is the owner-visible change) → T4 → T5 → T6 → T7 → T8. Each is merged behind green CI. Vercel preview per PR for the owner to try on a phone.

Rollback: revert the PR. The staged order means reverting T3 restores the old home with T1 and T2 harmless underneath.

## 8. Open questions for the owner (work proceeds on the defaults)

1. **Chip row contents.** Default: your saved places first ("Home", …), then Food & drink, Schools, Health, Markets & malls, Government, Terminals, each opening Explore filtered. Jeepney-route and terminal layer toggles stay in the Layers button. The alternative is to put a "Jeepney routes" layer chip first.
2. **Recent searches stored on this phone.** Default: yes, the last 8 picks, on the device only, never sent anywhere, and cleared with "Clear data on this phone".
3. **Tab bar while planning.** Default: hidden in Directions, Trip detail and Guidance, as in Google Maps, for more map. Back or ✕ returns to the map with the tab bar. The alternative is to keep it visible in Directions.
