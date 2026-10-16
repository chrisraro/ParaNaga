// @vitest-environment jsdom
// The tab bar's clearance: measured from the laid-out bar (pill + gap + safe-area inset), and the
// home sheet's peek snap rising by exactly that much.
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBottomClearance } from "@/ui/app-shell/tab-bar";
import { HALF_VISIBLE, MAP_MIN_SHARE, PEEK_VISIBLE, offsetFor } from "@/ui/home/endpoint-sheet";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("offsetFor", () => {
  const H = 800;
  it("without a tab bar: peek shows 214 px, half 444 px, full everything", () => {
    expect(H - offsetFor(0, H)).toBe(PEEK_VISIBLE);
    expect(H - offsetFor(1, H)).toBe(HALF_VISIBLE);
    expect(offsetFor(2, H)).toBe(0);
  });

  it("with a 108 px clearance (home indicator): only the peek rises, by exactly the clearance", () => {
    expect(H - offsetFor(0, H, 108)).toBe(PEEK_VISIBLE + 108);
    expect(H - offsetFor(1, H, 108)).toBe(HALF_VISIBLE);
    expect(offsetFor(2, H, 108)).toBe(0);
  });

  it("never goes negative on a short sheet, and keeps a quarter of it as map at peek and half", () => {
    expect(offsetFor(0, 250, 108)).toBeGreaterThanOrEqual(0);
    expect(offsetFor(0, 100, 108)).toBe(0);
    expect(offsetFor(0, 300, 108)).toBe(Math.round(300 * MAP_MIN_SHARE));
    expect(offsetFor(1, 300, 108)).toBe(Math.round(300 * MAP_MIN_SHARE));
    expect(offsetFor(2, 300, 108)).toBe(0);
  });
});

describe("useBottomClearance", () => {
  function Bar({ top, report }: { top: number; report: (px: number) => void }) {
    const ref = useRef<HTMLElement>(null);
    useBottomClearance(ref, report);
    return (
      <nav
        ref={(el) => {
          ref.current = el;
          if (el) el.getBoundingClientRect = () => ({ top, bottom: top + 66, left: 16, right: 396, height: 66, width: 380, x: 16, y: top, toJSON: () => ({}) });
        }}
      />
    );
  }

  it("reports innerHeight − the bar's top (inset included), re-measures on resize, and 0 when unmounted", () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const report = vi.fn();
    // A bar 42 px above the bottom (34 px inset + 8) and 66 px tall: top = 844 − 108.
    const { unmount } = render(<Bar top={736} report={report} />);
    expect(report).toHaveBeenLastCalledWith(108);

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    window.dispatchEvent(new Event("resize"));
    expect(report).toHaveBeenLastCalledWith(164);
    expect(observers).toHaveLength(1);

    unmount();
    expect(report).toHaveBeenLastCalledWith(0);
  });
});
