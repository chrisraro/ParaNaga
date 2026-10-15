import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";

export type EndpointSource = "gps" | "map" | "search";
export type EndpointWhich = "start" | "destination";

export type Endpoint = { point: LatLng; source: EndpointSource; label: string };

export type EndpointsState = {
  start: Endpoint | null;
  destination: Endpoint | null;
  picking: EndpointWhich | null;
  error: "outside_city" | null;
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
      const { point, source, label } = action.endpoint;
      if (!isInsideNaga(point)) return { ...state, error: "outside_city" };
      const endpoint: Endpoint = { point: { ...point }, source, label: endpointLabel(source, label) };
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
