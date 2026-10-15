import { describe, expect, it } from "vitest";
import {
  endpointLabel,
  endpointsReducer,
  initialEndpointsState,
  isReadyToPlan,
  type Endpoint,
  type EndpointsState,
} from "@/domain/trip/endpoints";

const PLAZA = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
const PILI = { lat: 13.5828, lng: 123.2756 };

const gps: Endpoint = { point: PLAZA, source: "gps", label: "ignored" };
const pin: Endpoint = { point: BISCAST, source: "map", label: "ignored" };
const search: Endpoint = { point: BISCAST, source: "search", label: "BISCAST" };

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe("endpointLabel", () => {
  it("maps sources to labels", () => {
    expect(endpointLabel("gps")).toBe("Your location");
    expect(endpointLabel("map")).toBe("Pinned location");
    expect(endpointLabel("search", "SM City")).toBe("SM City");
  });
});

describe("endpointsReducer", () => {
  it("starts empty", () => {
    expect(initialEndpointsState).toEqual({
      start: null,
      destination: null,
      picking: null,
      error: null,
    });
  });

  it("pick sets picking, switches, and clears error", () => {
    const errored: EndpointsState = { ...initialEndpointsState, error: "outside_city" };
    const a = endpointsReducer(errored, { type: "pick", which: "start" });
    expect(a.picking).toBe("start");
    expect(a.error).toBeNull();
    const b = endpointsReducer(a, { type: "pick", which: "destination" });
    expect(b.picking).toBe("destination");
  });

  it("cancelPick clears picking and error", () => {
    const s: EndpointsState = { ...initialEndpointsState, picking: "start", error: "outside_city" };
    expect(endpointsReducer(s, { type: "cancelPick" })).toEqual(initialEndpointsState);
  });

  it("set stores start with normalised gps label and clears picking/error", () => {
    const s: EndpointsState = { ...initialEndpointsState, picking: "start", error: "outside_city" };
    const r = endpointsReducer(s, { type: "set", which: "start", endpoint: gps });
    expect(r.start).toEqual({ point: PLAZA, source: "gps", label: "Your location" });
    expect(r.picking).toBeNull();
    expect(r.error).toBeNull();
  });

  it("set normalises map label and keeps search label for destination", () => {
    const r1 = endpointsReducer(initialEndpointsState, { type: "set", which: "destination", endpoint: pin });
    expect(r1.destination?.label).toBe("Pinned location");
    const r2 = endpointsReducer(initialEndpointsState, { type: "set", which: "destination", endpoint: search });
    expect(r2.destination?.label).toBe("BISCAST");
  });

  it("set outside Naga is rejected for both endpoints", () => {
    const base: EndpointsState = {
      start: { point: PLAZA, source: "gps", label: "Your location" },
      destination: null,
      picking: "destination",
      error: null,
    };
    const out: Endpoint = { point: PILI, source: "map", label: "x" };
    const r1 = endpointsReducer(base, { type: "set", which: "destination", endpoint: out });
    expect(r1).toEqual({ ...base, error: "outside_city" });
    const r2 = endpointsReducer(base, { type: "set", which: "start", endpoint: out });
    expect(r2).toEqual({ ...base, error: "outside_city" });
  });

  it("swap exchanges endpoints keeping sources/labels, clears error, keeps picking", () => {
    const s: EndpointsState = {
      start: { point: PLAZA, source: "gps", label: "Your location" },
      destination: { point: BISCAST, source: "search", label: "BISCAST" },
      picking: "start",
      error: "outside_city",
    };
    const r = endpointsReducer(s, { type: "swap" });
    expect(r.start).toEqual(s.destination);
    expect(r.destination).toEqual(s.start);
    expect(r.picking).toBe("start");
    expect(r.error).toBeNull();
  });

  it("swap with one or both null just swaps", () => {
    const one: EndpointsState = { ...initialEndpointsState, start: { point: PLAZA, source: "gps", label: "Your location" } };
    const r = endpointsReducer(one, { type: "swap" });
    expect(r.start).toBeNull();
    expect(r.destination).toEqual(one.start);
    expect(endpointsReducer(initialEndpointsState, { type: "swap" })).toEqual(initialEndpointsState);
  });

  it("clear removes one endpoint and error", () => {
    let s = endpointsReducer(initialEndpointsState, { type: "set", which: "start", endpoint: gps });
    s = endpointsReducer(s, { type: "set", which: "destination", endpoint: search });
    s = { ...s, error: "outside_city" };
    const r = endpointsReducer(s, { type: "clear", which: "start" });
    expect(r.start).toBeNull();
    expect(r.destination).not.toBeNull();
    expect(r.error).toBeNull();
  });

  it("clearAll returns initial state", () => {
    let s = endpointsReducer(initialEndpointsState, { type: "set", which: "start", endpoint: gps });
    s = endpointsReducer(s, { type: "pick", which: "destination" });
    expect(endpointsReducer(s, { type: "clearAll" })).toEqual(initialEndpointsState);
  });

  it("never mutates previous state", () => {
    const s = deepFreeze<EndpointsState>({
      start: { point: PLAZA, source: "gps", label: "Your location" },
      destination: { point: BISCAST, source: "search", label: "BISCAST" },
      picking: "start",
      error: null,
    });
    const actions = [
      { type: "pick", which: "destination" },
      { type: "cancelPick" },
      { type: "set", which: "start", endpoint: pin },
      { type: "set", which: "start", endpoint: { point: PILI, source: "map", label: "x" } },
      { type: "swap" },
      { type: "clear", which: "destination" },
      { type: "clearAll" },
    ] as const;
    for (const a of actions) expect(() => endpointsReducer(s, a)).not.toThrow();
  });
});

describe("isReadyToPlan", () => {
  it("requires both endpoints", () => {
    expect(isReadyToPlan(initialEndpointsState)).toBe(false);
    const half = endpointsReducer(initialEndpointsState, { type: "set", which: "start", endpoint: gps });
    expect(isReadyToPlan(half)).toBe(false);
    const full = endpointsReducer(half, { type: "set", which: "destination", endpoint: search });
    expect(isReadyToPlan(full)).toBe(true);
  });

  it("refuses an end 25 m or less from the other end as the same place, keeping the pick open", () => {
    const near = { lat: PLAZA.lat + 0.0001, lng: PLAZA.lng }; // ≈ 11 m north of PLAZA
    const withStart = endpointsReducer(initialEndpointsState, { type: "set", which: "start", endpoint: gps });
    const picking = endpointsReducer(withStart, { type: "pick", which: "destination" });
    const refused = endpointsReducer(picking, { type: "set", which: "destination", endpoint: { point: near, source: "map", label: "" } });
    expect(refused.error).toBe("same_place");
    expect(refused.destination).toBeNull();
    expect(refused.picking).toBe("destination");
    // The same rule protects the start.
    const withDest = endpointsReducer(initialEndpointsState, { type: "set", which: "destination", endpoint: { point: near, source: "map", label: "" } });
    expect(endpointsReducer(withDest, { type: "set", which: "start", endpoint: gps }).error).toBe("same_place");
    // Resetting the same end (a GPS refinement) is not compared with itself.
    expect(endpointsReducer(withStart, { type: "set", which: "start", endpoint: { point: near, source: "gps", label: "" } }).error).toBeNull();
    // Farther than 25 m is accepted.
    const far = { lat: PLAZA.lat + 0.0003, lng: PLAZA.lng }; // ≈ 33 m
    expect(endpointsReducer(picking, { type: "set", which: "destination", endpoint: { point: far, source: "map", label: "" } }).error).toBeNull();
  });
});
