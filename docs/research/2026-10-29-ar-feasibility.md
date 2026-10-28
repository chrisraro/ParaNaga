# AR feasibility for ParaNaga (zero recurring cost)

**Status: AI-written DRAFT (2026-10-29). Not a decision. Needs owner review; nothing here is approved for DECISIONS.md.**
Items marked *(unverified)* come from general knowledge, not a fetched source. Re-check before building.

## 1. Bottom line

Do **not** use WebXR or a heavy AR engine. Build an optional, small **"Look around" compass view**: live camera as backdrop (`getUserMedia`), device heading (`deviceorientationabsolute` on Android, `webkitCompassHeading` on iOS), GPS from the existing `useGeolocation`, and **plain CSS-transformed DOM labels/arrows** placed by bearing. This needs no new dependency, works on Android Chrome and iOS Safari, and costs nothing. Treat it as a "which way do I walk" aid, not precise AR. The same view must degrade to a plain compass arrow with no camera.

## 2. Use cases: useful vs gimmick

Evidence (dated sources in section 8):
- Google Live View (2019 launch, improved 2020): praised mainly for the "which way do I face" moment after leaving a transit station or in unfamiliar streets. Google itself tells users not to walk while holding the phone up, so it is designed for brief glances. It depends on Street View coverage for visual positioning (that part is not reproducible for free).
- Moovit "Way Finder" (beta): camera view with icons for bus stops and station entrances, plus a map below. That is the closest precedent for ParaNaga.
- Citymapper: no source found. Do not claim anything about it.

| Idea | Verdict for ParaNaga |
|---|---|
| "Which way is my boarding stop" arrow + distance | **Useful.** Direction at a glance, tolerant of 10-30 deg error. Core feature. |
| Floating labels for nearby stops/terminals | **Useful if capped** (nearest 3-5, within ~300 m, de-cluttered). Naga has 128 mapped stops, so clutter is manageable. Always badge unverified pins (project rule). |
| Walking arrows along the path | **Marginal.** Needs accurate position; GPS error makes the arrow wrong around corners. Show "go roughly this way, N m" instead of a ground-anchored path. |
| Identify the right jeepney by route sign | **Gimmick / out of scope.** Needs on-device vision (OCR/ML), bundle weight, and signs are unreliable. Skip. |
| Anything needing surface placement (WebXR hit-test) | **Gimmick** for a commuter app. |

## 3. Web tech and real support

- **WebXR `immersive-ar` + hit-test:** Android Chrome only, via ARCore / Google Play Services for AR on devices in Google's supported list (which lists models by manufacturer, with notes such as minimum OS or Depth API support, and has no "low-end" category). Many cheap Android phones (Infinix/Tecno/Realme entry models) may not be listed; verify per model. **iOS Safari/Chrome (WebKit): no WebXR.** visionOS Safari has partial WebXR (sources conflict on AR module). So WebXR cannot be the base: it excludes all iPhones and an unknown share of low-end Androids. Also not needed, since stops are far-field GPS points, not surface-anchored.
- **Camera + orientation + GPS ("location AR" without WebXR):** works on both.
  - `getUserMedia({video:{facingMode:"environment"}})` needs HTTPS and a permission prompt.
  - Android Chrome: `deviceorientationabsolute` gives north-referenced alpha/beta/gamma. MDN marks it "limited availability", secure context only.
  - iOS Safari *(unverified, general knowledge)*: no `deviceorientationabsolute`; use `webkitCompassHeading` on the `deviceorientation` event, and `DeviceOrientationEvent.requestPermission()` must be called from a tap (iOS 13+).
- **Libraries:**
  - **LocAR.js** (v0.2.x, MIT, volunteer-led "time-permitting"): location-based AR on three.js (README targets three ^0.175). Claims to work on Chrome and Safari iOS; Firefox unlikely; some devices report wrong north (miscalibrated sensors); duplicate three.js import problem if bundled directly. Bundle = LocAR + three.js (three is on the order of hundreds of KB minified *(unverified)*); ParaNaga has no `three` today.
  - **AR.js** (the parent; its location-based part was split out into LocAR.js; A-Frame components wrap it): heavier, A-Frame adds more weight.
  - **MindAR:** image tracking only; irrelevant (no markers).
  - **8th Wall:** hosted platform shut down Feb 28, 2026 (logins/editing ended); hosted experiences run until Feb 28, 2027. Engine framework is MIT-licensed but **excludes SLAM**; the SLAM engine is a closed binary with a license "still being finalized". Not suitable.
  - **model-viewer:** shows a single 3D model in AR (Scene Viewer / Quick Look); not for location content.
  - **Plain CSS/DOM overlay:** no library; ~150-250 lines of math using the repo's existing `domain/geo/bearing.ts`. Recommended.

## 4. Accuracy limits and mitigations

- GPS in a dense city or under tree/building cover: roughly 5-15 m, worse at street canyons; the app already has `assessFix` / `pickBetterFix` and accuracy in `LocationFix`.
- Phone magnetometer: errors of 10-30+ deg are common near metal (jeepneys, steel roofs, vehicles), and uncalibrated sensors are a documented LocAR issue. iOS reports `webkitCompassHeading` accuracy; Android does not expose it uniformly *(unverified)*.
- Mitigations:
  1. Show **direction + distance**, not a pinned exact spot; render labels as a horizontal strip with an arrow when off-screen.
  2. Smooth heading (low-pass / circular mean) and ignore jitter under ~3 deg.
  3. Hide the AR view if fix accuracy > ~30 m, and say why ("location too rough"). Never fake precision.
  4. For stops within ~25 m, show "you are at / near the stop" rather than an arrow.
  5. Optionally snap bearing to the next walk-graph node (existing `domain/walk`) so the arrow follows the street, not the crow-fly line.
  6. Offer "calibrate: wave the phone in a figure 8" and a manual "tap to align north" nudge.
- Battery: camera + sensors + high-accuracy GPS is expensive. Start only on tap, stop on hide (the existing hook already pauses when hidden), auto-stop after ~2 min idle, cap render at ~30 fps.
- Privacy: camera frames stay in a `<video>` element and are never read to canvas, uploaded or stored. Coordinates stay in React state (matches `use-geolocation.ts` rules: no network, no storage). No logging of coordinates. Add one sentence to the privacy copy.

## 5. What the repo already has (brief check)

- `src/client/geo/use-geolocation.ts`: tap-started, battery-aware watch, `LocationFix` with accuracy/heading. Reuse as-is.
- `src/domain/geo/bearing.ts`, `measure.ts`, `location-fix.ts`: bearing/distance and fix assessment. Pure TS; the new "relative bearing" function belongs here with a unit test.
- `src/client/map/use-stops-in-view.ts` + `src/client/network/use-snapshot.ts` + `domain/network/snapshot-pins`: stops come from a snapshot the service worker keeps offline, filtered in memory. A "nearby stops" list needs no server call.
- `src/client/complaints/use-camera.ts`: existing `getUserMedia` handling to copy permission/error patterns from.
- `src/client/map/use-reduced-motion.ts`: reuse for label animation.
- `three` is not a dependency. Layer rules apply: the AR view lives in `src/client/ar/` (hook) and `src/ui/ar/` (component), domain math in `src/domain/geo/`.

## 6. Recommended plan (zero cost, no new dependencies)

**Approach:** "Look around" camera compass. Data: nearest published stops/terminals from the offline snapshot. Unverified pins show the existing badge; unknown fares show as unknown.

**Permission flow (all on a tap, never on page load):**
1. User taps "Look around" (hidden entirely if `getUserMedia` or `DeviceOrientationEvent` is missing).
2. If `DeviceOrientationEvent.requestPermission` exists, call it first (iOS). Then request location through the existing hook, then camera.
3. Each denial maps to a clear message and a working fallback (below). Plain-language note: "Camera stays on your phone."

**Fallbacks (AR is never the only way):**
- Camera denied/unavailable: same screen with a dark background and the compass arrow + list.
- No compass sensor / permission denied: show the list sorted by distance with text direction ("about north-east, 120 m") and the normal map.
- Poor GPS: message plus the map.
- Every label has a text list equivalent below the view; arrow has `aria-label` and live text ("Stop X, 120 m, turn slightly left"); reduced motion respected; large tap targets; works with TalkBack/VoiceOver via the list. Do not rely on the camera view for accessibility.

**Offline:** nothing extra to cache beyond the snapshot the SW already keeps; no tiles, models or libraries needed. Camera and sensors work offline. GPS works offline.

**Phases and rough effort (one developer, existing stack):**

| Phase | Scope | Effort |
|---|---|---|
| 0. Spike | Real-device test of heading accuracy in Naga on 2 low-end Androids + 1 iPhone; measure battery over 5 min | 0.5-1 day |
| 1. Compass list | Pure `relativeBearing` + nearest-N selector, unit tests; "direction + distance" list and arrow, no camera | 1-2 days |
| 2. Sensor hook | `useHeading` (Android absolute event, iOS `webkitCompassHeading`, smoothing, permission), tests with mocked events | 1-2 days |
| 3. Camera overlay | `<video>` backdrop, CSS-transformed labels, off-screen arrows, accuracy gates, auto-stop | 2-3 days |
| 4. Polish | i18n (en/fil/bcl), a11y pass, copy, Playwright with mocked sensors, privacy text | 1-2 days |
| 5. Optional later | Snap to walk graph; compare with LocAR.js only if CSS overlay proves insufficient | 2-4 days |

Total for phases 0-4: roughly 6-10 working days. Phase 1 alone ships value without any camera.

**Decision points for the owner:** (a) go/no-go after the Phase 0 spike; if compass error in real use is regularly above ~30 deg, ship Phase 1 only; (b) adding `three`/LocAR.js (new dependency, so owner approval required) only if the CSS approach cannot meet needs.

**Risks:** magnetometer errors near vehicles; permission fatigue (three prompts: motion, location, camera); battery; iOS Safari standalone-PWA quirks around camera permission *(unverified, test)*; users walking while looking at the phone (add a "stop walking, hold up phone" hint like Google does).

## 7. Cost

No paid API is needed. Browser APIs are free, the stop data is already local, and the optional libraries (LocAR.js, three.js) are MIT. Avoid anything that requires Street View/VPS-style cloud positioning (Google Geospatial API, Niantic VPS), which is what makes Live View accurate and is not free to replicate.

## 8. Sources (accessed 2026-10-29)

- Road to VR, "Niantic's WebAR Creation Platform '8th Wall' Goes Open Source as Hosted Services Go Offline", 2026-03-10: https://www.roadtovr.com/niantic-webar-platform-8th-wall-open-source/
- Niantic Spatial, "8th Wall update: engine distribution and open source plans" (undated; hosting ends 2027-02-28): https://info.nianticspatial.com/blog/8th-wall-update-engine-distribution-and-open-source-plans
- LocAR.js README v0.2.1 (npm/jsDelivr; MIT): https://cdn.jsdelivr.net/npm/locar@0.2.1/README.md and https://npmjs.com/package/locar
- MDN, `deviceorientationabsolute` event (limited availability, secure context): https://developer.mozilla.org/en-US/docs/Web/API/Window/deviceorientationabsolute_event
- Google ARCore supported devices (checked live): https://developers.google.com/ar/devices
- Google ARCore vs WebXR comparison (hit test shipped on Chrome Android): https://developers.google.com/ar/develop/webxr/arcore-comparison
- Chrome, "AR for the web": https://developer.chrome.com/blog/ar-for-the-web/
- TechCrunch, Google Live View launch, 2019-08-08: https://techcrunch.com/2019/08/08/google-launches-live-view-ar-walking-directions-for-google-maps/
- TechCrunch, improved Live View, 2020-10-01: https://techcrunch.com/2020/10/01/google-maps-gets-improved-live-view-ar-directions
- Reality News, Moovit Way Finder AR beta (date not confirmed): https://mobile-ar.reality.news/news/transit-navigation-app-moovit-adds-augmented-reality-way-finder-feature-challenge-google-maps-live-view-0238787
- Smart Cities Dive, Google Maps AR walking directions (date not confirmed): https://www.smartcitiesdive.com/news/google-maps-releases-ar-feature-for-walking-directions/560550/
- iOS Safari WebXR status: from search-result summaries of third-party 2026 guides only (e.g. abratabia.com WebXR device support); not verified against Apple/WebKit release notes. Re-check caniuse.com/webxr before relying on it.
- Repo files read: `src/client/geo/use-geolocation.ts`, `src/client/map/use-stops-in-view.ts`, directory listings of `src/domain/geo`, `src/client`.
