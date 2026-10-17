# Trip planner and travel options audit (2026-10-18)

Base: `fix/plan-handler-ratelimit-mock` (master plus PR #40). Branch: `fix/planner-audit`.

## How the bugs were found

- **Published data.** Read with public GETs only: `network/head`, then `snapshot`, `lines`, `walk-graph` and `search-places` for revision `5a9c762c` (`anywhere-alight-2026-10-16.2`). No POST was made and nothing remote was written.
- **Harness.** A scratch harness, not committed, built the planner network the way `network-cache.ts` does. It ran `planTrip` on 30,000 plans: 6,000 seeded origin/destination pairs at five Manila times (06:00, 09:30, 13:00, 20:30, 22:30).
  - Points: the 27 barangay anchors, 12 named places (Plaza Rizal, Ateneo, Magsaysay, Basilica, Concepcion, Pacol market, Panicuason, Cararayan, Tabuco and others), offsets at 150, 300, 450 and 700 m, and random points inside the city.
  - Coverage: 485 trips under 500 m, 1,530 Del Rosario trips, 950 access options and 1,460 special-trip cards.
- **Invariants checked on every plan:**
  - Recommended: exactly one, except the legal far/no-jeepney case. Under the T7 rule it is the cheapest jeepney at 500 m or more, otherwise the tricycle. Under 500 m it is the walk unless the jeepney passes the destination.
  - Order: walk, then jeepneys by fare ascending, then access, tricycle, padyak.
  - Values: no NaN, negative or zero distances or fares; fare min ≤ max; rides board before they alight and are at least 200 m; walk caps hold.
  - Content: no duplicate ids or legs; far-zone rules hold; Del Rosario vias are present; "Fewest transfers" and "Least walking" are true minima.
  - Copy: no ETA, live, arriving or e-jeep wording; modern jeeps only on R4 and R7.
  - Schema: every plan validates with `planResponseSchema`.
- **UI.** The options list, peek, detail, status states and home-screen trip flow were read. A read-only reviewer pass covered the same files. The peek was measured on the mobile project (Pixel 7 at 320 and 375 px wide, 700 px tall).

## Findings

| # | Severity | Where | Evidence | Fix | Status |
|---|---|---|---|---|---|
| 1 | Important | `src/domain/planner/plan.ts:696` | Under 500 m, "passes the destination" was checked on the best-score jeepney, but the label went to the cheapest one (T7). Dayangdang to Balatas (393 m) recommended a 6.9 km R8-C near-full lap whose drop-off is 195 m from the destination, and the walk lost Recommended. | The check now uses the option that gets the label; otherwise the walk is Recommended. Red test with the real fixtures, plus an `assertWellFormed` invariant. Digest unchanged. | Fixed `e848198` |
| 2 | Important | `src/client/trip/use-trip-plan.ts:78`, `src/ui/trip/trip-status.tsx` | Every non-OK 4xx mapped to "invalid", so a 429 rate limit showed "Couldn't plan this trip. Both points must be in Naga City." with "Change start or destination". | New `busy` kind: "Too many trip searches right now. Wait a minute, then try again." with Try again. A saved-trip reopen reads it as "Couldn't check updates". | Fixed `f886ded` |
| 3 | Important | `src/ui/trip/trip-detail.tsx:163` | In the access option detail, an unnamed board point after the tricycle read "Get on near <your start>", not the loading point. R6/R7 board points usually have no pin name. | `here` moves to the tricycle's loading point. Red test in `far-cards.test.tsx`. | Fixed `1c89ea8` |
| 4 | Important | `src/ui/home/home-screen.tsx:278`, `src/ui/trip/trip-options.tsx` (`OptionsPeek`) | The peek had a fixed 276 px. A long best-option line (access: 78 px at 375 px, 97.5 px at 320 px) pushed "All options" 9–28 px below the screen at peek. Measured on the mobile project. | `OptionsPeek` reports its line's overflow beyond the 44 px row, and the peek grows by it. Unit test plus a mobile e2e in `far-cards.spec.ts`. | Fixed `35449f4` |
| 5 | Important (owner decision) | `src/domain/planner/paths.ts:135` | A circuit ride may cover up to the whole lap minus 1 m. On published data, 995 option instances ride ≥ 80 % of a loop, and 175 of them are Recommended. Example: a 660 m trip near Ateneo recommends 6,771 m of R8-C's 6,946 m loop. Plaza Rizal to Pacol offers R4 13,655/14,228 m, then R7. | Proposed: reject a circuit ride over a set share of the lap (for example 75 %), or over N × the direct walk. This is a product threshold and changes the 200-trip digest, so it is left to the owner. | Open |
| 6 | Minor | `src/domain/planner/plan.ts:349` | "Fewest transfers" goes on the best-score option of the fewest-rides group even when every jeepney shown has the same ride count. Example: Plaza Rizal to Del Rosario, three 1-ride vias, one labelled "Fewest transfers". 2,360 of 30,000 plans. | Show the label only when it distinguishes (changes the digest). | Backlog |
| 7 | Minor (owner decision) | T7 rule as decided | At 500 m or more the cheapest jeepney is Recommended even when it is long for the trip. Example: a 599 m trip near Ateneo recommends a 2-ride 3.8 km jeepney. 1,065 option instances ride more than 5 × the direct walk. | Keep (the owner's rule); listed so the owner sees the effect. | Open |
| 8 | Minor | `src/domain/eta/eta.ts:197` | Street legs (tricycle and padyak) count as rides for waiting. A tricycle-only option's share text and saved card read "Tricycle time not estimated + waiting (unknown)". The access option reads "(unknown, 2 rides)", counting the tricycle. Existing tests assert this text. | Decide whether hailing a tricycle is a "wait". | Backlog |
| 9 | Minor | `src/ui/trip/trip-detail.tsx:511` | Without an ETA model, a tricycle or padyak detail header says "Time not available" (the card says "Time not estimated"). | Test `option.rides === 0 && streets[0]` instead of `noMinutes`. | Backlog |
| 10 | Minor | `src/ui/trip/trip-options.tsx:216` | Plain tricycle, padyak and walk cards read "No transfers". The comment says this says nothing for a tricycle, but only access and special are skipped. | Also skip when `street` is set. | Backlog |
| 11 | Minor | `src/domain/eta/format.ts:74` | Per-leg detail times read "≈ 5–7 min walk", without "Est."/"Estimate" (the header total has it). | Owner wording call. | Backlog |
| 12 | Minor | `src/domain/trip/present.ts:116` | A special-trip step in share text or a saved card says "fare not available" next to "Fare: Fare not fixed". | Pass the special flag and write "fare not fixed". | Backlog |
| 13 | Minor | `src/ui/trip/trip-options.tsx:90,208`, `src/ui/trip/trip-detail.tsx:247,311` | Notes are keyed by their text. Two rides with the same note text would collide. | Key by index. | Backlog |
| 14 | Minor | `src/ui/trip/trip-options.tsx:350` | At half the toggle says `aria-expanded=true`, yet pressing it lifts the sheet to full rather than collapsing. | Announce the next state, or collapse from half. | Backlog |
| 15 | Minor | `src/ui/home/home-screen.tsx:285` | `openedId` survives a loading replan. Fixed ids ("walk", "tricycle") could reopen a detail on a new trip. There is no current path: the ends rows are hidden while a detail is open. | Clear on an ends change. | Backlog (latent) |
| 16 | Minor | `src/domain/planner/plan.ts:18-21` | The header comment still said "≥ 500 m → the tricycle". | Updated with fix 1. | Fixed `e848198` |
| 17 | Minor | `src/domain/planner/plan.ts:651` | Access is decided on the Pareto picks' first walks, not on the via-extended block that is shown. Harmless today: no far-zone via group. | None needed now. | Backlog |

### Rules checked and holding

On the 30,000 published-data plans, every owner rule held after fix 1:

- One Recommended, apart from the legal far case.
- Order, values, legs, walk caps and labels as listed in the invariants above.
- Far zones: no plain tricycle; only special-trip tricycles; access tricycles over 600 m.
- Del Rosario: all 410 trips with 2+ of R2/R3/R4 carry via chips.
- No banned wording; modern jeeps only on R4 and R7.
- Schema-valid; no throws.

## Tests

- Gates: `pnpm exec eslint src tests scripts` (0 errors; the 9 warnings are already on the base), `pnpm typecheck`, `pnpm check:boundaries` and `pnpm test` (161 files, 2,001 tests) all pass.
- E2E: `tests/e2e/far-cards.spec.ts` on the mobile project, 11/11 passed (PORT=3541).
- Regression digest in `planner-real-loops.test.ts`: unchanged.
