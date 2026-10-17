"use client";

// The home screen's bottom sheet ("Trip planner"): Start and Destination rows, the options for
// the focused row ("Save this place" too once that end is set), and whatever cards the screen
// passes in. The sheet engine (detents, drag, hand-off) is app-shell/bottom-sheet.tsx.

import Link from "next/link";
import { ViewTransition, useEffect, useState, type ReactNode } from "react";
import { savePlacePrefill } from "@/domain/saved/saved";
import type { Endpoint, EndpointWhich, EndpointsState } from "@/domain/trip/endpoints";
import { SheetGrabber, TINY_SHEET, sheetGrows, useHeaderDrag, useScrollHandoff, type SheetControl } from "@/ui/app-shell/bottom-sheet";
import { SheetFooterContext } from "@/ui/app-shell/sheet-bar";
import { SavePlaceButton } from "@/ui/saved/save-place-button";
import { TripEndsCard, endpointRowMainId } from "./trip-ends-card";

export { endpointRowMainId };

function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" fill="currentColor" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="9.8" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** "Save this place" for a set trip end (a pin or GPS fix is saved as "Pinned location"). */
function SaveEnd({ endpoint }: { endpoint: Endpoint }) {
  return (
    <SavePlaceButton
      variant="option"
      label={savePlacePrefill(endpoint)}
      point={endpoint.point}
      source={endpoint.place ?? "pinned"}
      testId="endpoint-save-place"
    />
  );
}

type Props = {
  sheet: SheetControl;
  endpoints: EndpointsState;
  focused: EndpointWhich | null;
  /** Shown under the Start row (GPS being asked for the start, or the age of its GPS fix). */
  startSub?: string | undefined;
  /** Shown under the Destination row (the age of its GPS fix, after a swap). */
  destinationSub?: string | undefined;
  onFocus: (which: EndpointWhich) => void;
  onClear: (which: EndpointWhich) => void;
  onSwap: () => void;
  onUseCurrentLocation: () => void;
  onChooseOnMap: (which: EndpointWhich) => void;
  /** Cards between the endpoint rows and the options (trip results, location status). */
  children?: ReactNode;
  /** Trip detail is open: the sheet shows only `children` (no endpoint rows or options). */
  detailOpen?: boolean;
  /** Always operable, even at the peek snap (outside the inert part): the best-option summary and its toggle. */
  summary?: ReactNode;
};

export function EndpointSheet({
  sheet,
  endpoints,
  focused,
  startSub,
  destinationSub,
  onFocus,
  onClear,
  onSwap,
  onUseCurrentLocation,
  onChooseOnMap,
  children,
  detailOpen = false,
  summary,
}: Props) {
  const { attach, snap, offset } = sheet;
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  useScrollHandoff(sheet, list);
  useHeaderDrag(sheet, header ?? list, header ? undefined : '[data-testid="trip-detail-header"], [data-testid="guidance-header"]');
  // Tiny peek: only the grabber shows; the rows and the footer lie under the tab bar.
  const tinyPeek = snap === 0 && sheet.height !== null && sheet.height < TINY_SHEET;
  // Growing: the padding that stands for the off-screen part shrinks with the lift, not 360 ms
  // later (the content would leave a blank strip under it while the sheet slides up).
  const [seenOffset, setSeenOffset] = useState(offset);
  const [grow, setGrow] = useState(false);
  if (offset !== seenOffset) {
    setSeenOffset(offset);
    setGrow(sheetGrows(seenOffset, offset));
  }
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  // The scrolling content keeps its last rows and focused controls clear of the footer.
  useEffect(() => {
    if (!footer) return undefined;
    const measure = () => setFooterHeight(footer.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [footer]);
  // Tapping a row at the peek snap lifts the sheet to half so its options aren't offscreen/inert.
  const onRowTap = (which: EndpointWhich) => {
    if (snap === 0) {
      sheet.setSnap(1);
      if (focused === which) return;
    }
    onFocus(which);
  };
  const style = {
    ...(offset === null ? {} : { ["--pn-sheet-offset" as string]: `${offset}px` }),
    ["--pn-sheet-clearance" as string]: `${sheet.clearance}px`,
    // The tab bar's height already includes the bottom safe area; without it the sticky bar adds its own.
    ["--pn-sheet-safe" as string]: sheet.clearance > 0 ? "0px" : "env(safe-area-inset-bottom, 0px)",
    ["--pn-bar-h" as string]: `${footerHeight}px`,
  };
  return (
    <section
      ref={attach}
      aria-label="Trip planner"
      data-testid="trip-sheet"
      data-snap={snap}
      data-grow={grow ? "" : undefined}
      className="pn-sheet"
      style={style}
    >
      <SheetGrabber sheet={sheet} />
      <SheetFooterContext.Provider value={footer}>
      <div ref={setList} className="pn-sheet__content" inert={tinyPeek}>
        {detailOpen ? null : (
          <div ref={setHeader} className="pn-sheet__head" data-testid="sheet-header">
            <ViewTransition name="pn-trip-ends">
              <TripEndsCard
                endpoints={endpoints}
                focused={focused}
                startSub={startSub}
                destinationSub={destinationSub}
                onFocus={onRowTap}
                onClear={onClear}
                onSwap={onSwap}
              />
            </ViewTransition>
            {summary}
          </div>
        )}

        {/* Everything below the always-visible rows. At the peek snap it sits under the screen edge
            (and the tab bar), so it is inert (not focusable); at half, focusing something that is
            cut off or under the tab bar expands the sheet. */}
        <div
          className="pn-sheet__rest"
          inert={snap === 0 && !detailOpen}
          onFocusCapture={(e) => {
            // Trip detail stays operable at the peek snap (its header is visible there). A tap in
            // detail or guidance never lifts the sheet to full (that would cover the map, its lines
            // and the legend: full is the rider's choice). The content scrolls inside the visible
            // sheet, so this only catches a control left under the tab bar (or, at peek, below the
            // edge), and keyboard focus then lifts the sheet. The footer is always inside the
            // visible sheet: focus there never lifts it.
            // Measured a frame later: Safari fires focus before it scrolls the control into view,
            // so a control that the scroll is about to bring on screen must not lift the sheet.
            const target = e.target;
            if (snap === 2 || target.closest(".pn-sheet-footer")) return;
            requestAnimationFrame(() => {
              if (!target.isConnected || document.activeElement !== target) return;
              if (target.getBoundingClientRect().bottom > window.innerHeight - sheet.clearance) {
                if (snap === 0) sheet.setSnap(1);
                else if (!detailOpen || target.matches(":focus-visible")) sheet.setSnap(2);
              }
            });
          }}
        >
        {children}

        {focused && !detailOpen ? (
          <div role="group" aria-labelledby="pn-options-title">
            <h2 id="pn-options-title" className="pn-section-title">
              {focused === "start" ? "Set start" : "Set destination"}
            </h2>
            {focused === "start" ? (
              <button type="button" className="pn-option" onClick={onUseCurrentLocation}>
                <span className="pn-option__icon">
                  <LocateIcon />
                </span>
                Use current location
              </button>
            ) : null}
            <button type="button" className="pn-option" onClick={() => onChooseOnMap(focused)}>
              <span className="pn-option__icon">
                <PinIcon />
              </span>
              Choose on map
            </button>
            <Link href={`/app/search?for=${focused}`} className="pn-option" data-testid="endpoint-search">
              <span className="pn-option__icon">
                <SearchIcon />
              </span>
              Search places and stops
            </Link>
            {endpoints[focused] ? <SaveEnd endpoint={endpoints[focused]} /> : null}
          </div>
        ) : null}
        </div>
        {/* Last in the scroller but positioned on the sheet (it is not scrolled); on short screens
            (home-screen.css) it is in flow at the end of the content instead. */}
        <div ref={setFooter} className="pn-sheet-footer" role="group" aria-label="Actions" />
      </div>
      </SheetFooterContext.Provider>
    </section>
  );
}
