# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Lead user (owner-confirmed 2026-11-10): the resident commuter.** Lives in Naga City, rides jeepneys and tricycles daily, knows some routes but not all. Opens the app often and briefly, one-handed, outdoors, on a mid-range Android phone over mobile data. When needs conflict, this person's speed and repeat use win.
- New students (ADNU, UNC, BISCAST, NCF): daily commute on a tight budget, eligible for discounts.
- Tourists and pilgrims (Peñafrancia season): first visit, need to know where to wait, what to tell the driver and when to get off.
- Contributors: riders who notice a wrong pin or fare and report it.
- Staff: transport-data reviewers, community moderators, complaint reviewers and administrators, on the English-only admin console.

## Product Purpose

Lunad is a mobile-first commuter PWA for Naga City that tells a rider which ride to take, where to board, what it costs and where to get off. It exists because the city's jeepney network is published as street lists and ordinances, not as something a person can navigate. Success is a plan the rider can trust: a verified itinerary inside covered areas, and few "wrong side, wrong stop" reports.

## Positioning

Honest local transport data. Every fact carries an evidence level; unknown fares, stops and routes are shown as unknown, and unverified pins are always badged. The app would rather show a clearly labelled gap than a confident wrong answer.

## Operating Context

- Rides: traditional and modern jeepneys on fixed routes and loops, tricycles and pedicabs with road and time restrictions, walking legs, and intercity services leaving Naga.
- Riders flag down a ride, read the signboard, tell the driver the destination and call the stop themselves. Directions are given by landmark ("beside NCF Magsaysay, toward Centro"), not left and right.
- Use happens on the street: bright sun, one hand, short glances, patchy data. The app works offline for saved trips and cached data.
- Languages: English, Filipino and Bikol (Central Bikol, falls back to Filipino). Admin screens are English only.

## Capabilities and Constraints

- Guest by default: search, explore and plan need no account. Accounts sync saved places and trips and allow contributions.
- Home is a map with search and a draggable trip sheet. Trip options, trip detail, live trip guidance with on-device ETA, stops, routes, terminals, saved, community hub, correction reports, private driver reports with a MyNaga handoff.
- No live vehicle positions and no arrival countdowns: no fleet feed exists.
- AI (Jev) output is evidence only; app policy decides, and AI never changes a fare or route.
- Driver-report evidence is private to the complaint-review role and is never published.
- Coordinates and complaint evidence are personal data: never logged, never cached.
- Targets at least 48 px, high contrast, light and dark themes, reduced motion respected. No animation library; CSS only.
- Stack is fixed: Next.js App Router, React, Tailwind 4, React-Leaflet maps, Serwist PWA.

## Brand Commitments

- **Name: Lunad** (owner-approved 2026-11-10). Bikol Central for "ride, embark"; its opposite is "lusad", "get off". Replaces the working name ParaNaga.
- **Mark: the route-shaped L** (owner-approved): an L drawn as a route with a start node, one turn and a dot for the stop.
- **Reach: Bikol-wide later.** The logo is "Lunad" alone. Naga is the current city, not part of the lockup.
- Colours, typeface and the overall look are open; the green and amber shown with the first mock-up were placeholders.
- Not yet checked: trademark register, app stores, domain. A Bikol speaker should confirm the name reads naturally.

## Evidence on Hand

- Published network data: routes R1 to R8-D, Loops A to D, stops, terminals, tricycle road rules, 31 intercity destinations and 22 services (production revision `anywhere-alight-2026-10-16.4`).
- Product spec in `docs/spec/` (01 to 07). Existing screens and e2e fixtures in `tests/e2e/fixtures/`.
- No testimonials, ridership numbers, partner endorsements or city endorsement exist. Do not invent them.

## Product Principles

1. Useful map first: the home screen is the tool, not a marketing wall.
2. Honest over complete: label what is unverified, never present a guess as fact.
3. Guest by default, least data collected.
4. Outdoor-readable and one-handed.
5. Landmarks over left and right.

## Accessibility & Inclusion

WCAG 2.2 AA is the working bar; axe checks run in the e2e suite on light, dark and high-contrast themes. Three languages, with Filipino and Bikol text lengths considered in layout.
