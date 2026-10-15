import { describe, expect, it } from "vitest";
import { PHONE_MAX_WIDTH_PX, PHONE_MEDIA_QUERY, classifyViewport } from "@/domain/device/viewport-gate";

const mouse = (widthPx: number, heightPx = 900) => ({ widthPx, heightPx, coarsePointer: false });
const touch = (widthPx: number, heightPx: number) => ({ widthPx, heightPx, coarsePointer: true });

describe("phone-only gate", () => {
  it.each([320, 375, 390, 430, 768, 820])("treats %ipx as a phone or small tablet", (w) => {
    expect(classifyViewport(mouse(w))).toBe("phone");
  });

  it.each([821, 1024, 1280, 1440, 2560])("treats a %ipx desktop as a large screen", (w) => {
    expect(classifyViewport(mouse(w))).toBe("large");
  });

  it("keeps a short desktop window (mouse) gated", () => {
    expect(classifyViewport(mouse(1440, 600))).toBe("large");
  });

  it.each([
    ["Pixel 7 landscape", 863, 412],
    ["iPhone 14 Pro Max landscape", 932, 430],
    ["iPad Air landscape", 1180, 820],
  ])("keeps the app on a rotated touch device: %s", (_name, w, h) => {
    expect(classifyViewport(touch(w, h))).toBe("phone");
  });

  it("gates a large touch tablet in either orientation", () => {
    expect(classifyViewport(touch(1366, 1024))).toBe("large");
    expect(classifyViewport(touch(1024, 1366))).toBe("large");
  });

  it("fails closed on nonsense sizes", () => {
    expect(classifyViewport(mouse(Number.NaN))).toBe("large");
    expect(classifyViewport(mouse(0))).toBe("large");
    expect(classifyViewport(mouse(-1))).toBe("large");
    expect(classifyViewport(touch(900, Number.NaN))).toBe("large");
  });

  it("keeps the media query in step with the rule", () => {
    expect(PHONE_MEDIA_QUERY).toBe(
      `(max-width: ${PHONE_MAX_WIDTH_PX}px), (pointer: coarse) and (max-height: ${PHONE_MAX_WIDTH_PX}px)`,
    );
  });
});
