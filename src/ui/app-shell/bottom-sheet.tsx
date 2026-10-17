"use client";

// The bottom sheet's engine, shared by every screen that has one: detents (peek / half / full),
// the measured height, and the drag handle. The drag itself lives in sheet-drag.ts (plain JS that
// writes to the element, no React render per pointer move); this file wires it to React: the
// handle (pointer drag, tap to cycle, ArrowUp / ArrowDown) and the scroll hand-off (a list at its
// top continues a downward drag as a sheet drag). Snaps follow the map design brief §1
// (visible 214 / 444 / full).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { prefersReducedMotion } from "@/client/map/use-reduced-motion";
import { createSheetDrag, type SheetDrag } from "./sheet-drag";

export type Snap = 0 | 1 | 2;

export const PEEK_VISIBLE = 214;
/** Peek while trip options are listed: rows + best-option summary + "All options" (two 44 px rows). */
export const PEEK_OPTIONS_VISIBLE = 276;
/** One staleness line (offline plan, changed since saved) under the best option at the peek snap. */
export const PEEK_NOTE_VISIBLE = 24;
export const HALF_VISIBLE = 444;
/**
 * Short or zoomed screens (landscape, 400 % zoom): peek and half never take more than this share
 * of the sheet's height, so a strip of map always stays above the sheet (full still covers it).
 */
export const MAP_MIN_SHARE = 0.25;
/**
 * The map's control stack (layers, locate, zoom) ends 221 px from the screen top (naga-map.css);
 * half leaves 8 px more, so on a short phone the sheet never covers a control (WCAG 2.5.8 target
 * size). The sheet starts 26 px down (--pn-sheet-top), so this is 229 - 26 in sheet height.
 */
export const MAP_CONTROLS_CLEAR = 203;
/**
 * Below this sheet height (a viewport of about 300 px: 400 % zoom, a small phone on its side) the
 * peek is the grabber alone over the tab bar (the content is inert there), and the tab bar steps
 * aside at half and full so the content keeps its room.
 */
export const TINY_SHEET = 280;
/** The grabber's own height: all the tiny peek shows above the tab bar. */
const GRABBER_VISIBLE = 44;

const GRABBER_LABEL: Record<Snap, string> = {
  0: "Expand sheet to half",
  1: "Expand sheet to full",
  2: "Collapse sheet",
};

/**
 * `clearance`: what the tab bar covers at the bottom of the screen. The peek snap rises by it so
 * the start and destination rows stay above the tab bar; half and full keep their height (their
 * content scrolls, with room at the end for the tab bar), so the map keeps its view.
 */
export function offsetFor(snap: Snap, height: number, clearance = 0, peek = PEEK_VISIBLE): number {
  if (snap === 2) return 0;
  if (snap === 0 && height < TINY_SHEET) return Math.max(0, height - GRABBER_VISIBLE - clearance);
  // Below ~417 px the controls cannot be cleared without a sheet shorter than its peek: those keep half.
  // Never below the peek (options peek + tab bar can exceed the cap on 440-600 px screens).
  const half = height - MAP_CONTROLS_CLEAR >= PEEK_VISIBLE ? Math.max(Math.min(HALF_VISIBLE, height - MAP_CONTROLS_CLEAR), peek + clearance) : HALF_VISIBLE;
  const visible = Math.min(snap === 0 ? peek + clearance : half, height * (1 - MAP_MIN_SHARE));
  return Math.max(0, Math.round(height - visible));
}

/**
 * How far above the screen bottom the map ends: just under the plain peek sheet's top (minus its
 * 28 px corner), so the map centre is never behind the sheet. Shrinks with the clamped peek.
 */
export function mapInsetFor(height: number | null): number {
  const peek = height === null ? PEEK_VISIBLE : Math.min(PEEK_VISIBLE, height * (1 - MAP_MIN_SHARE));
  return Math.max(0, Math.round(peek - 28));
}

/** The sheet is getting taller on screen (its offset shrinks): its bottom padding must follow at once. */
export function sheetGrows(prev: number | null, next: number | null): boolean {
  return prev !== null && next !== null && next < prev;
}

/**
 * Called on every drag frame (`dragging`) and once when a settle starts (not `dragging`) with the
 * visible sheet height and the sheet height, in px.
 */
export type SheetFrame = (visible: number, height: number, dragging: boolean) => void;

export type SheetControl = {
  snap: Snap;
  setSnap: (snap: Snap) => void;
  /** Measured sheet height in px, or null before the first measure. */
  height: number | null;
  /** Current translateY in px at rest, or null before the sheet is measured. */
  offset: number | null;
  /** Height of the sheet showing above the bottom edge at rest, in px. */
  visible: number;
  attach: (el: HTMLElement | null) => (() => void) | undefined;
  /** Height the tab bar covers at the bottom of the sheet, in px (0 without a tab bar). */
  clearance: number;
  /** Visible height at the peek snap, in px (taller while trip options are listed). */
  peek: number;
  /** The drag controller (plain JS): pointer and touch handlers feed it, it writes to the element. */
  drag: SheetDrag;
};

/**
 * `onFrame`: map chrome that follows the sheet (it is written to directly, like the sheet, so a
 * drag renders nothing in React). Called during a drag and once at the start of a settle.
 */
export function useSheet(initial: Snap = 1, clearance = 0, peek = PEEK_VISIBLE, onFrame?: SheetFrame): SheetControl {
  const [snap, setSnap] = useState<Snap>(initial);
  const [height, setHeight] = useState<number | null>(null);
  const element = useRef<HTMLElement | null>(null);
  const latest = useRef({ snap, height, clearance, peek, onFrame });
  useLayoutEffect(() => {
    latest.current = { snap, height, clearance, peek, onFrame };
  });

  // The controller is created once; its host callbacks read the refs only when a gesture runs, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [drag] = useState(() =>
    createSheetDrag({
      el: () => element.current,
      height: () => latest.current.height,
      offsets: () => {
        const { height: h, clearance: c, peek: p } = latest.current;
        return h === null ? null : ([offsetFor(0, h, c, p), offsetFor(1, h, c, p), offsetFor(2, h, c, p)] as const);
      },
      snap: () => latest.current.snap,
      setSnap: (s) => setSnap(s),
      onFrame: () => latest.current.onFrame,
      reducedMotion: prefersReducedMotion,
    }),
  );

  const attach = useCallback((el: HTMLElement | null) => {
    element.current = el;
    if (!el) return undefined;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => {
      observer.disconnect();
      drag.dispose();
      if (element.current === el) element.current = null;
    };
  }, [drag]);

  const offset = height === null ? null : offsetFor(snap, height, clearance, peek);
  const visible = height === null || offset === null ? HALF_VISIBLE : height - offset;
  return { snap, setSnap, height, offset, visible, attach, clearance, peek, drag };
}

/**
 * Drag handle: pointer drag with a velocity-aware release, tap to cycle snaps, ArrowUp/Down
 * to step. touch-action: none (CSS) so the browser never scrolls instead.
 */
export function SheetGrabber({ sheet }: { sheet: SheetControl }) {
  const { snap, setSnap, drag } = sheet;
  const pointer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    // A second finger while a drag is live is ignored; the first one keeps the gesture.
    if (pointer.current !== null) return;
    suppressClick.current = false;
    if (sheet.height === null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = e.pointerId;
    drag.start(e.clientY, e.timeStamp);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return;
    drag.move(e.clientY, e.timeStamp);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    suppressClick.current = drag.end(e.clientY, e.timeStamp);
  };
  const onPointerCancel = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    drag.cancel();
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
      onLostPointerCapture={onPointerCancel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * Scroll hand-off: at full, a touch that pulls the list down while it is already at its top
 * becomes a sheet drag (touch events, not pointer events: the first cancelable touchmove has to be
 * stopped before the browser starts its own pan, which would cancel the pointer). Anything else
 * scrolls the list as usual. Mouse and pen never hand off.
 */
export function useScrollHandoff(sheet: SheetControl, list: HTMLElement | null) {
  const { drag } = sheet;
  const snapRef = useRef(sheet.snap);
  useLayoutEffect(() => {
    snapRef.current = sheet.snap;
  });
  useEffect(() => {
    if (!list) return undefined;
    let startY = 0;
    let tracking = false;
    let engaged = false;
    const onStart = (e: TouchEvent) => {
      // A second finger while the hand-off drag is live ends it: settle back to the detent it left.
      if (engaged) drag.cancel();
      tracking = e.touches.length === 1 && snapRef.current === 2 && list.scrollTop <= 0;
      engaged = false;
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (!tracking || y === undefined) return;
      if (!engaged) {
        const dy = y - startY;
        if (dy < -6 || list.scrollTop > 0) {
          tracking = false;
          return;
        }
        if (dy <= 6) return;
        // Not cancelable: the browser's own pan already began; let the list scroll, never move both.
        if (!e.cancelable) {
          tracking = false;
          return;
        }
        engaged = true;
        drag.start(startY, e.timeStamp);
      }
      if (e.cancelable) e.preventDefault();
      drag.move(y, e.timeStamp);
    };
    const onEnd = (e: TouchEvent) => {
      const was = engaged;
      tracking = false;
      engaged = false;
      if (!was) return;
      const y = e.changedTouches[0]?.clientY ?? startY;
      if (e.type === "touchcancel") drag.cancel();
      else drag.end(y, e.timeStamp);
    };
    list.addEventListener("touchstart", onStart, { passive: true });
    list.addEventListener("touchmove", onMove, { passive: false });
    list.addEventListener("touchend", onEnd);
    list.addEventListener("touchcancel", onEnd);
    return () => {
      if (engaged) drag.cancel();
      list.removeEventListener("touchstart", onStart);
      list.removeEventListener("touchmove", onMove);
      list.removeEventListener("touchend", onEnd);
      list.removeEventListener("touchcancel", onEnd);
    };
  }, [list, drag]);
}

/**
 * Header drag surface: dragging anywhere on the sheet's header area (past the 6 px slop) captures
 * the pointer and moves the sheet through `sheet.drag`, while a plain tap on a control inside the
 * header never captures the pointer and lets its click fire normally.
 */
export function useHeaderDrag(sheet: SheetControl, header: HTMLElement | null) {
  const { drag } = sheet;
  const heightRef = useRef(sheet.height);
  useLayoutEffect(() => {
    heightRef.current = sheet.height;
  });
  useEffect(() => {
    if (!header) return undefined;
    let pointer: number | null = null;
    let captured = false;
    const onDown = (e: globalThis.PointerEvent) => {
      if (pointer !== null || heightRef.current === null || (e.pointerType === "mouse" && e.button !== 0)) return;
      pointer = e.pointerId;
      captured = false;
      drag.start(e.clientY, e.timeStamp);
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (pointer !== e.pointerId) return;
      const moved = drag.move(e.clientY, e.timeStamp);
      if (moved && !captured) {
        captured = true;
        try {
          header.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events in tests may not register a pointerId.
        }
      }
    };
    const onUp = (e: globalThis.PointerEvent) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      const wasDrag = drag.end(e.clientY, e.timeStamp);
      captured = false;
      if (wasDrag) {
        header.addEventListener(
          "click",
          (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
          },
          { capture: true, once: true },
        );
      }
    };
    const onCancel = (e: globalThis.PointerEvent) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      captured = false;
      drag.cancel();
    };
    header.addEventListener("pointerdown", onDown);
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onCancel);
    header.addEventListener("lostpointercapture", onCancel);
    return () => {
      if (captured) drag.cancel();
      header.removeEventListener("pointerdown", onDown);
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onCancel);
      header.removeEventListener("lostpointercapture", onCancel);
    };
  }, [header, drag]);
}

