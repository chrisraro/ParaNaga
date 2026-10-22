// Settings → Location access row: the browser's geolocation permission state as words. Read with
// navigator.permissions.query (no location request is ever made to fill it). "unsupported" covers
// a browser without the Permissions API or geolocation, an insecure context and a failed query.

import { en, type Dict } from "@/i18n/dict";

export type LocationPermission = "granted" | "prompt" | "denied" | "unsupported";

export function locationAccessLabel(state: LocationPermission, copy: Dict["settings"] = en.settings): string {
  switch (state) {
    case "granted":
      return copy.locationAllowed;
    case "prompt":
      return copy.locationAsk;
    case "denied":
      return copy.locationBlocked;
    default:
      return copy.locationUnavailable;
  }
}

/** Narrows whatever PermissionStatus.state holds to the known states. */
export function toLocationPermission(state: unknown): LocationPermission {
  return state === "granted" || state === "prompt" || state === "denied" ? state : "unsupported";
}
