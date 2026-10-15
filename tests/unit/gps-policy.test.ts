import { describe, expect, it } from "vitest";
import { initialEndpointsState, type Endpoint, type EndpointsState } from "@/domain/trip/endpoints";
import { applyIfAccepted, gpsEndpointKey, shouldKeepWatching } from "@/ui/home/gps-policy";

const PLAZA = { lat: 13.6233869, lng: 123.1846726 };
const PILI = { lat: 13.5828, lng: 123.2756 };
const gps: Endpoint = { point: PLAZA, source: "gps", label: "Your location" };
const pin: Endpoint = { point: PLAZA, source: "map", label: "Pinned location" };
const state = (over: Partial<EndpointsState>): EndpointsState => ({ ...initialEndpointsState, ...over });

describe("gpsEndpointKey", () => {
  it("is null when no endpoint is gps-sourced", () => {
    expect(gpsEndpointKey(initialEndpointsState)).toBeNull();
    expect(gpsEndpointKey(state({ start: pin, destination: pin }))).toBeNull();
  });
  it("finds the gps endpoint on either side (e.g. after a swap)", () => {
    expect(gpsEndpointKey(state({ start: gps }))).toBe("start");
    expect(gpsEndpointKey(state({ start: pin, destination: gps }))).toBe("destination");
  });
});

describe("shouldKeepWatching", () => {
  it("keeps watching while an endpoint is gps-sourced", () => {
    expect(shouldKeepWatching(state({ destination: gps }), false)).toBe(true);
  });
  it("keeps watching while a use-current-location request is pending", () => {
    expect(shouldKeepWatching(initialEndpointsState, true)).toBe(true);
  });
  it("keeps watching while a locate recentre is still pending", () => {
    expect(shouldKeepWatching(initialEndpointsState, false, true)).toBe(true);
  });
  it("stops once the recentre is done and nothing else needs GPS", () => {
    expect(shouldKeepWatching(initialEndpointsState, false, false)).toBe(false);
    expect(shouldKeepWatching(state({ start: pin }), false, false)).toBe(false);
  });
  it("stops when nothing needs GPS", () => {
    expect(shouldKeepWatching(state({ start: pin }), false)).toBe(false);
    expect(shouldKeepWatching(initialEndpointsState, false)).toBe(false);
  });
});

describe("applyIfAccepted", () => {
  it("accepts a point inside Naga and returns the next state", () => {
    const r = applyIfAccepted(initialEndpointsState, "destination", { point: PLAZA, source: "map", label: "" });
    expect(r.accepted).toBe(true);
    expect(r.next.destination?.point).toEqual(PLAZA);
  });
  it("rejects a point outside Naga and leaves endpoints unchanged", () => {
    const r = applyIfAccepted(initialEndpointsState, "start", { point: PILI, source: "map", label: "" });
    expect(r.accepted).toBe(false);
    expect(r.next.start).toBeNull();
  });
});
