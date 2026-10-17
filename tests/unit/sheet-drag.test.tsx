// @vitest-environment jsdom
/* eslint-disable react-hooks/refs -- the probes pass the sheet (it holds refs for its gesture callbacks) to its handle, as the app does */
// The shared sheet drag (app-shell/sheet-drag.ts + bottom-sheet.tsx): a drag writes to the element
// and never renders React, a release picks the detent and renders once, and the scroll hand-off.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetGrabber, offsetFor, useScrollHandoff, useSheet, type Snap } from "@/ui/app-shell/bottom-sheet";
import { createSheetDrag, type DragHost } from "@/ui/app-shell/sheet-drag";

const H = 800;
const OFFSETS = [offsetFor(0, H), offsetFor(1, H), offsetFor(2, H)] as const; // 586, 356, 0

let frames: FrameRequestCallback[] = [];
const runFrames = () => {
  const queued = frames;
  frames = [];
  for (const cb of queued) cb(0);
};
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function host(overrides: Partial<DragHost> = {}) {
  const el = document.createElement("section");
  el.innerHTML = '<div class="pn-sheet-footer"></div>';
  const state = { snap: 1 as Snap };
  const setSnap = vi.fn((s: Snap) => {
    state.snap = s;
  });
  const onFrame = vi.fn();
  const h: DragHost = {
    el: () => el,
    height: () => H,
    offsets: () => OFFSETS,
    snap: () => state.snap,
    setSnap,
    onFrame: () => onFrame,
    reducedMotion: () => true,
    ...overrides,
  };
  return { el, setSnap, onFrame, drag: createSheetDrag(h), state };
}

describe("createSheetDrag", () => {
  it("stays a tap inside the 6 px slop: nothing is written and nothing settles", () => {
    const { el, setSnap, drag } = host();
    drag.start(500, 0);
    expect(drag.move(503, 10)).toBe(false);
    expect(drag.end(503, 20)).toBe(false);
    runFrames();
    expect(el.style.transform).toBe("");
    expect(setSnap).not.toHaveBeenCalled();
  });

  it("writes a transform to the element in one frame per batch of moves, and tells React nothing", () => {
    const { el, setSnap, onFrame, drag } = host();
    drag.start(500, 0);
    for (let i = 1; i <= 10; i++) drag.move(500 - i * 10, i * 16);
    expect(el.style.transform).toBe(""); // nothing before the frame
    runFrames();
    expect(el.style.transform).toBe(`translateY(${OFFSETS[1] - 100}px)`);
    expect(el.classList.contains("pn-sheet--dragging")).toBe(true);
    expect(el.style.paddingBottom).toBe("0px");
    expect(onFrame).toHaveBeenLastCalledWith(H - (OFFSETS[1] - 100), H, true);
    expect(setSnap).not.toHaveBeenCalled();
  });

  it("stretches past full with the rubber band instead of following the finger", () => {
    const { el, drag } = host();
    drag.start(500, 0);
    drag.move(500 - OFFSETS[1] - 100, 16); // 100 px past full
    runFrames();
    const offset = Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1]);
    expect(offset).toBeLessThan(0);
    expect(offset).toBeGreaterThan(-100);
  });

  it("a slow release settles on the nearest detent and sets the snap once", () => {
    const { el, setSnap, onFrame, drag } = host();
    drag.start(500, 0);
    drag.move(500 - 300, 800); // ends at 56 px from full: slow (one long gap), so no fling
    expect(drag.end(500 - 300, 1000)).toBe(true);
    expect(setSnap).toHaveBeenCalledTimes(1);
    expect(setSnap).toHaveBeenCalledWith(2);
    expect(onFrame).toHaveBeenLastCalledWith(H, H, false); // the chrome gets the settled position
    // Reduced motion settles at once: the variable is handed back and the overrides are gone.
    expect(el.style.getPropertyValue("--pn-sheet-offset")).toBe("0px");
    expect(el.style.transform).toBe("");
    expect(el.style.paddingBottom).toBe("");
    expect(el.classList.contains("pn-sheet--dragging")).toBe(false);
    runFrames();
    expect(el.classList.contains("pn-sheet--settling")).toBe(false);
  });

  it("a fast upward fling from half carries to full; a fast downward one to the peek", () => {
    for (const [dir, want] of [[-1, 2], [1, 0]] as const) {
      const { setSnap, drag } = host();
      drag.start(500, 0);
      let y = 500;
      for (let i = 1; i <= 5; i++) {
        y += dir * 15; // 1.5 px/ms
        drag.move(y, i * 10);
      }
      drag.end(y, 52);
      expect(setSnap).toHaveBeenCalledWith(want);
    }
  });

  it("a pause before release is not a fling", () => {
    const { setSnap, drag } = host();
    drag.start(500, 0);
    for (let i = 1; i <= 5; i++) drag.move(500 - i * 15, i * 10);
    drag.end(500 - 75, 400);
    expect(setSnap).toHaveBeenCalledWith(1);
  });

  it("cancel returns to the current snap", () => {
    const { setSnap, drag } = host();
    drag.start(500, 0);
    drag.move(400, 16);
    drag.cancel();
    expect(setSnap).toHaveBeenCalledWith(1);
  });

  it("animates the settle with the Web Animations API when motion is allowed", () => {
    const finish: Array<() => void> = [];
    const animate = vi.fn(() => ({
      addEventListener: (_: string, cb: () => void) => finish.push(cb),
      cancel: vi.fn(),
    }));
    const { el, drag } = host({ reducedMotion: () => false });
    (el as unknown as { animate: unknown }).animate = animate;
    drag.start(500, 0);
    drag.move(450, 16);
    drag.end(450, 400);
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes).toHaveLength(2);
    expect(options.duration).toBeGreaterThanOrEqual(180);
    expect(options.duration).toBeLessThanOrEqual(360);
    expect(options.easing).toContain("cubic-bezier"); // the --pn-ease-snap token, or its fallback
    expect(el.classList.contains("pn-sheet--settling")).toBe(true);
    expect(el.style.paddingBottom).toBe("0px"); // held until the animation ends
    finish[0]?.();
    expect(el.style.paddingBottom).toBe("");
    expect(el.style.getPropertyValue("--pn-sheet-offset")).toBe(`${OFFSETS[1]}px`);
  });
});

function Probe({ onRender, onFrame }: { onRender: () => void; onFrame?: (v: number, h: number, d: boolean) => void }) {
  onRender();
  const sheet = useSheet(1, 0, undefined, onFrame);
  return (
    <section ref={sheet.attach} data-testid="sheet" data-snap={sheet.snap}>
      <SheetGrabber sheet={sheet} />
    </section>
  );
}

function mountProbe(onFrame?: (v: number, h: number, d: boolean) => void) {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => H });
  const renders = vi.fn();
  const view = render(<Probe onRender={renders} onFrame={onFrame} />);
  const grabber = view.getByRole("button");
  grabber.setPointerCapture = () => undefined;
  return { ...view, renders, grabber };
}

describe("SheetGrabber + useSheet", () => {
  it("renders nothing in React while dragging, and once on release", () => {
    const { renders, grabber, getByTestId } = mountProbe();
    const before = renders.mock.calls.length;
    fireEvent.pointerDown(grabber, { pointerId: 1, clientY: 500, pointerType: "touch" });
    for (let i = 1; i <= 40; i++) fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 500 - i * 4, pointerType: "touch" });
    runFrames();
    expect(renders.mock.calls.length).toBe(before);
    expect(getByTestId("sheet").style.transform).toMatch(/translateY\(/);
    expect(getByTestId("sheet").classList.contains("pn-sheet--dragging")).toBe(true);
    fireEvent.pointerUp(grabber, { pointerId: 1, clientY: 500 - 160, pointerType: "touch" });
    expect(renders.mock.calls.length - before).toBeLessThanOrEqual(2); // the snap state, once
    expect(getByTestId("sheet").dataset.snap).toBe("2");
  });

  it("a drag is not a tap: the click after it does not cycle the snap again", () => {
    const { grabber, getByTestId } = mountProbe();
    fireEvent.pointerDown(grabber, { pointerId: 1, clientY: 500, pointerType: "touch" });
    fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 300, pointerType: "touch" });
    fireEvent.pointerUp(grabber, { pointerId: 1, clientY: 300, pointerType: "touch" });
    fireEvent.click(grabber);
    expect(getByTestId("sheet").dataset.snap).toBe("2");
  });

  it("keeps the tap and arrow-key alternatives", () => {
    const { grabber, getByTestId } = mountProbe();
    fireEvent.click(grabber);
    expect(getByTestId("sheet").dataset.snap).toBe("2");
    fireEvent.keyDown(grabber, { key: "ArrowDown" });
    expect(getByTestId("sheet").dataset.snap).toBe("1");
    fireEvent.keyDown(grabber, { key: "ArrowDown" });
    expect(getByTestId("sheet").dataset.snap).toBe("0");
    expect(grabber.getAttribute("aria-label")).toBe("Expand sheet to half");
  });

  // Performance guard: the whole per-move path (pointer handler, velocity, rubber band, the frame's
  // writes and the chrome callback) is plain JS. jsdom has no layout or paint, so this bounds the
  // script cost only; the budget is 4 ms per frame, the guard asserts far below it.
  it("handles a pointer move in well under 4 ms of script", () => {
    const { grabber } = mountProbe(() => undefined);
    fireEvent.pointerDown(grabber, { pointerId: 1, clientY: 600, pointerType: "touch" });
    const moves = 300;
    const t0 = performance.now();
    for (let i = 1; i <= moves; i++) {
      fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 600 - (i % 200), pointerType: "touch" });
      runFrames();
    }
    const perMove = (performance.now() - t0) / moves;
    console.info(`sheet drag script cost: ${perMove.toFixed(3)} ms per move (jsdom, includes event dispatch)`);
    expect(perMove).toBeLessThan(4);
  });
});

function List({ snap, sheetSnap }: { snap: Snap; sheetSnap: (s: Snap) => void }) {
  const sheet = useSheet(snap);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useScrollHandoff(sheet, el);
  sheetSnap(sheet.snap);
  return (
    <section ref={sheet.attach} data-testid="sheet">
      <div ref={setEl} data-testid="list" />
    </section>
  );
}

let clock = 0;
function touch(el: Element, type: string, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "timeStamp", { value: (clock += 400) }); // slow: no fling
  const t = [{ clientY: y }];
  Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : t });
  Object.defineProperty(e, "changedTouches", { value: t });
  el.dispatchEvent(e);
  return e;
}

describe("useScrollHandoff", () => {
  const setup = (snap: Snap) => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => H });
    const seen = vi.fn();
    const view = render(<List snap={snap} sheetSnap={seen} />);
    return { ...view, seen, list: view.getByTestId("list") };
  };

  it("at full, with the list at its top, a downward pull becomes a sheet drag (and stops the native pan)", () => {
    const { list, getByTestId, seen } = setup(2);
    touch(list, "touchstart", 300);
    expect(touch(list, "touchmove", 304).defaultPrevented).toBe(false); // inside the slop
    expect(touch(list, "touchmove", 360).defaultPrevented).toBe(true);
    runFrames();
    expect(getByTestId("sheet").style.transform).toMatch(/translateY\((\d|\.)+px\)/);
    touch(list, "touchmove", 520);
    act(() => void touch(list, "touchend", 520));
    expect(seen).toHaveBeenLastCalledWith(1); // 220 px down from full lands nearest half
  });

  it("scrolls the list instead when it is not at the top, at half, or pulled upward", () => {
    const { list, getByTestId } = setup(2);
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 40 });
    touch(list, "touchstart", 300);
    expect(touch(list, "touchmove", 380).defaultPrevented).toBe(false);
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 0 });
    touch(list, "touchend", 380);
    touch(list, "touchstart", 300);
    expect(touch(list, "touchmove", 250).defaultPrevented).toBe(false);
    expect(touch(list, "touchmove", 400).defaultPrevented).toBe(false); // gave up once it went up
    touch(list, "touchend", 400);
    runFrames();
    expect(getByTestId("sheet").style.transform).toBe("");
  });

  it("does not hand off below full", () => {
    const { list } = setup(1);
    touch(list, "touchstart", 300);
    expect(touch(list, "touchmove", 400).defaultPrevented).toBe(false);
  });
});
