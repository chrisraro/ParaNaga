// The /offline page's text steps follow the UI language (audit F9): a Filipino reader offline no
// longer gets English steps, and the English wording is unchanged.
import { describe, expect, it } from "vitest";
import { fil } from "@/i18n/fil";
import { publishedDateText } from "@/domain/network/present";
import { offlineBannerText, offlineDataLine } from "@/domain/pwa/offline-copy";
import type { SavedTrip } from "@/domain/saved/saved";
import { savedTripSteps } from "@/domain/saved/trip-text";
import { BASE, DEST, ORIGIN, oneRide, pathRide } from "./guidance-fixtures";

const card = (option: SavedTrip["option"]) =>
  ({ start: { label: "Plaza Rizal", point: ORIGIN }, destination: { label: "SM City Naga", point: DEST }, option, stops: [], variants: [], revisionLabel: "r1" }) as unknown as SavedTrip;

describe("saved trip steps in the UI language", () => {
  it("English is the default and keeps its wording", () => {
    const steps = savedTripSteps(card(oneRide()));
    expect(steps.some((s) => s.startsWith("Ride "))).toBe(true);
    expect(steps.some((s) => s.includes("(path not verified)") || s.startsWith("Start at") || s.startsWith("Arrive at"))).toBe(true);
  });

  it("Filipino has no English step words, and the driver badge is the Filipino one", () => {
    const steps = savedTripSteps(card(oneRide()), fil);
    const text = steps.join("\n");
    expect(text).not.toMatch(/\b(Walk|Ride|Start at|Arrive at|Transfer|pin order|path not verified|Unverified route)\b/);
    expect(text).toContain("Sumakay sa");
    expect(text).toContain(fil.trip.unverifiedBadge);
    expect(text).toContain("ayon sa ayos ng pin");
  });

  it("a ride at free points reads along the path in Filipino, with the free-alight line", () => {
    const at = (m: number) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
    const option = { ...oneRide(), legs: [oneRide().legs[0]!, pathRide(200, 2000, at), oneRide().legs[2]!] };
    const ride = savedTripSteps(card(option), fil)[1]!;
    expect(ride).toContain("tinatayang daan");
    expect(ride).toContain(fil.trip.freeAlight("SM City Naga"));
    expect(ride).not.toMatch(/approximate path|Ride /);
  });
});

describe("offline dates follow the UI language", () => {
  const at = "2026-10-15T17:00:00.000Z";
  it("publishedDateText takes the locale, and the offline lines pass it on", () => {
    expect(publishedDateText(at, "en")).toBe("Oct 16, 2026");
    const filDate = publishedDateText(at, "fil")!;
    expect(filDate).not.toBe("Oct 16, 2026");
    expect(offlineDataLine(at, true, fil.pwa, "fil")).toBe(fil.pwa.dataFromDate(filDate));
    expect(offlineBannerText(at, true, fil.pwa, "fil")).toBe(fil.pwa.offlineFromDate(filDate));
  });
});
