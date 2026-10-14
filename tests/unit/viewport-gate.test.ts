import { describe, expect, it } from "vitest";
import { PHONE_MAX_WIDTH_PX, PHONE_MEDIA_QUERY, classifyViewport } from "@/domain/device/viewport-gate";

describe("phone-only gate", () => {
  it.each([320, 375, 390, 430, 768, 820])("treats %ipx as a phone or small tablet", (w) => {
    expect(classifyViewport(w)).toBe("phone");
  });

  it.each([821, 1024, 1280, 1440, 2560])("treats %ipx as a large screen", (w) => {
    expect(classifyViewport(w)).toBe("large");
  });

  it("fails closed on nonsense widths", () => {
    expect(classifyViewport(Number.NaN)).toBe("large");
    expect(classifyViewport(0)).toBe("large");
    expect(classifyViewport(-1)).toBe("large");
  });

  it("keeps the media query in step with the width rule", () => {
    expect(PHONE_MEDIA_QUERY).toBe(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
  });
});
