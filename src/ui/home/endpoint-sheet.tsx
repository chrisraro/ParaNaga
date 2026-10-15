"use client";

// The home screen's bottom sheet ("Trip planner"): Start and Destination rows, the options for
// the focused row, and whatever cards the screen passes in. Snaps follow the map design brief
// §1 (visible 214 / 444 / full); drag with the grabber, or tap / arrow-key it.

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Endpoint, EndpointWhich, EndpointsState } from "@/domain/trip/endpoints";

export type Snap = 0 | 1 | 2;

const PEEK_VISIBLE = 214;
const HALF_VISIBLE = 444;
const DRAG_SLOP = 6;
/** How far ahead (ms) a release's velocity carries the sheet before picking the nearest snap. */
const FLING_MS = 200;

const GRABBER_LABEL: Record<Snap, string> = {
  0: "Expand sheet to half",
  1: "Expand sheet to full",
  2: "Collapse sheet",
};

function offsetFor(snap: Snap, height: number): number {
  if (snap === 2) return 0;
  return Math.max(0, height - (snap === 0 ? PEEK_VISIBLE : HALF_VISIBLE));
}

export type SheetControl = {
  snap: Snap;
  setSnap: (snap: Snap) => void;
  /** Measured sheet height in px, or null before the first measure. */
  height: number | null;
  /** Live translateY while the grabber is dragged. */
  setDrag: (offset: number | null) => void;
  /** Current translateY in px, or null before the sheet is measured. */
  offset: number | null;
  /** Height of the sheet showing above the bottom edge, in px. */
  visible: number;
  dragging: boolean;
  attach: (el: HTMLElement | null) => (() => void) | undefined;
};

export function useSheet(initial: Snap = 1): SheetControl {
  const [snap, setSnap] = useState<Snap>(initial);
  const [height, setHeight] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const attach = useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const offset = height === null ? null : (drag ?? offsetFor(snap, height));
  const visible = height === null || offset === null ? HALF_VISIBLE : height - offset;
  return { snap, setSnap, height, setDrag, offset, visible, dragging: drag !== null, attach };
}

type Gesture = { id: number; startY: number; base: number; lastY: number; lastT: number; v: number; moved: boolean };

/**
 * Drag handle: pointer drag with a velocity-aware release, tap to cycle snaps, ArrowUp/Down
 * to step. touch-action: none (CSS) so the browser never scrolls instead.
 */
function SheetGrabber({ sheet }: { sheet: SheetControl }) {
  const { snap, setSnap, height, setDrag } = sheet;
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const clampOffset = (value: number, h: number) => Math.min(offsetFor(0, h), Math.max(0, value));

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (height === null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      id: e.pointerId,
      startY: e.clientY,
      base: offsetFor(snap, height),
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      moved: false,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || height === null) return;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.abs(dy) < DRAG_SLOP) return;
    g.moved = true;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.v = (e.clientY - g.lastY) / dt;
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    setDrag(clampOffset(g.base + dy, height));
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !g.moved || height === null) return;
    suppressClick.current = true;
    const projected = clampOffset(g.base + (e.clientY - g.startY), height) + g.v * FLING_MS;
    const snaps: Snap[] = [0, 1, 2];
    const nearest = snaps.reduce((best, s) =>
      Math.abs(offsetFor(s, height) - projected) < Math.abs(offsetFor(best, height) - projected) ? s : best,
    );
    setSnap(nearest);
    setDrag(null);
  };
  const onPointerCancel = () => {
    gesture.current = null;
    setDrag(null);
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSnap(((snap + 1) % 3) as Snap);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSnap(Math.min(2, snap + 1) as Snap);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSnap(Math.max(0, snap - 1) as Snap);
    }
  };

  return (
    <button
      type="button"
      className="pn-grabber"
      aria-label={GRABBER_LABEL[snap]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    />
  );
}

const PLACEHOLDER: Record<EndpointWhich, string> = { start: "Choose start", destination: "Where to?" };
const NAME: Record<EndpointWhich, string> = { start: "Start", destination: "Destination" };

function StartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="5" fill="currentColor" />
    </svg>
  );
}
function DestinationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 22s-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-7 12-7 12z" fill="currentColor" />
      <circle cx="12" cy="10" r="2.6" fill="#FFFFFF" />
    </svg>
  );
}
function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" fill="currentColor" />
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

/** DOM id of an endpoint row's main button, so the screen can move focus to it. */
export function endpointRowMainId(which: EndpointWhich): string {
  return `pn-endpoint-${which}-main`;
}

type RowProps = {
  which: EndpointWhich;
  endpoint: Endpoint | null;
  focused: boolean;
  sub?: string | undefined;
  onFocus: (which: EndpointWhich) => void;
  onClear: (which: EndpointWhich) => void;
};

function EndpointRow({ which, endpoint, focused, sub, onFocus, onClear }: RowProps) {
  return (
    <div className={focused ? "pn-endpoint pn-endpoint--focused" : "pn-endpoint"} data-testid={`endpoint-${which}`}>
      <button type="button" id={endpointRowMainId(which)} className="pn-endpoint__main" aria-pressed={focused} onClick={() => onFocus(which)}>
        <span className={`pn-endpoint__icon pn-endpoint__icon--${which}`}>
          {which === "start" ? <StartIcon /> : <DestinationIcon />}
        </span>
        <span className="pn-endpoint__text">
          <span className="sr-only">{NAME[which]}: </span>
          <span className={endpoint ? "pn-endpoint__value" : "pn-endpoint__value pn-endpoint__value--empty"}>
            {endpoint ? endpoint.label : PLACEHOLDER[which]}
          </span>
          {sub ? <span className="pn-endpoint__sub">{sub}</span> : null}
        </span>
      </button>
      {endpoint ? (
        <button type="button" className="pn-icon-btn" aria-label={`Clear ${NAME[which].toLowerCase()}`} onClick={() => onClear(which)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

type Props = {
  sheet: SheetControl;
  endpoints: EndpointsState;
  focused: EndpointWhich | null;
  /** Shown under the Start row while GPS is being asked for the start. */
  startSub?: string | undefined;
  onFocus: (which: EndpointWhich) => void;
  onClear: (which: EndpointWhich) => void;
  onSwap: () => void;
  onUseCurrentLocation: () => void;
  onChooseOnMap: (which: EndpointWhich) => void;
  /** Cards between the endpoint rows and the options (trip results, location status). */
  children?: ReactNode;
  /** Trip detail is open: the sheet shows only `children` (no endpoint rows or options). */
  detailOpen?: boolean;
  /** Below the endpoint options (the "Nearby stops" list). Hidden while trip detail is open. */
  after?: ReactNode;
};

export function EndpointSheet({
  sheet,
  endpoints,
  focused,
  startSub,
  onFocus,
  onClear,
  onSwap,
  onUseCurrentLocation,
  onChooseOnMap,
  children,
  detailOpen = false,
  after,
}: Props) {
  const { attach, snap, offset, dragging } = sheet;
  // Tapping a row at the peek snap lifts the sheet to half so its options aren't offscreen/inert.
  const onRowTap = (which: EndpointWhich) => {
    if (snap === 0) {
      sheet.setSnap(1);
      if (focused === which) return;
    }
    onFocus(which);
  };
  const style = offset === null ? undefined : { ["--pn-sheet-offset" as string]: `${offset}px` };
  return (
    <section
      ref={attach}
      aria-label="Trip planner"
      data-testid="trip-sheet"
      data-snap={snap}
      className={dragging ? "pn-sheet pn-sheet--dragging" : "pn-sheet"}
      style={style}
    >
      <SheetGrabber sheet={sheet} />
      <div className="pn-sheet__content">
        {detailOpen ? null : (
        <div className="pn-endpoints">
          <EndpointRow which="start" endpoint={endpoints.start} focused={focused === "start"} sub={startSub} onFocus={onRowTap} onClear={onClear} />
          <div className="pn-endpoints__sep" />
          <EndpointRow which="destination" endpoint={endpoints.destination} focused={focused === "destination"} onFocus={onRowTap} onClear={onClear} />
          <button
            type="button"
            className="pn-icon-btn pn-swap"
            aria-label="Swap start and destination"
            disabled={!endpoints.start && !endpoints.destination}
            onClick={onSwap}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 4v16M8 4L4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        )}

        {/* Everything below the always-visible rows. At the peek snap it sits under the screen edge,
            so it is inert (not focusable); at half, focusing something that is cut off expands the sheet. */}
        <div
          className="pn-sheet__rest"
          inert={snap === 0 && !detailOpen}
          onFocusCapture={(e) => {
            // Trip detail stays operable at the peek snap (its header is visible there).
            if (snap !== 2 && e.target.getBoundingClientRect().bottom > window.innerHeight) sheet.setSnap(snap === 0 ? 1 : 2);
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
          </div>
        ) : null}
        {detailOpen ? null : after}
        </div>
      </div>
    </section>
  );
}
