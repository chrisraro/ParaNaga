// Pure helpers for the Home screen's GPS lifecycle and endpoint acceptance (no React, no I/O).

import {
  endpointsReducer,
  type Endpoint,
  type EndpointWhich,
  type EndpointsState,
} from "@/domain/trip/endpoints";

/** Which endpoint (if any) currently comes from GPS. It can be the destination after a swap. */
export function gpsEndpointKey(endpoints: EndpointsState): EndpointWhich | null {
  if (endpoints.start?.source === "gps") return "start";
  if (endpoints.destination?.source === "gps") return "destination";
  return null;
}

/** GPS keeps watching only while an endpoint is gps-sourced or a "use current location" is pending. */
export function shouldKeepWatching(endpoints: EndpointsState, intentPending: boolean): boolean {
  return intentPending || gpsEndpointKey(endpoints) !== null;
}

/** Runs the reducer's `set` and reports whether the point was accepted (inside Naga). */
export function applyIfAccepted(
  endpoints: EndpointsState,
  which: EndpointWhich,
  endpoint: Endpoint,
): { accepted: boolean; next: EndpointsState } {
  const next = endpointsReducer(endpoints, { type: "set", which, endpoint });
  return { accepted: next.error === null, next };
}
