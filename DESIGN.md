---
name: Lunad
description: Commuter map app for Naga City, built to look and behave like the map apps riders already know.
colors:
  brand: "#0b6b52"
  brand-strong: "#084d3b"
  brand-soft: "#e3f1ec"
  on-brand: "#ffffff"
  brand-bright: "#2fbf93"
  brand-light: "#6fd9b5"
  on-brand-bright: "#04221a"
  accent: "#ffb81c"
  accent-ink: "#6b4a00"
  accent-soft: "#fff3d6"
  accent-line: "#a86f00"
  danger: "#c73a2f"
  danger-ink: "#9e2a21"
  danger-soft: "#fce6e3"
  danger-bright: "#ff8a7a"
  ink: "#17211d"
  ink-2: "#4a5651"
  ink-3: "#5c6964"
  canvas: "#f5f7f6"
  surface: "#ffffff"
  fill: "#ecefed"
  border: "#d5dbd8"
  deep: "#0f2e25"
  deep-2: "#0a211a"
  deep-raised: "#17463a"
  night: "#0e1512"
  night-surface: "#17201c"
  night-raised: "#1f2a25"
  night-border: "#2c3832"
  night-ink: "#f1f5f3"
  night-ink-2: "#a7b4ae"
  night-ink-3: "#8a9790"
  map-land: "#f2efe9"
  mode-traditional-puj: "#b45309"
  mode-modern-puj: "#1d4ed8"
  mode-tricycle: "#a21caf"
  mode-e-tricycle: "#0e7490"
  mode-uv-express: "#be123c"
  mode-bus: "#6d28d9"
  mode-unconfirmed: "#57534e"
typography:
  headline:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title-lg:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body-lg:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  tag:
    fontFamily: "-apple-system, 'SF Pro Text', Geist, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: "16px"
rounded:
  pill: "999px"
  sheet: "16px"
  card: "14px"
  row: "12px"
  inset: "10px"
  sm: "8px"
spacing:
  hair: "4px"
  chip-gap: "6px"
  xs: "8px"
  list-gap: "10px"
  float-inset: "12px"
  stack: "14px"
  gutter: "16px"
  target: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.pill}"
    height: "50px"
  button-primary-dark:
    backgroundColor: "{colors.brand-bright}"
    textColor: "{colors.on-brand-bright}"
    rounded: "{rounded.pill}"
    height: "50px"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "48px"
  search-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "26px"
    height: "52px"
    padding: "0 18px 0 12px"
  chip-category:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "18px"
    height: "36px"
    padding: "0 14px"
  option-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px"
  peek-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.row}"
    height: "56px"
    padding: "3px 14px 3px 12px"
  tag-recommended:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  tag-neutral:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-2}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-caution:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  trip-ends-card:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.card}"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sheet}"
    padding: "6px 4px"
  tab-bar-tab-current:
    textColor: "{colors.brand}"
    rounded: "{rounded.inset}"
    height: "54px"
  map-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "48px"
  bottom-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "16px 16px 0 0"
    padding: "0 16px"
---

# Design System: Lunad

## Overview

**Creative North Star: "The category standard, played straight"**

Lunad looks and behaves like the map apps a rider already has on their phone, so nothing has to be learned. The owner chose this on 2026-11-10 after seeing two rounds of more distinctive directions; the benchmarks for finish are Apple Maps, Google Maps and Moovit. The screen is a full-bleed map with white chrome floating over it: a rounded search bar at the top, pill chips under it, round controls at the right edge, a floating tab bar at the bottom, and a draggable bottom sheet for trips.

Colour does little and means something each time. Green is the brand and the primary action. Amber marks "your stop", the Recommended tag and cautions. Red is the destination pin, closures and errors. Each transport mode keeps its own data colour on the line and in the legend. Everything else is white, near-white and green-tinted ink. The dark theme is the same system on green-tinted near-black.

The product's promise is honest data, and the system carries it visually: an unverified route gets an amber chip in a fixed place, an estimate is written as "Est.", an unknown fare gets a dashed outline, and none of these is ever styled away.

**Key Characteristics:**
- Map first: the map is the screen and every other element floats over it or slides up from the bottom.
- White, rounded, quiet chrome: pills for controls, 12 to 16 px corners for cards and sheets.
- One elevation language: a soft shadow for what floats over the map, a hairline inside sheets, hairline only in dark.
- Three meaning colours (green, amber, red) plus the mode palette, which is data.
- Outdoor-readable: 13 px is the working minimum for text, targets are at least 48 px, secondary text is at least 4.5:1.
- CSS-only motion on transform and opacity, with reduced motion respected everywhere.

### Coverage of this record

Only the Home screen has been rebuilt to this system: the map, the search bar, the trip sheet, the option cards, the trip detail header and the tab bar. Every other screen (stop and route detail, Explore, Saved, Community, reports, Help, Settings, sign-in, the admin console) takes the new palette through the tokens but keeps its earlier layout and component styling until later sprints. The landing page is a separate, later direction round; nothing here describes it. When extending a screen that has not been rebuilt, follow the Home patterns below, not the screen's current styling.

### Known deviations (present in the code, not rules)

- A timeline side stripe remains at `src/ui/reports/reports.css:73` (`border-left: 3px`, the last item in brand green). Three such stripes were removed on Home. A second one sits on nested comments at `src/ui/community/community.css:363`.
- Glass and blur remain on the landing page nav (`src/ui/landing/landing.css:301`). The map controls still carry the class name `pn-glass`, but it is a solid surface now.
- The typeface was not changed in this sprint. See Typography.
- The route overview card, the layers sheet, the confirm dialog and the terminal markers use older shadows, and the overview card pairs a border with a shadow (`src/ui/modes/modes.css:597`). They predate the one-elevation rule.
- The legend, mode chip, layers sheet and overview card set their light background as a literal white instead of the surface token (`src/ui/modes/modes.css`).
- The switch and the tab bar tabs transition `background-color` and `color` (`src/ui/kit/kit.css:256`, `:386`), outside the transform-and-opacity rule.

## Colors

A white and near-white interface with one green, one amber and one red, over a pale map. All values are defined once in the `@theme static` block of `src/app/globals.css` as `--color-*`; screens read them through their own `--pn-*` aliases, which switch for dark and high contrast.

### Primary
- **Lunad Green** (`brand`, #0b6b52): primary buttons, the selected option's 2 px border, the start pin, the current tab, links, the locate control, focus rings, the mark's tile.
- **Deep Green** (`brand-strong`, #084d3b): pressed state, text on green tints, and the accent in high-contrast mode.
- **Bright Green** (`brand-bright`, #2fbf93) with **Night Green ink** (`on-brand-bright`, #04221a): the primary colour on dark surfaces. **Light Green** (`brand-light`, #6fd9b5) is text on a green-tinted dark surface and the dark high-contrast accent.
- **Green tint**: on Home the soft circle behind a mode icon, the current tab and the Save and Share buttons use Lunad Green at 14% over the surface (16% of Bright Green in dark), not the `brand-soft` token (#e3f1ec), which other screens use.

### Secondary
- **Stop Amber** (`accent`, #ffb81c): "your stop" (the get-off dot on the trip line and timeline, and the dot in the mark), the Recommended tag, and mapped stop pins.
- **Amber Ink** (`accent-ink`, #6b4a00) on **Amber Wash** (`accent-soft`, #fff3d6): caution chips and notes such as "Unverified route" and peak-hour warnings. In dark, the text is Stop Amber on a 14% amber tint.
- **Amber Line** (`accent-line`, #a86f00): amber drawn as a thin stroke on a light surface (stop rings, dashed badge outlines). It is 4.25:1 on white and 3.7:1 on the map land.

### Tertiary
- **Destination Red** (`danger`, #c73a2f): the destination pin, closures, errors. **Red Ink** (`danger-ink`, #9e2a21) on **Red Wash** (`danger-soft`, #fce6e3) for error cards; **Soft Red** (`danger-bright`, #ff8a7a) on dark.

### Neutral
- **Ink** (`ink`, #17211d): primary text. **Ink 2** (`ink-2`, #4a5651): secondary text and idle tabs. **Ink 3** (`ink-3`, #5c6964): tertiary text, the city outline, the switch's off track.
- **Surface** (`surface`, #ffffff): sheets, cards, everything that floats. **Fill** (`fill`, #ecefed): the trip-ends card, secondary buttons, neutral tags. **Canvas** (`canvas`, #f5f7f6): page background behind non-map screens. **Border** (`border`, #d5dbd8).
- **Hairline**: separators are Ink at 10% and card rings Ink at 16% (Night Ink at 10% and 12% in dark), mixed from the tokens, not separate colours.
- **Map land** (`map-land`, #f2efe9): the map's ground when tiles are off or loading; in dark it takes `night-raised`.
- **Night set** (`night` #0e1512, `night-surface` #17201c, `night-raised` #1f2a25, `night-border` #2c3832, `night-ink` #f1f5f3, `night-ink-2` #a7b4ae, `night-ink-3` #8a9790): the dark theme's canvas, sheet, fill, border and text.
- **Deep set** (`deep` #0f2e25, `deep-2` #0a211a, `deep-raised` #17463a): dark brand surfaces, used by the admin sidebar and the dark landing sections, not by the commuter app's chrome.

### Mode palette (data, not brand)
The `mode-*` colours are a tested data palette: each line colour meets 3:1 against its casing and the map, and 5:1 against the legend sheet. The light values are in the frontmatter; the dark values (used when the theme is dark and no tiles are drawn) and the line patterns live in `src/domain/modes/palette.ts`, mirrored as `--pn-mode-*` in `src/ui/modes/modes.css`. Walking is dotted Ink. A mode is always shown with an icon and a text label as well as its colour.

### Named Rules
**The Dark Text On Amber Rule.** Stop Amber never carries white text. Text on amber is Ink; text on the amber wash is Amber Ink.

**The Amber Line Rule.** Amber as a thin stroke or outline on a light surface uses Amber Line, never Stop Amber. Fills stay Stop Amber, and dark surfaces use Stop Amber for both.

**The Data Colour Rule.** Mode colours are data. They are never recoloured to brand green, never used for chrome, and the trip line keeps each mode's own colour so the list and the map key to each other.

**The Neutral Outline Rule.** The city outline is a neutral hairline (Ink 3), never brand green.

## Typography

**Display Font:** none. No display face is used in the app.
**Body Font:** one stack for everything: `-apple-system, "SF Pro Text", Geist, system-ui, sans-serif`, set on `body` in `src/app/globals.css`. Apple devices render San Francisco; Android and desktop render Geist, which is loaded in `src/app/layout.tsx`.
**Label/Mono Font:** Geist Mono, for codes on the detail screens only.

**Character:** A plain interface sans at a small number of sizes, with weight doing the ranking. Numbers are tabular wherever times, fares and distances line up.

The typeface is unchanged from before the rebrand and is recorded as found, not as a decision. The wordmark "lunad" is set in Geist at weight 800 with -0.04em tracking, lowercase.

### Hierarchy
- **Headline** (700, 24px, 1.2, -0.015em): the trip detail title. One per screen.
- **Title large** (700, 22px, 28px line, -0.015em): the sheet heading ("Trip options").
- **Title** (700, 17px, 1.3): an option card's title; card and dialog headings.
- **Body large** (600, 17px, 1.35): the values a rider came for: place names in the trip-ends card, time and fare in the trip detail header, primary button labels. Placeholder text is the same size at weight 400 in Ink 2.
- **Body** (400 or 600, 15px, 1.45): explanatory text, status cards, time and fare on an option card (600), secondary buttons and text links (600).
- **Label** (600, 13px): chips over the map, section labels, the accuracy pill.
- **Caption** (400, 13px, 1.4): one line of boarding guidance, transfers, footnotes, in Ink 2.
- **Tag** (700 or 600, 12px, 16px line): tags and chips on cards, and tab labels (600, 14px line).

### Named Rules
**The 13 Pixel Floor Rule.** Running text is never under 13 px, and tags and tab labels never under 12 px. The single exception is the map attribution strip at 10 px.

**The Fixed Position Rule.** On an option card, time and fare always sit in the same place, as the last two lines under a hairline, so the eye compares down a column. Do not move them per card.

## Layout

The map fills the screen and the chrome is positioned over it. Floating elements sit 12 px from the side edges (search bar, chips row, tab bar) and controls 16 px from the right. Sheet content has a 16 px gutter. Safe-area insets are added to the top chrome, the tab bar and sheet footers.

The bottom sheet has three detents (peek, half, full) and moves by transform only. At peek it shows up to three fixed-height option rows (56 px) and a "Show more options" button; the rest is inert. At full, the option cards list with a 10 px gap and the toggle becomes a quiet text button at the right of the heading. Vertical rhythm inside the sheet is 14 px between blocks, 12 px inside a card between columns, 6 px between chips.

An option card is one button on a three-column grid: a 40 px icon column, the text column, and a tag column. The icon column is constant, so titles, guidance lines, times and fares share a left edge across cards.

Responsive behaviour is driven by height and by text size, since the app is phone-first:
- Short screens (`max-height: 480px`: landscape, heavy zoom): the peek shows one row, the sheet footer moves into the flow, and the tab bar drops its labels to become a 44 px icon bar.
- Narrow cards (container under 21em: a 320 px phone or 200% text): the tag moves to its own row above the title.
- Long labels are cut with an ellipsis where the row height is budgeted (peek rows, tab labels) and wrap everywhere else. Filipino and Bikol lengths are part of the budget.

Interactive targets are at least 48 px. Where the visible shape is smaller (a 36 px chip, a 44 px round button, a 4 px grab handle), a pseudo-element extends the hit area to 48 px.

## Elevation & Depth

Hybrid, with one rule deciding which is used. What floats over the map takes a soft shadow. What sits inside a sheet takes a hairline. An element never takes both. In the dark theme a shadow does not show against a dark map, so floating elements take a hairline ring as well and there are no shadows at all.

### Shadow Vocabulary
- **Float** (`--pn-elev`: `0 1px 2px` Ink at 10%, plus `0 4px 14px -2px` Ink at 14%): the search bar, the accuracy pill, the tab bar, the map controls, the legend button. Dark: `0 0 0 1px` Night Ink at 16%.
- **Float small** (`--pn-elev-sm`: `0 1px 3px` Ink at 14%): category chips over the map. Dark: the same 1 px ring.
- **Sheet edge** (`--pn-elev-sheet`: `0 -2px 16px` Ink at 14%): the top edge of the bottom sheet and the pick panel. Dark: a 1 px top line.
- **Hairline ring** (`1px` Ink at 16%; Night Ink at 12% in dark): option cards, peek rows, the swap button, outlined chips.
- **Separator** (`1px` Ink at 10%): dividers inside cards and lists, and the sheet footer's top edge.

### Named Rules
**The Shadow Or Hairline Rule.** Over the map: shadow. Inside a sheet: hairline. Never both on one element, and in dark: hairline only.

**The Solid Surface Rule.** Home's chrome is opaque. There is no blur, glass or translucency over the map; the one translucent element is the attribution strip.

## Shapes

Controls are pills and containers are softly rounded. Anything a rider taps as a single action is fully round (999px): buttons, chips, tags, the search bar, map controls, the swap button, mode-icon circles. Containers step down by role: 16 px for the bottom sheet's top corners and the tab bar, 14 px for cards and status blocks, 12 px for peek rows and small notices, 10 px for insets such as the current tab and tinted boxes inside a card, 8 px for the segmented control's thumb.

Selection is a 2 px green border replacing the 1 px hairline, with the padding reduced by 1 px so nothing shifts. Emphasis is never a coloured stripe on one side of a card; Home uses a soft tint with a leading icon instead.

Dashes carry meaning: a dashed outline means "no value to give" (an unknown fare) or a provisional state (trial, historical), and a dotted line means walking. Do not use dashes decoratively.

Icons are line icons at a 2 px stroke in the current text colour. Pins on the map are circles with a white ring: green for the start, red for the destination, amber for the rider's stop.

**The mark** is fixed: a rounded square tile (corner radius 22 on a 96 grid) in Lunad Green with a white L drawn as a route (a 12-wide round-capped stroke with one turn), a small start node at the top of the L and an amber dot for the stop. Under 24 px the start node is dropped. On dark surfaces the tile is Bright Green and the line is Night Green ink. It is always drawn on its tile. The geometry lives in `src/ui/brand/lunad-mark.tsx` and is repeated in `src/app/icon.svg`, `src/app/apple-icon.png`, `src/app/favicon.ico` and `public/icons/`. The logo is "Lunad" alone; Naga is not part of the lockup.

## Components

Familiar and unremarkable on purpose: each one should look like its counterpart in a mainstream map app.

### Buttons
- **Shape:** full pill (999px), full width inside a sheet.
- **Primary:** Lunad Green with white text, 50 px tall, 17 px at weight 600 (52 px minimum for "Start trip"). In dark: Bright Green with Night Green ink. One per sheet, in the sheet footer or at the end of the content.
- **Secondary:** Fill background, Ink text, 48 px tall, 15 px at weight 600. On tinted status cards the secondary action is a white pill with a hairline ring and green text.
- **Soft action** (Save, Share): green tint with Deep Green text, 48 px, icon plus label; when on, it becomes the primary fill.
- **Text button:** green, 15 px at weight 600, no background, 48 px tall target.
- **Press / Focus / Disabled:** press scales to 0.97 over 120 ms (0.98 for cards and chips). Focus is a 3 px outline in the accent colour at a 2 px offset. Disabled is 40% opacity and stays focusable with `aria-disabled`.

### Chips and tags
- **Category chip (over the map):** white pill, 36 px tall, 15 px at weight 600, float-small shadow. A saved place's chip leads with a green icon.
- **Recommended tag:** solid Stop Amber with Ink text, 12 px at weight 700, on the first option only.
- **Neutral tag** ("Least walking"): Fill with Ink 2 text.
- **Caution chip** ("Unverified route"): Amber Wash with Amber Ink. One per card.
- **Info chip** (which side of the road, via): green tint with Deep Green text, or a hairline outline for "via".
- **Fare chip:** hairline outline for an estimate; dashed outline in Ink 3 when there is no fare to give. On a card it is shown as plain text.

### Cards / Containers
- **Option card:** white, 14 px corners, 1 px hairline ring, 14 px padding, no shadow. A 40 px green-tint circle holds the mode icon. Title, then one line of boarding guidance, then chips, a hairline, then time and fare. The selected or recommended card takes the 2 px green border.
- **Peek row:** the same card at a fixed 56 px height with a 32 px icon circle and three 16 px lines, cut with an ellipsis.
- **Trip-ends card:** Fill background, 14 px corners, two 56 px rows split by an inset separator. The start row leads with a green dot in a green-tint circle and the destination row with a red pin in a red-wash circle. A round white swap button with a hairline ring sits at the right.
- **Status and notice blocks:** 14 px corners, tinted by tone (Fill for neutral, green tint for ok, Amber Wash for caution, Red Wash for error), each with a leading icon and text that carries the meaning.
- **Bottom sheet:** white, 16 px top corners, sheet-edge shadow, a 36 by 4 px grab handle inside a 48 px target. A pinned footer with a top separator holds the primary action.

### Inputs / Fields
- **Search bar:** a white pill 52 px tall with the float shadow, the L mark at the left, "Where to?" in Ink 2 at 17 px and a search icon at the right. It is a link to the Search screen, not an inline field.
- **Trip-ends rows:** each row is a button that opens Search. The focused row takes a 2 px inset green ring.
- **Switch:** 51 by 31 px track, green when on, Ink 3 when off, a white 27 px knob.
- **Segmented control:** a Fill track with a white 8 px-cornered thumb that slides by transform.

### Navigation
- **Tab bar:** a white bar with 16 px corners floating 12 px from the sides and at least 24 px from the bottom, with the float shadow. Five tabs: Map, Explore, Saved, Community, More. Each is an icon over a 12 px label in Ink 2. The current tab takes a green-tint background with 10 px corners, green icon and label, and weight 700. It hides while a trip is being planned, during trip detail, and in guidance.
- **Back:** a 48 px round Fill button with a chevron at the top left of the trip detail header, with a "Sources" text link opposite.

### Map chrome
- **Controls:** 48 px white circles and capsules at the right edge (layers, zoom, locate) with the float shadow. The locate icon is green.
- **Trip line:** drawn in the mode's colour with a white casing, direction chevrons along it and a small mode label ("Jeep", "Walk") as an outlined pill. Walking is dotted.
- **Trip maps show only the route.** Stop pins are a layer the rider can switch on for the plain Home map and while placing a pin; they are never drawn on a trip's map (owner ruling 2026-10-17). The start pin, the destination pin and the amber get-off dot are the only markers on a trip.
- **Outside the city** is dimmed (28% in light, 45% in dark) behind a neutral outline.

### Motion
CSS only, with tokens in `src/app/globals.css`: 120 ms for press feedback, 220 ms for fades, chevrons and chips, 360 ms for sheet snaps and list entrances. The standard curve is an ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`); the sheet's detent curve is `cubic-bezier(0.32, 0.72, 0, 1)` with no overshoot; exits are a quicker ease-in. Lists rise 8 px and fade with a 60 ms stagger. Things that appear in place fade in. Under `prefers-reduced-motion`, durations go to zero globally and entrances become plain fades or nothing.

## Do's and Don'ts

### Do:
- **Do** read colour through the tokens: `--color-*` from `src/app/globals.css`, or the screen's `--pn-*` aliases, which already switch for dark and high contrast.
- **Do** write every dark block twice, as the stylesheets do: `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
- **Do** use Ink text on Stop Amber, and Amber Line (#a86f00) when amber is a thin stroke on a light surface.
- **Do** give anything that floats over the map the float shadow, and anything inside a sheet a hairline. In dark, hairline only.
- **Do** keep time and fare in fixed positions on every option card, and label estimates ("Est.") and unknowns in words.
- **Do** keep targets at 48 px or more, extending a smaller shape's hit area with a pseudo-element.
- **Do** animate with CSS on transform and opacity only, using the `--pn-dur*` and `--pn-ease*` tokens, and give every animation a reduced-motion branch.
- **Do** pair every colour cue with an icon or text: mode chips carry an icon and a label, caution chips carry words.
- **Do** keep the legacy internal names. Storage keys (`paranaga.*`), cache names (`paranaga-*`), the database role (`paranaga_app`) and the CSS class prefix (`pn-`) keep their old names on purpose; renaming them would lose riders' saved data or break deployments.

### Don't:
- **Don't** put white text on Stop Amber (#ffb81c), or draw Stop Amber as a thin line on a white or map surface.
- **Don't** recolour mode colours to brand green, or use them for anything that is not that mode.
- **Don't** draw the city outline, separators or card borders in brand green; green on a border means selected.
- **Don't** combine a shadow and a border on one element, or add shadows in the dark theme.
- **Don't** add blur, glass or translucent chrome over the map.
- **Don't** mark emphasis with a coloured stripe down one side of a card or list item; use a soft tint with a leading icon.
- **Don't** show stop icons on a trip's map. A trip map shows the route, the start, the destination and the get-off dot.
- **Don't** add an animation library (no `motion`, `framer-motion` or GSAP), and don't animate layout properties.
- **Don't** redraw, recolour or re-proportion the route-shaped L, and don't place it without its tile.
- **Don't** propose a more expressive visual world, a display typeface or a novelty layout for the app; the owner's standing choice is the category standard.
- **Don't** style away uncertainty: an unverified route keeps its amber chip, an unknown fare keeps its dashed outline, and neither is ever shown as a confident value.
- **Don't** treat the screens that have not been rebuilt, or the items under Known deviations, as patterns to copy.
