// The bottom sheet's drag controller: plain JS, no React. A drag writes straight to the element
// (a transform in one rAF per frame, nothing in React state), so a pointer move never re-renders
// the screen. Release picks the detent from position plus velocity and settles with the Web
// Animations API (180-360 ms, instant under reduced motion). React hears about the result once
// (`setSnap`), on release.
//
// While a drag or a settle runs the sheet is marked pn-sheet--dragging / pn-sheet--settling
// (home-screen.css switches its CSS transitions off), and its bottom padding is zero: the
// off-screen part of the sheet is then just more content area, so a transform is the only thing
// that changes per frame. The finish writes `--pn-sheet-offset` (padding, footer and the React
// styles all read it) and removes the inline overrides.

import type { Snap } from "./bottom-sheet";
import { nearestDetent, settleDuration, smoothVelocity, stretchedOffset } from "./sheet-physics";

const SLOP = 6;
/** A release this long after the last move was a pause, not a fling. */
const STALE_MS = 100;
const FALLBACK_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export type DragHost = {
  el: () => HTMLElement | null;
  /** Sheet height in px, or null before it is measured. */
  height: () => number | null;
  /** translateY of the peek, half and full detents for the current height. */
  offsets: () => readonly [number, number, number] | null;
  snap: () => Snap;
  setSnap: (snap: Snap) => void;
  /** Called with the visible sheet height on every frame (dragging) and once at the start of a settle (map chrome follows it). */
  onFrame: () => ((visible: number, height: number, dragging: boolean) => void) | undefined;
  reducedMotion: () => boolean;
};

export type SheetDrag = {
  /** A finger or button went down on a drag surface. */
  start: (y: number, t: number) => void;
  /** Returns true once the gesture is a drag (past the slop). */
  move: (y: number, t: number) => boolean;
  /** Returns true when the gesture was a drag (the click that follows it is not a tap). */
  end: (y: number, t: number) => boolean;
  cancel: () => void;
  /** The sheet went away or is being replaced: stop everything and clear all overrides. */
  dispose: () => void;
};

type Gesture = { startY: number; base: number; lastY: number; lastT: number; v: number; moved: boolean; resume: boolean };

export function createSheetDrag(host: DragHost): SheetDrag {
  let g: Gesture | null = null;
  /** Last offset written to the element, while dragging or settling. */
  let applied: number | null = null;
  let pending: number | null = null;
  let frame = 0;
  let footer: HTMLElement | null = null;
  let footerPinned = false;
  let settling: { animations: Animation[] } | null = null;
  let handBack = 0;

  /** Drops all gesture state (nothing left on screen to settle). */
  const reset = () => {
    g = null;
    applied = null;
    pending = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  /** Removes every override a drag or settle put on the sheet (the sheet is gone, or no longer measurable). */
  const clearDom = () => {
    const el = host.el();
    reset();
    if (!el) return;
    el.classList.remove("pn-sheet--dragging", "pn-sheet--settling");
    el.style.removeProperty("transform");
    el.style.removeProperty("padding-bottom");
    footer?.style.removeProperty("transform");
  };

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const el = host.el();
    if (pending === null || !el) return;
    const offset = pending;
    const h = host.height();
    pending = null;
    applied = offset;
    el.style.transform = `translateY(${offset}px)`;
    if (footerPinned && footer) footer.style.transform = `translateY(${-offset}px)`;
    if (h !== null) host.onFrame()?.(h - offset, h, true);
  };
  const write = (offset: number) => {
    pending = offset;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  /** Where the sheet is on screen now (a settle in flight is read from its computed transform). */
  const visualOffset = (): number => {
    const el = host.el();
    if (settling && el && typeof DOMMatrix === "function") {
      const m = getComputedStyle(el).transform;
      if (m && m !== "none") return new DOMMatrix(m).m42;
    }
    const offsets = host.offsets();
    return applied ?? (offsets ? offsets[host.snap()] : 0);
  };

  const begin = () => {
    const el = host.el();
    if (!el) return;
    cancelAnimationFrame(handBack);
    el.classList.add("pn-sheet--dragging");
    el.classList.remove("pn-sheet--settling");
    el.style.paddingBottom = "0px";
    footer = el.querySelector<HTMLElement>(".pn-sheet-footer");
    // Short screens lay the footer in flow (no transform to cancel).
    footerPinned = footer !== null && getComputedStyle(footer).position === "absolute";
  };

  /** The settle ended (or was instant): hand the position back to the CSS variable. */
  const finish = (target: Snap) => {
    const el = host.el();
    const offsets = host.offsets();
    settling = null;
    applied = null;
    if (!el) return;
    if (offsets) el.style.setProperty("--pn-sheet-offset", `${offsets[target]}px`);
    el.style.removeProperty("transform");
    el.style.removeProperty("padding-bottom");
    footer?.style.removeProperty("transform");
    // The transition stays off for one more frame, so the hand-back is not itself animated.
    handBack = requestAnimationFrame(() => el.classList.remove("pn-sheet--settling"));
  };

  const settleTo = (target: Snap, v: number) => {
    flush();
    const el = host.el();
    const offsets = host.offsets();
    if (!el || !offsets) {
      clearDom();
      return;
    }
    cancelAnimationFrame(handBack);
    const from = visualOffset();
    const to = offsets[target];
    el.classList.remove("pn-sheet--dragging");
    el.classList.add("pn-sheet--settling");
    host.setSnap(target);
    const h = host.height();
    if (h !== null) host.onFrame()?.(h - to, h, false);
    if (host.reducedMotion() || typeof el.animate !== "function" || Math.abs(from - to) < 1) {
      finish(target);
      return;
    }
    const token = getComputedStyle(el).getPropertyValue("--pn-ease-snap").trim();
    const options = { duration: settleDuration(from - to, v), easing: token || FALLBACK_EASE };
    const animations = [el.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], options)];
    if (footerPinned && footer) animations.push(footer.animate([{ transform: `translateY(${-from}px)` }, { transform: `translateY(${-to}px)` }], options));
    const mine = { animations };
    settling = mine;
    animations[0]?.addEventListener("finish", () => {
      if (settling === mine) finish(target);
    });
  };

  /** A new touch on a moving sheet: stop the settle where it is and carry on from there. */
  const interrupt = (): boolean => {
    if (!settling) return false;
    const el = host.el();
    const at = visualOffset();
    for (const a of settling.animations) a.cancel();
    settling = null;
    if (el) el.style.transform = `translateY(${at}px)`;
    applied = at;
    return true;
  };

  const cancel = () => {
    const gesture = g;
    g = null;
    if (gesture?.moved || gesture?.resume) settleTo(host.snap(), 0);
  };

  return {
    start(y, t) {
      // A gesture still live (a lost pointerup): settle it first, never leave it stranded.
      if (g) cancel();
      const resume = interrupt();
      g = { startY: y, base: visualOffset(), lastY: y, lastT: t, v: 0, moved: false, resume };
    },
    move(y, t) {
      const offsets = host.offsets();
      if (!g || !offsets) return false;
      const dy = y - g.startY;
      if (!g.moved) {
        if (Math.abs(dy) < SLOP) return false;
        g.moved = true;
        begin();
      }
      const dt = t - g.lastT;
      if (dt > 0) g.v = smoothVelocity((y - g.lastY) / dt, g.v);
      g.lastY = y;
      g.lastT = t;
      write(stretchedOffset(g.base + dy, offsets[0]));
      return true;
    },
    end(y, t) {
      const gesture = g;
      g = null;
      const offsets = host.offsets();
      if (!gesture) return false;
      if (!offsets) {
        clearDom();
        return false;
      }
      if (!gesture.moved) {
        // A tap on a sheet that was still settling: let it land where it was heading.
        if (gesture.resume) settleTo(host.snap(), 0);
        return false;
      }
      const rest = Math.min(offsets[0], Math.max(0, gesture.base + (y - gesture.startY)));
      const v = t - gesture.lastT > STALE_MS ? 0 : gesture.v;
      settleTo(nearestDetent(offsets, rest, v), v);
      return true;
    },
    cancel,
    dispose() {
      cancelAnimationFrame(handBack);
      for (const a of settling?.animations ?? []) a.cancel();
      settling = null;
      clearDom();
    },
  };
}
