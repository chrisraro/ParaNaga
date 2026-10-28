import { describe, expect, it } from "vitest";
import {
  departureLineParts,
  evidenceChips,
  fareLineParts,
  getToTarget,
  isStale,
  sectionOf,
  sortServices,
  statusPillParts,
  visibleDepartures,
  visibleObservations,
  type PresentObservation,
} from "@/domain/intercity/present";
import { manilaDate } from "@/domain/planner/fares";

const obs = (o: Partial<PresentObservation>): PresentObservation => ({
  amountCentavos: 111200, amountHighCentavos: null, seatClassText: "Regular", destinationCode: "D-CUBAO",
  basis: "booking_site", observedAt: "2026-09-01", sourceCodes: ["IC25"], ...o,
});

describe("isStale", () => {
  it("turns at Manila midnight (UTC 15:59 vs 16:00)", () => {
    expect(isStale("2026-10-28", manilaDate(new Date("2026-10-28T15:59:00Z")))).toBe(false);
    expect(isStale("2026-10-28", manilaDate(new Date("2026-10-28T16:00:00Z")))).toBe(true);
    expect(isStale(null, "2030-01-01")).toBe(false);
  });
});

describe("sectionOf / sortServices", () => {
  it("suspended and discontinued land in not_running", () => {
    expect(sectionOf("suspended")).toBe("not_running");
    expect(sectionOf("discontinued_reported")).toBe("not_running");
    expect(sectionOf("operating")).toBe("running");
    expect(sectionOf("unconfirmed")).toBe("running");
  });

  it("orders operating, limited, unconfirmed, community_mapped; ties by code", () => {
    const list = [
      { code: "RS03", status: "community_mapped" }, { code: "RS16", status: "unconfirmed" },
      { code: "RS12", status: "operating" }, { code: "RS08", status: "operating_limited" },
      { code: "RS10", status: "operating" },
    ] as const;
    expect(sortServices(list).map((s) => s.code)).toEqual(["RS10", "RS12", "RS08", "RS16", "RS03"]);
  });
});

describe("visibleObservations", () => {
  const fresh = { reviewBy: "2027-02-25" };
  it("hides booking-site amounts after review_by", () => {
    const list = [obs({}), obs({ basis: "at_launch", amountCentavos: 1500 })];
    expect(visibleObservations(list, fresh, "2026-10-28")).toHaveLength(2);
    const after = visibleObservations(list, fresh, "2027-02-26");
    expect(after.map((o) => o.basis)).toEqual(["at_launch"]);
  });

  it("hides booking-site amounts older than 120 days even before review_by", () => {
    expect(visibleObservations([obs({ observedAt: "2026-06-01" })], fresh, "2026-10-28")).toEqual([]);
    expect(visibleObservations([obs({ observedAt: "2026-07-01" })], fresh, "2026-10-28")).toHaveLength(1);
  });

  it("marks travel-guide observations old", () => {
    const [o] = visibleObservations([obs({ basis: "travel_guide", observedAt: "2023-10-01" })], fresh, "2026-10-28");
    expect(o?.old).toBe(true);
    expect(visibleObservations([obs({})], fresh, "2026-10-28")[0]?.old).toBe(false);
  });
});

describe("getToTarget", () => {
  it("is null without a coordinate, outside Naga, or for T02 (address only)", () => {
    expect(getToTarget(null)).toBeNull();
    expect(getToTarget({ name: "Naga Airport", lat: null, lng: null })).toBeNull();
    expect(getToTarget({ name: "Pili", lat: 13.58, lng: 123.27 })).toBeNull();
    // T02 Eastbound: address text only, no coordinate on file
    expect(getToTarget({ name: "Eastbound Terminal", lat: null, lng: null })).toBeNull();
  });

  it("returns the point and label for a terminal inside Naga", () => {
    expect(getToTarget({ name: "BCS", lat: 13.6233869, lng: 123.1846726 })).toEqual({
      point: { lat: 13.6233869, lng: 123.1846726 }, label: "BCS",
    });
  });
});

describe("evidenceChips", () => {
  it("derives low / old / single_source from evidence types only", () => {
    expect(evidenceChips(["booking_site"], 1)).toEqual(["low", "single_source"]);
    expect(evidenceChips(["travel_guide"], 1)).toEqual(["low", "old", "single_source"]);
    expect(evidenceChips(["official", "news"], 2)).toEqual([]);
    expect(evidenceChips(["news", "community"], 2)).toEqual([]);
  });
});

describe("line parts", () => {
  it("fare lines carry basis and month, never sum and never say cheapest", () => {
    const a = fareLineParts(obs({}));
    expect(a).toEqual({ key: "intercity.fare.booking_site", args: { amount: "₱1,112", seatClass: "Regular", month: "2026-09" } });
    expect(fareLineParts(obs({ basis: "at_launch", amountCentavos: 1500, amountHighCentavos: 7500, seatClassText: null })))
      .toEqual({ key: "intercity.fare.at_launch", args: { amount: "₱15–₱75", month: "2026-09" } });
    expect(fareLineParts(null)).toEqual({ key: "intercity.fare.not_found", args: {} });
    const all = JSON.stringify([a, fareLineParts(obs({ amountCentavos: 123000 }))]);
    expect(all).not.toMatch(/cheapest/i);
    expect(all).not.toMatch(/2,342|2342/);
  });

  it("departure lines per pattern", () => {
    const base = { times: [], headwayMin: null, startTime: null, endTime: null, tripsPerDay: null, dayType: "unspecified", basis: "booking_site", observedOn: "2026-09-01" } as const;
    expect(departureLineParts({ ...base, pattern: "listed_times", times: ["20:00:00", "20:45:00"] }))
      .toEqual({ key: "intercity.departure.listed_times", args: { times: "20:00, 20:45", basis: "booking_site", month: "2026-09" } });
    expect(departureLineParts({ ...base, pattern: "headway_rule", headwayMin: 15, basis: "terminal_rule" }).args)
      .toMatchObject({ minutes: 15 });
    expect(departureLineParts({ ...base, pattern: "operating_hours", startTime: "08:00", endTime: "22:00", tripsPerDay: 12 }).args)
      .toMatchObject({ start: "08:00", end: "22:00", tripsPerDay: 12 });
    expect(departureLineParts(null)).toEqual({ key: "intercity.departure.not_found", args: {} });
  });

  it("status pill: suspended with since and note; stale when past review_by", () => {
    const s = { status: "suspended", statusSince: "2025-11-10", statusNoteCode: "bridge_damage_no_reopening_date", asOf: "2026-10-28", reviewBy: "2026-11-27" };
    expect(statusPillParts(s, "2026-10-28")).toEqual({
      key: "intercity.status.suspended",
      args: { since: "2025-11-10", asOf: "2026-10-28", note: "intercity.statusNote.bridge_damage_no_reopening_date" },
      stale: false,
    });
    expect(statusPillParts(s, "2026-11-28").stale).toBe(true);
    expect(JSON.stringify(statusPillParts({ ...s, status: "operating" }, "2026-10-28"))).not.toMatch(/cheapest/i);
  });
});

describe("visibleDepartures", () => {
  const dep = (basis: string, observedOn: string) => ({
    pattern: "listed_times", times: ["20:00"], headwayMin: null, startTime: null, endTime: null, tripsPerDay: null,
    dayType: "unspecified", basis, observedOn,
  });
  it("hides booking-site times past review_by or 120 days after the listing; keeps other bases", () => {
    const list = [dep("booking_site", "2026-09-01"), dep("terminal_rule", "2024-04-23")];
    expect(visibleDepartures(list, { reviewBy: "2027-02-25" }, "2026-10-28")).toHaveLength(2);
    expect(visibleDepartures(list, { reviewBy: "2027-02-25" }, "2026-12-30").map((d) => d.basis)).toEqual(["booking_site", "terminal_rule"]);
    expect(visibleDepartures(list, { reviewBy: "2027-02-25" }, "2026-12-31").map((d) => d.basis)).toEqual(["terminal_rule"]);
    expect(visibleDepartures(list, { reviewBy: "2026-11-01" }, "2026-11-02").map((d) => d.basis)).toEqual(["terminal_rule"]);
  });
});
