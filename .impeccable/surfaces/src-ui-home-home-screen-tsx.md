---
version: 1
slug: "src-ui-home-home-screen-tsx"
primary_target: "src/ui/home/home-screen.tsx"
related_targets: []
---

# Home: map and trip sheet

Scope: the commuter Home screen (`/app`): map, search bar, trip-ends card, trip options sheet. Visitor mode: Operate. First surface of the Lunad redesign; trip detail, live trip and the other screens inherit it.

Audience and job: a resident commuter on a Naga sidewalk, one hand, bright sun, mid-range Android. They set where they are going and read which ride to take, where to board, how long and how much, in a few seconds. Unknown fares stay unknown; unverified pins stay badged.

Unresolved: the UI typeface stays as is this sprint (system stack on Home, Geist elsewhere); a landing-page direction is a later round.

## Direction contract

THESIS: Lunad looks and behaves like the map apps riders already use, so nothing has to be learned; it refuses novelty layouts and decorative brand worlds. The owner chose the category standard after two hands of alternatives. Benchmarks for finish: Apple Maps, Google Maps, Moovit.

OWN-WORLD: White and near-white surfaces over a quiet pale map; one brand green for primary buttons, selection, the start point and the L mark; amber for "your stop" (the get-off stop on the trip line), the recommended tag and caution labels such as "Unverified route"; red for the destination pin, as in every map app, and for closures and errors. The trip line keeps each mode's own colour (the mode palette is data with tested contrast and a legend), so the list and the map key to each other by mode. The city outline is a neutral hairline, never brand green. Rounded sheets and cards (12 to 16 px), pill chips, one soft shadow level or a hairline border, never both. Dark theme is the same system on green-tinted near-black.

STORY: The rider sees the map and their trip, reads the first option as the answer, and trusts it because uncertain data is labelled plainly.

FIRST VIEWPORT: Full-bleed map on top. A floating rounded search bar with the L mark at the top edge. A bottom sheet with a grab handle rising to about half the screen: a heading with the number of ways to go, then option rows of equal structure (mode icon in a soft circle, title, one line of boarding guidance, time and fare in fixed positions, recommended tag on the first). Bottom tab bar with five destinations. Primary action: tapping an option.

FORM: The category standard (canon), chosen by the owner over the dealt directions; seed: seed:9cbc0a68b94ae404.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
