// @vitest-environment jsdom
// Trip detail for the Increment E modes: free board and alight points, a tricycle and a padyak step,
// route notes with their evidence, and the soft service-window warning (Task 10).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NetworkSnapshot } from "@/domain/api/schemas";
import type { PlanOptionDto, PlanResponse, TricycleLegDto } from "@/domain/api/plan";
import { TripDetail } from "@/ui/trip/trip-detail";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";
import { BASE, DEST, PATH_LINE, ORIGIN, pathRide, streetOnly, walk } from "./guidance-fixtures";

vi.mock("@/client/saved/use-saved-trip-toggle", () => ({
  useSavedTripToggle: () => ({ match: null, kind: "none", waiting: false, unavailable: false, toggle: async () => undefined }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const data = (option: PlanOptionDto): PlanResponse => ({
  ...(PROVISIONAL_PLAN as unknown as PlanResponse),
  plan: { revisionId: PROVISIONAL_PLAN.revision.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 900, jeepneyReason: null, options: [option], notes: [] },
  stops: [],
  variants: [],
});
const show = (option: PlanOptionDto, extra: Partial<Parameters<typeof TripDetail>[0]> = {}) => render(<TripDetail data={data(option)} option={option} onBack={() => undefined} {...extra} />);
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
const place = (kind: "origin" | "destination", p: { lat: number; lng: number }) => ({ kind, lat: p.lat, lng: p.lng, stopId: null, name: null });
const at_ = (m: number) => ({ lat: BASE.lat + m / 111_320, lng: BASE.lng });

function jeepOption(notes: string[] = []): PlanOptionDto {
  const ride = { ...pathRide(200, 1800, at_), notes };
  return {
    id: "r1@200-1800", mode: "jeepney", labels: ["Recommended"], rides: 1, walkMeters: 100, walkEstimateMeters: 130, rideMeters: 1600, score: 1,
    legs: [walk(place("origin", ORIGIN), place("destination", PATH_LINE[0]!), 100) as never, ride, walk(place("origin", PATH_LINE[8]!), place("destination", DEST), 100) as never],
    fare: { minCentavos: 1300, maxCentavos: 1500, status: "estimate", completeness: "estimate" },
    evidence: "provisional",
  };
}

describe("a ride on free points", () => {
  it("reads Get on near your start, Get off near the destination, tell the driver para, stop not marked", () => {
    at("2026-10-17T04:00:00Z");
    show(jeepOption(), { ends: { start: { point: ORIGIN, label: "Magsaysay Ave", place: undefined } as never, destination: { point: DEST, label: "SM City Naga", place: undefined } as never } });
    expect(screen.getByText("Get on near Magsaysay Ave")).toBeTruthy();
    expect(screen.getByText("Get off near SM City Naga")).toBeTruthy();
    expect(screen.getByTestId("ride-free-alight").textContent).toBe("Tell the driver ‘para’ · stop not marked");
    expect(screen.queryByTestId("ride-passed-stops")).toBeNull();
  });

  it("falls back to your start / your destination when the ends have no label", () => {
    at("2026-10-17T04:00:00Z");
    show(jeepOption());
    expect(screen.getByText("Get on near your start")).toBeTruthy();
    expect(screen.getByText("Get off near your destination")).toBeTruthy();
  });
});

describe("route notes and the service window in the detail", () => {
  const OWNER = "A local reports drivers may turn into side streets on request. Ask the driver.";
  const JMIRANDA = "City Hall, BFP and BIR are on J. Miranda Ave. This loop's listed streets skip it (Ord 2025-070); ask the driver.";
  const routes = [
    {
      routeCode: "R1",
      notes: [
        { text: JMIRANDA, evidence: "official", sourceCodes: ["L01", "L03", "U02"], near: null },
        { text: OWNER, evidence: "owner_report_unverified", sourceCodes: ["U02"], near: null },
      ],
    },
  ] as unknown as NetworkSnapshot["routes"];

  it("shows the J. Miranda note with its evidence and the owner report labelled as unverified", () => {
    at("2026-10-17T04:00:00Z");
    show(jeepOption([JMIRANDA, OWNER]), { routes });
    const notes = within(screen.getByTestId("ride-route-notes")).getAllByTestId("route-note");
    expect(notes.map((n) => n.textContent)).toEqual([`${JMIRANDA}Ordinance or city record`, `${OWNER}Local report · unverified`]);
  });

  it("warns softly at a fixed 22:00 clock and keeps the trip", () => {
    at("2026-10-17T14:00:00Z");
    show(jeepOption());
    const note = screen.getByTestId("service-window-note");
    expect(note.textContent).toContain("This ride starts outside the usual hours (about 5 am–9 pm, unconfirmed). A jeepney may not be running.");
    expect(note.textContent).toContain("Usually runs about 5:00-21:00 · unconfirmed");
    expect(screen.getByTestId("trip-detail")).toBeTruthy();
  });

  it("no warning at noon", () => {
    at("2026-10-17T04:00:00Z");
    show(jeepOption());
    expect(screen.queryByTestId("service-window-note")).toBeNull();
  });
});

describe("tricycle and padyak steps", () => {
  const tricycle = (patch: Partial<TricycleLegDto> = {}): PlanOptionDto => {
    const o = streetOnly("tricycle");
    const notes = [
      "Avoids the restricted roads we could locate (Ordinance 2006-005/015; allowed 9 pm–5 am)",
      "National rules may limit tricycles on national roads; Naga has not published a tricycle route plan.",
      "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver",
      "Tricycle time not estimated",
    ];
    return { ...o, labels: ["Recommended"], legs: [{ ...(o.legs[0] as TricycleLegDto), notes, ...patch }] } as PlanOptionDto;
  };

  it("the tricycle step lists the distance, the restriction line, the national-road note, the fare and no minutes", () => {
    show(tricycle(), { ends: { start: { point: ORIGIN, label: "", place: undefined } as never, destination: { point: DEST, label: "Naga City Hall", place: undefined } as never } });
    expect(screen.getByText("Take a tricycle to Naga City Hall")).toBeTruthy();
    const steps = screen.getByTestId("street-notes").textContent!;
    expect(steps).toContain("Avoids the restricted roads we could locate");
    expect(steps).toContain("National rules may limit tricycles on national roads");
    expect(steps).toContain("Tricycle time not estimated");
    expect(screen.getByTestId("street-distance").textContent).toBe("≈ 1.5 km along streets");
    expect(screen.getByTestId("trip-detail").textContent).not.toMatch(/\d\s*min\b|Estimate \d/);
    expect(within(screen.getByTestId("leg-fare")).getByText(/Minimum fare ₱15 · confirm with the driver/)).toBeTruthy();
  });

  it("names the nearest tricycle terminal when one is within reach", () => {
    const terminals = [{ code: "T01", name: "Centro tricycle terminal", modes: ["tricycle"], lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng }] as unknown as NetworkSnapshot["terminals"];
    show(tricycle(), { terminals });
    expect(screen.getByTestId("tricycle-terminal").textContent).toMatch(/^Nearest tricycle terminal: Centro tricycle terminal, about \d+ m$/);
  });

  it("a route not confirmed says so and shows the straight line as approximate, not a route", () => {
    show(tricycle({ basis: "straight_line", path: null, distanceMeters: 900, notes: ["Route not confirmed: no street route found on the map; straight-line distance shown", "Tricycle time not estimated"] }));
    expect(screen.getByTestId("street-distance").textContent).toBe("≈ 900 m straight line · approximate, not a route");
    expect(screen.getByTestId("street-notes").textContent).toContain("Route not confirmed");
    expect(screen.queryByText(/Avoids the restricted roads/)).toBeNull();
  });

  it("the padyak step shows ₱10 per passenger and the area note", () => {
    const o = streetOnly("padyak");
    const leg = { ...o.legs[0]!, notes: ["₱10 per passenger (₱8 with ID discount) · city fare set Sep 2022 · confirm with the driver · up to 2 passengers", "Area per city ordinance · approximate boundary · service not confirmed today", "Padyak time not estimated"] };
    show({ ...o, labels: ["Short local ride"], legs: [leg] } as PlanOptionDto);
    expect(screen.getByText("Take a padyak to your destination")).toBeTruthy();
    expect(screen.getByTestId("street-notes").textContent).toContain("Area per city ordinance");
    expect(within(screen.getByTestId("leg-fare")).getByText(/₱10 per passenger · confirm with the driver/)).toBeTruthy();
  });
});
