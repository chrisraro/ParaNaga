# Engine-specific fixes (WebKit iPhone 14 390x664, Firefox 390x844 touch)

1. Focus return (WebKit): new src/ui/kit/opener.ts. captureOpener() = focused element, else the last pressed control; a focusable ancestor that Safari focused instead (the map region) is ignored. Used by confirm-dialog, save-place-dialog, layers-sheet, eta-basis-sheet and app-frame openPanel. Unit: tests/unit/opener.test.ts.
2. Legend Escape: document-level keydown while the legend is open (preventDefault so the panel underneath does not also go back).
3. Layers/ETA Tab trap: cycleTab() in opener.ts moves focus itself, independent of browser tab order and of the last element receiving Tab; the layers sheet handles it on window.
4. Zoom button under the sheet at 664 px: the half snap is capped at viewport - 229 (MAP_CONTROLS_CLEAR in endpoint-sheet.tsx); unchanged from 673 px up. Unit tests updated.
5. Focus under footer: WebKit fires focus before scrolling the control into view, so the focus-lift handler (endpoint-sheet onFocusCapture) measured the pre-scroll position and lifted the sheet to full; it now measures one frame later. scroll-padding already existed.
6. Firefox Tab stuck: not a product bug. "I boarded Loop A" is the last tabbable element in the document; Playwright Firefox has no browser toolbar, so Tab leaves focus there instead of wrapping. The test helper now does the wrap (blur + Tab).
7. Unclassified: map-lines 493 and 348 still fail on WebKit at 664 px (493: fit leaves pins 15 px above the half sheet, test wants 24; zoom steps are whole levels). 388, 119, 366 pass when run alone and time out under load. trip 509 toBeFocused after a click: Safari never focuses the toggle on click (test assumption).

## Review fixes (PR #21 review)
- I1 cycleTab: candidates filtered to non-[inert]/[hidden], checkVisibility(); after focus() it checks activeElement moved, else tries the next entry; ignores ctrl/alt/meta and defaultPrevented events. Tests: tests/unit/opener-dom.test.ts (hidden next entry, refuses focus, single focusable, Shift+Tab wrap, chords, click listener).
- I2 legend Escape: returns on defaultPrevented or when a modal ([aria-modal], dialog[open]) is open; focuses the legend button only if focus is on body or inside the legend. Layers and ETA sheets return on defaultPrevented and preventDefault when they close, so one Escape closes one layer. Tests: tests/unit/escape-layers.test.tsx.
- I3 half snap floored at peek + clearance; ordering test (tiny <= peek <= half <= full, 440-900 px, 640, 664, 568, 360, 300; four peek/clearance pairs), red before the fix at 456 px.
- map-lines 493: NOT caused by the 229 px cap. With the cap removed it fails identically on WebKit (pin bottom 214 vs half-sheet top 220). Chromium at 390x664 passes (fit picks zoom 15; WebKit's emulated drag places the pins further apart, so the whole-level fit lands on 14 and the pins sit 15 px above the sheet). It also passes intermittently on WebKit. Left as a WebKit geometry/flake item.
- Focus-lift rAF: the sheet scroller (.pn-sheet__content) has computed scroll-behavior auto (the smooth rule is on html and is not inherited), so the scroll into view is instant and one frame is enough.
