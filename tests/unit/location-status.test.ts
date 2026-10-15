// Facts: unit tests for locationStatusCopy (src/ui/home/location-status.tsx), the pure helper the
// Task 6 home screen uses to turn useGeolocation's state + assessFix's assessment into sheet copy.
// Data shape: GeolocationState string, FixAssessment | null, accuracy in metres | null.
import { describe, expect, it } from "vitest";
import type { FixAssessment } from "@/domain/geo/location-fix";
import { formatAccuracy, locationStatusCopy } from "@/ui/home/location-status";

const assessment = (over: Partial<FixAssessment> = {}): FixAssessment => ({
  quality: "precise",
  stale: false,
  insideCity: true,
  usableAsStart: true,
  ...over,
});

const PIN_LATER = "You can still pin your start on the map.";

describe("formatAccuracy", () => {
  it("rounds to whole metres with a ± sign", () => {
    expect(formatAccuracy(24.6)).toBe("± 25 m");
    expect(formatAccuracy(80)).toBe("± 80 m");
    expect(formatAccuracy(0.4)).toBe("± 0 m");
  });
});

describe("locationStatusCopy", () => {
  it("says nothing while idle", () => {
    expect(locationStatusCopy("idle", null, null)).toBeNull();
  });

  it("is finding the location while requesting", () => {
    expect(locationStatusCopy("requesting", null, null)).toEqual({
      kind: "requesting",
      tone: "neutral",
      title: "Finding your location…",
    });
  });

  it("is still finding the location when watching without a fresh fix", () => {
    expect(locationStatusCopy("watching", null, null)?.kind).toBe("requesting");
    expect(locationStatusCopy("watching", assessment({ stale: true, usableAsStart: false }), 12)?.kind).toBe(
      "requesting",
    );
  });

  it("confirms a precise fix with its accuracy", () => {
    expect(locationStatusCopy("watching", assessment(), 12.4)).toEqual({
      kind: "precise",
      tone: "ok",
      title: "You are here",
      detail: "± 12 m",
    });
  });

  it("flags an approximate fix but keeps it usable", () => {
    const copy = locationStatusCopy("watching", assessment({ quality: "approximate" }), 79.5);
    expect(copy).toEqual({
      kind: "approximate",
      tone: "warn",
      title: "Your location is approximate. Check the pin or move it.",
      detail: "± 80 m",
      action: "pick_start",
      actionLabel: "Move start pin",
    });
  });

  it("refuses a coarse fix and points to pinning", () => {
    const copy = locationStatusCopy(
      "watching",
      assessment({ quality: "coarse", usableAsStart: false }),
      412.7,
    );
    expect(copy).toEqual({
      kind: "coarse",
      tone: "warn",
      title: "Location too rough (± 413 m). Pin your start on the map.",
      action: "pick_start",
    });
  });

  it("explains a fix outside Naga City, whatever its quality", () => {
    for (const quality of ["precise", "approximate", "coarse"] as const) {
      const copy = locationStatusCopy(
        "watching",
        assessment({ quality, insideCity: false, usableAsStart: false }),
        10,
      );
      expect(copy).toEqual({
        kind: "outside_city",
        tone: "info",
        title: "You're outside Naga City. Pin your starting point in Naga, or search for a place.",
        action: "pick_start",
      });
    }
  });

  it("explains denied permission with a how-to line", () => {
    expect(locationStatusCopy("denied", null, null)).toEqual({
      kind: "denied",
      tone: "error",
      title: `Location is off. ${PIN_LATER}`,
      detail: "To turn it on, allow location for this site in your browser settings.",
      action: "pick_start",
    });
  });

  it("offers pinning when the position is unavailable or timed out", () => {
    for (const state of ["unavailable", "timeout"] as const) {
      expect(locationStatusCopy(state, null, null)).toEqual({
        kind: state,
        tone: "warn",
        title: `Can't get your location right now. ${PIN_LATER}`,
        action: "pick_start",
      });
    }
  });

  it("offers pinning when the browser cannot share location", () => {
    expect(locationStatusCopy("unsupported", null, null)).toEqual({
      kind: "unsupported",
      tone: "warn",
      title: `This browser can't share your location. ${PIN_LATER}`,
      action: "pick_start",
    });
  });

  it("offers pinning when the page is not secure", () => {
    expect(locationStatusCopy("insecure", null, null)).toEqual({
      kind: "insecure",
      tone: "warn",
      title: `Location needs a secure (https) connection. ${PIN_LATER}`,
      action: "pick_start",
    });
  });

  it("keeps the error copy even if an older assessment is still around", () => {
    expect(locationStatusCopy("denied", assessment(), 10)?.kind).toBe("denied");
    expect(locationStatusCopy("timeout", assessment(), 10)?.kind).toBe("timeout");
  });

  it("falls back to an unknown accuracy without inventing a number", () => {
    const copy = locationStatusCopy("watching", assessment({ quality: "coarse", usableAsStart: false }), null);
    expect(copy?.title).toBe("Location too rough. Pin your start on the map.");
  });
});
