import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import { SAME_PLACE_M } from "@/domain/planner/labels";
import type { LatLng } from "@/domain/geo/types";
import type { SavedPlaceSource } from "@/domain/saved/saved";

export type EndpointSource = "gps" | "map" | "search";
export type EndpointWhich = "start" | "destination";

/**
 * `place`: what a search-sourced point is (an OpenStreetMap place, a mapped-pin place, or a
 * pinned point saved earlier), so "Save this place" can say where it came from.
 */
export type Endpoint = { point: LatLng; source: EndpointSource; label: string; place?: SavedPlaceSource };

export type EndpointsState = {
  start: Endpoint | null;
  destination: Endpoint | null;
  picking: EndpointWhich | null;
  /** Why the last `set` was refused: outside the city, or within SAME_PLACE_M of the other end. */
  error: "outside_city" | "same_place" | null;
};

export type EndpointsAction =
  | { type: "pick"; which: EndpointWhich }
  | { type: "cancelPick" }
  | { type: "set"; which: EndpointWhich; endpoint: Endpoint }
  | { type: "swap" }
  | { type: "clear"; which: EndpointWhich }
  | { type: "clearAll" };

export const initialEndpointsState: EndpointsState = {
  start: null,
  destination: null,
  picking: null,
  error: null,
};

export function endpointLabel(source: EndpointSource, searchLabel = ""): string {
  if (source === "gps") return "Your location";
  if (source === "map") return "Pinned location";
  return searchLabel;
}

export function isReadyToPlan(state: EndpointsState): boolean {
  return state.start !== null && state.destination !== null;
}

export function endpointsReducer(state: EndpointsState, action: EndpointsAction): EndpointsState {
  switch (action.type) {
    case "pick":
      return { ...state, picking: action.which, error: null };
    case "cancelPick":
      return { ...state, picking: null, error: null };
    case "set": {
      const { point, source, label, place } = action.endpoint;
      if (!isInsideNaga(point)) return { ...state, error: "outside_city" };
      const other = state[action.which === "start" ? "destination" : "start"];
      if (other && haversineMeters(point, other.point) <= SAME_PLACE_M) return { ...state, error: "same_place" };
      const endpoint: Endpoint = { point: { ...point }, source, label: endpointLabel(source, label), ...(place ? { place } : {}) };
      return { ...state, [action.which]: endpoint, picking: null, error: null };
    }
    case "swap":
      return { ...state, start: state.destination, destination: state.start, error: null };
    case "clear":
      return { ...state, [action.which]: null, error: null };
    case "clearAll":
      return initialEndpointsState;
  }
}
