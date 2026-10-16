# 6. Screens

## 6.1 Design system

**Identity.** Deep navy (structure, text), teal (primary action, verified), warm coral (attention, report actions). Rounded cards (12 px), restrained shadows, no decorative clutter, no fake activity counters.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--navy-900` | `#0F1E3D` | surface `#0B1220` | Text, headers |
| `--teal-600` | `#0E8C86` | `#2BB5AE` | Primary buttons, verified badge |
| `--coral-500` | `#F26B5B` | `#FF8A7A` | Report, warnings needing action |
| `--amber-500` | `#E8A317` | `#F2B84B` | Candidate / unverified badge |
| `--surface` | `#FFFFFF` | `#111A2E` | Cards, sheet |
| `--bg` | `#F4F6FA` | `#0B1220` | Page |

All text/background pairs ≥ 4.5:1 (≥ 7:1 in high-contrast mode). Verified/candidate states never rely on colour alone: solid vs hollow marker + text badge + icon.

**Route identity.** Each route gets a colour, a letter/number chip (`R5`, `8A`), and a direction arrow. Legacy panel colours (Panganiban yellow, Magsaysay white…) appear only as "historical identifier" hints after field confirmation.

**Type.** Inter (or system UI) — 16 px base, 20/24 px headings; numbers tabular. Filipino strings run ~20 % longer: layouts tested with `fil` pseudo-expanded strings.

**Touch & motion.** ≥ 48 × 48 px targets; primary actions in bottom third on mobile. `prefers-reduced-motion` disables map fly-to animations (jump instead) and sheet springs.

**Status badges** (used everywhere): `Verified` (teal), `Mapped candidate` (amber, hollow), `Documented only` (grey), `Trial — permanence unconfirmed` (amber, dashed), `Temporary until {date}` (coral), `Retired` (grey, struck). Fare chips: `Exact`, `Estimate`, `Partial`, `Unknown`.

**Layout.** Mobile: map + 3-snap bottom sheet (peek 96 px / half / full). Tablet/desktop ≥ 1024 px: 400 px list panel left + map right. Admin: desktop-first, responsive to tablet.

## 6.2 Navigation map

```
Bottom tab bar (mobile) / left rail (desktop)
├─ Map (home)
│   ├─ Search ─▶ Results ─▶ Place detail ─▶ Trip options ─▶ Trip detail
│   │                                                     └▶ Walk ▶ Ride ▶ Transfer ▶ Arrive
│   ├─ Stop detail ─▶ Route variant detail
│   └─ Terminal detail
├─ Explore ─▶ Destination ─▶ "How to commute here" (Trip options)
├─ Community ─▶ Post ─▶ Comments · New post · My submissions · Guidelines
├─ Saved ─▶ Saved trip card (offline) · Saved places · History (if enabled)
└─ More ─▶ Settings · Report a driver · My reports ─▶ Report detail ─▶ MyNaga handoff
          · My corrections · Changelog · Help/Safety · About data & sources · Sign in

/admin (role-gated)
├─ Dashboard · Imports · Candidate review · Routes & variants · Shape editor
├─ Stops & curbs · Reconciliation · Terminals · Fares · Service windows · Disruptions
├─ Revisions & publication · Coverage audit
├─ Corrections review · Community moderation · Appeals
├─ Complaint review (complaint_reviewer only)
└─ Users & roles · Jev & providers · Jobs · Audit log
```

## 6.3 Commuter screens

Each screen lists purpose, key content, primary actions, and its required states: **L** loading, **E** empty, **P** permission-denied, **O** offline, **G** poor GPS, **D** partial data, **X** error.

### S1 Home / Map
- Content: map with layers (verified stops, candidates, terminals, reviewed shapes, disruptions), search bar, "Where to?" sheet with recent/saved places, nearby verified stops list, mode toggle **Explore mapped stops | Plan verified commute**.
- Actions: search, locate me, recenter, legend, filter routes, low-data toggle.
- States: L skeleton sheet + map placeholder; E (no verified stops nearby) "No verified stops within 500 m — see mapped candidates"; P "Location off — set your starting point" with search/map-pick; O cached snapshot + date, tiles may be missing (shows list-only fallback); G accuracy circle + "Location approximate (±80 m)"; D banner "Verified coverage: Loops A–D only".

### S2 Search
- Grouped results: Places, Stops, Routes, Barangays, Saved. Alias disambiguation ("Diversion → Diversion Road (Concepcion) · Diversion jeepney route (legacy)").
- Toggle: "Include regional connections".
- Actions: pick, map-pick, use current location.
- States: E "No match in Naga — try a landmark or barangay"; O searches cached landmarks only, labelled.

### S3 Place / landmark detail
- Name, kind, entrance (if known), aliases, source; "Directions from here / to here".
- Rules: no invented hours, photos, ratings.

### S4 Trip options
- Header: from → to, time (now / depart at), fare category chip.
- Cards (≤ 4): label (Recommended/Cheapest/…), leg strip (walk icon → route chip → …), fare chip with completeness ("₱14 + 1 unknown"), walk m, transfers, confidence meter, restrictions, revision date.
- States: E **coverage none** → "We don't have a verified commute for this trip yet" + nearest verified stops to origin/destination + "Explore mapped candidates" + "Help map this route"; D "Some legs use unverified walking paths"; X planner error with retry.

### S5 Trip detail
- Vertical timeline: walk (distance, path verified?), board (stop code, landmark, photo, toward cue, signboard text "Look for: CENTRO–SAN FELIPE"), ride (stops count, alight at), transfer, arrive (entrance).
- Fare breakdown table per leg with evidence date.
- Actions: Start, Save, Share (text summary, no location), Report a correction.

### S6 Walk to boarding (active)
- Compass/heading arrow toward curb, distance, accuracy circle, boarding-side cue ("Wait on the side toward Centro, beside NCF Magsaysay"), photo.
- Landmark check card when accuracy envelope spans both curbs: "Are you beside {landmark}? [Yes] [Not sure — show photo]".
- Banner: "Keep ParaNaga open for guidance."
- States: P falls back to step list with "I'm at the stop" button; G landmark check, no side assertion.

### S7 Ride mode
- Big "I boarded" → progress bar along shape, next stop, stops remaining, "Get off at {stop} — {landmark}". Approaching alert (≤ 400 m / 1 stop) with vibration+sound if permitted.
- Actions: "I got off", "I missed my stop", **Report a driver** (coral, secondary).
- Off-route: after hysteresis, sheet "You seem off route — [Replan] [I'm fine]".

### S8 Transfer
- Mini map: alight curb → crossing/terminal entrance → next curb; next signboard and direction.

### S9 Arrive
- Last-mile walk to entrance; "You've arrived" → trip ends, watchers stopped; prompt to save or rate usefulness (no star ratings of drivers).

### S10 Stop detail
- Header: name + status badge, source (e.g. "Loop Service B · code B23 · 13.6299849, 123.1980793"), raw description.
- Routes serving (only via route-stop association) with direction arrows and boarding/alighting permissions; "Routes passing nearby (not confirmed to stop)" in a separate muted section.
- Curb side, toward cue, photos (redacted), accessibility evidence, sign text, evidence freshness, "Help improve".
- Candidate variant: amber banner "Mapped candidate — not verified for navigation. Source: public My Maps snapshot (15 Oct 2026)".

### S11 Terminal detail
- Entrances on map, bays list with routes/destinations, hours with evidence, "category labels are administrative, not compass directions" note.
- Implemented (Increment D): terminals are a map layer (a switch in the Layers sheet; stop pins stay tappable above them) and have a detail page `/app/terminals/{code}`. It shows the kind (terminal, loading point, waiting area, station), the vehicle modes serving it with their mode chips, the OpenStreetMap coordinate with its provenance and "Map data © OpenStreetMap contributors" (a way coordinate is a centroid, not an entrance), "No location on file" for a terminal without a coordinate, the routes whose street list names it, and the regional services leaving from it with per-km fare **estimates** ("operator prices may differ"; rates only when the distance is not on file). Regional routes are listed, not drawn.
- Increment E replaced the tricycle hint card with ranked options (see S4 Trip options). Tricycle terminals are named inside the tricycle step ("Nearest tricycle terminal").

### S12 Routes list / route variant detail
- List grouped by group number with chips; filters by mode/barangay.
- Variant: headsign, direction, vehicle class, legal plan text (street list), shape (if reviewed) or "Shape not yet surveyed", ordered stops (if reviewed), fares, service window ("Observed 5:30–20:00 weekdays, departs when full"), disruptions, trial revisions, legacy aliases.
- Implemented (Increment D): each route shows a mode chip and its vehicle classes ("Jeepney · traditional", "Jeepney · traditional and modern" on R4 and R7, "Jeepney · type not confirmed"), the route's approximate path drawn on the map with notes where the path leaves the legal street list ("street order conflicts with one-way mapping — confirm on the ground", "terminal access road"), or "Path could not be traced from the street list" when no path was traced. The path is never called a route shape.
- Map legend and Layers sheet: a collapsible Legend (mode icon, line swatch and text label for every mode drawn; the note "Dotted: approximate walking path · crossings not checked"; the mixed-fleet note; the fixed footnote "Lines are approximate paths, not verified route shapes."). The Layers sheet is a modal dialog (Tab trapped, focus returns to the Layers button) with switches for Routes and Terminals, mode chips (All, Jeepney, Tricycle, UV Express, Bus, Train) and the accessible list equivalents "Routes on the map (n)" and "Terminals (n)", plus a note that regional UV Express and bus routes leave the city. Colour is never the only cue: each class has an icon, a text label and a line pattern, in two palettes (light for drawn tiles, dark only when no tiles are drawn) that pass 3:1 against their casing.


### Trip option copy (Increment E)
- Free points: "Get on near {place}" / "Get off near {place}", "Get on near your start" / "Get off near {destination}" when no name is within 100 m, always with "Tell the driver 'para' · stop not marked". "About {m} m of riding left (approximate)" in guidance.
- Walk card only under 500 m; at 500 m and above, "Walking the whole way is about {m} m along streets" stays a note. Exactly one card says Recommended.
- Tricycle: "Take a tricycle to {destination} · about {km} km along streets · minimum fare ₱15 · confirm with the driver", "Avoids the restricted roads we could locate (Ordinance 2006-005/015; allowed 9 pm-5 am)"; without a street route "Route not confirmed" or "Street route not available" and no claim of avoidance. No minutes: "Time not estimated".
- Padyak: "₱10 per passenger (₱8 with ID discount) · city fare set Sep 2022 · confirm with the driver · up to 2 passengers"; drawn dashed on the map. No minutes.
- Route notes show one line per ride on the card, all in detail, each with its evidence label (for example "Ask the driver"). Service window chip: "Usually runs about 5:00-21:00 · unconfirmed"; detail adds "Some jeepneys reportedly start before 5 am." and the Help article says "Sunday and holiday service not confirmed". Never hides an option.

### S13 Explore
- Curated cards (Basilica Minore, Naga Metropolitan Cathedral, Plaza Rizal, BCS, ADNU, UNC, BISCAST, Bicol Medical Center…) — only fields with sources; "How to commute here".
- Feeder leads section: "Documented, not verified" (SF01–SF05).

### S14 Saved
- Saved trips (offline badge, revision date, "changed" flag), saved places, history (only if enabled).
- Offline trip card: text-first, works without tiles.

### S15 Settings
- Language, fare category (with per-mode eligibility table), accessibility, theme, low-data, history toggle, location help, offline downloads (area + size), install app, privacy (export, delete account), about data & sources.

### S16 Report a correction (wizard)
1. What's wrong (type list) → 2. Entity preview (prefilled with revision) → 3. Similar submissions ("Add my evidence to this") → 4. Proposed change with before/after preview → 5. When observed, fare category/kind, shared/exclusive → 6. Optional location + photos → 7. Review + AI-processing disclosure → Submit → status page.
- Status page shows the 10-state timeline and reviewer notes.

### S17 Community
- Feed with filters (topic, route, stop, barangay), labels (Official notice / Community observation / Incorporated change), helpful count, bookmark.
- Post detail with threaded comments (2 levels), report, block author.
- New post: guidelines acknowledgment (first time; versioned) → compose (category, context chips, text, photos) → submit → "Pending review" state.
- My submissions: status per version, rejection reasons (templated, localized), revise & resubmit, appeal (once).

### S18 Report a Driver (private)
1. Explainer: privacy + safety + "not sent to Naga City automatically" + emergency info (911) → [Continue] [Cancel]
2. Capture: request camera on tap → rear camera live view → shutter / short video → preview with Retake / Remove / Add another. Fallback buttons: "Upload a photo instead", "Continue without photo".
3. Details form: category, what happened (factual prompt), incident time (default now, editable; shown separately from capture time), location (GPS with accuracy or manual pin, or none), route/direction, operator, plate/body number (checkbox "I don't know").
4. Acknowledgment text (brief §9D) + checkbox.
5. Review page (everything the reviewer will see) → Submit privately.
6. Receipt: reference `PN-XXXX-XX`, status, next steps, **Continue in MyNaga**.
- States: P camera denied → explanation + upload fallback; X upload failed → resumable retry, draft kept only on this device (IndexedDB, media as Blobs; cleared on submit, cancel or sign-out; the explainer warns that anyone with the unlocked phone could see it); O draft saved, submit disabled with message.

### S19 My reports / report detail
- List with status chips; detail shows ParaNaga status timeline (reporter-visible events), messages, and a **separate** "MyNaga (self-reported)" panel.

### S20 MyNaga handoff
- 4 steps: (1) Prepare — copy summary, choose evidence to download/share; (2) Open MyNaga — buttons for app (Android/iOS store), website, city info page; (3) Submit there — guidance; (4) "I submitted it" + optional reference field.
- Copy: "ParaNaga is not affiliated with MyNaga or the City Government. Opening MyNaga does not submit your report."

### S21 Sign in
- Email → OTP / magic link; Google. Explain why an account is optional.

### S22 Help, safety, about data
- How verification works, badge legend, sources register (S01–S42 with dates), limitations (no live arrivals, foreground-only alerts), emergency numbers.

## 6.4 Admin screens

| Screen | Key elements | Guardrails |
|---|---|---|
| A1 Dashboard | Coverage (27 barangays), queues counts, Jev/provider health, stale data warnings | — |
| A2 Imports | Upload/select source, dry-run diff (added/changed/missing), conflicts list, counts check (128; A30/B31/C34/D33), commit | Commit disabled if errors or count mismatch |
| A3 Candidate review | Map + table of candidates, evidence attach, status promotion, relocate/retire | Each promotion requires evidence of the claimed kind |
| A4 Routes & variants | Legal text, aliases, trial/event revisions, effective intervals | Trials need status + expiry or review date |
| A5 Shape editor | Draw/edit LineString on map, OSM roads as snapping aid, GPS log overlay, validation panel | Flags disconnected parts, U-turn spikes, out-of-bbox |
| A6 Stops & curbs | Curb point on correct side, link road segment, toward label, boarding/alighting, photo redaction | Opposite-direction check vs shape |
| A7 Reconciliation | Proposed duplicate groups (same coords / < 15 m / similar label), side-by-side source pins | Never auto-merge; reviewer chooses link/keep separate |
| A8 Terminals | Compound polygon, entrances, bays, route assignments, hours | — |
| A9 Fares | Rule versions, matrices import, discount scopes, conflicts (e.g. EASTTODA ₱13 vs 20 %) | Conflicted rules cannot be `verified` |
| A10 Service windows | Observations per day type, dispatch model | No "live" wording |
| A11 Disruptions | Scope picker, active interval (end required), replacement note | Auto-expire job |
| A12 Revisions | Diff vs published, validation report, publish (step-up), rollback | Publish blocked on any error |
| A13 Coverage audit | 27 × 9 matrix | — |
| A14 Corrections review | Queue by entity, evidence, similar submissions, accept/reject/duplicate/needs evidence | Accept ≠ publish |
| A15 Community moderation | Queue with Jev evidence (probabilities, not prose), reason codes, override with note | Cannot moderate own content |
| A16 Appeals | One per decision, decision history | Different moderator than original when possible |
| A17 Complaint review | List (no thumbnails), open → evidence viewer with signed URL + "access logged" notice, notes, status, outcome code | Role `complaint_reviewer` only; step-up |
| A18 Users & roles | Search by email, grant/revoke with reason | Admin only; no self-grant |
| A19 Jev & providers | Model/build, policy version, success rate, latency, last errors, circuit state, budget; "Run diagnostic" (synthetic text) shows request id + pass/fail | Never shows key |
| A20 Jobs | Pending/failed/dead-letter, retry | — |
| A21 Audit log | Filter by actor/entity/action | Read-only |

## 6.5 Copy rules (localized via message catalog)

- Never: "live", "arriving in", "guaranteed", "official" (unless an official source), "submitted to the city".
- Time estimates (Increment D): a duration is always a range with a word or sign that marks it as an estimate: "Estimate 18–27 min + waiting (unknown)" for a trip, "≈ 14–18 min walk" or "≈ 12–18 min ride" for a leg, "About 10–16 min left (estimate)" in guidance. Never a single number, never a clock time, never "arrival", "ETA" or "arriving". Waiting is stated as unknown. A tricycle leg says "Tricycle time not estimated". With no model on file: "Time not available". Screen readers get the range in words ("18 to 27 minutes"). "Arrive" is used only for the step the rider confirms ("Arrive at your destination", "I've arrived"), never as a predicted time.
- Approximate paths: a ride path is "Approximate path, not a verified route shape" (legend footnote) and a walk path is "Approximate walking path · crossings not checked"; a straight walk says why ("Straight line · no street path found", "· loading street paths…", "· Street paths need a connection the first time."). Distances read "≈ 3.4 km along the approximate path" or "≈ 3.1 km stop to stop (straight line)".
- Vehicle classes are named only as far as a source supports: "traditional", "traditional and modern" (R4, R7, owner-confirmed 2026-10-16), "type not confirmed". There is no e-jeepney anywhere in the app. Fares are "Estimate" ranges with the note that discounts are not applied.
- Always pair unknowns with a next step: "Fare unknown — help us by reporting what you paid".
- Rejection reasons come from templates keyed by policy reason codes, never from model text.
- Fixed brief texts (community acknowledgment, driver-report acknowledgment) are stored verbatim in `en` with reviewed `fil` translations.

## 6.6 Accessibility requirements

- WCAG 2.2 AA; axe checks in Playwright for every screen.
- Map is never the only way: every map interaction has a list equivalent (stops list, step list).
- Screen-reader announcements for trip progress (`aria-live="polite"`), alerts (`assertive` only for approaching stop).
- Focus management on sheet snap, dialogs, wizard steps; visible focus rings.
- Text resize to 200 % without loss; landscape supported.
