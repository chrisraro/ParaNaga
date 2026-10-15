// Settings → Location access row: the browser's geolocation permission state as words. Read with
// navigator.permissions.query (no location request is ever made to fill it). "unsupported" covers
// a browser without the Permissions API or geolocation, an insecure context and a failed query.

export type LocationPermission = "granted" | "prompt" | "denied" | "unsupported";

export type LocationAccessLabel = "Allowed" | "Ask each time" | "Blocked" | "Not available";

export function locationAccessLabel(state: LocationPermission): LocationAccessLabel {
  switch (state) {
    case "granted":
      return "Allowed";
    case "prompt":
      return "Ask each time";
    case "denied":
      return "Blocked";
    default:
      return "Not available";
  }
}

/** Narrows whatever PermissionStatus.state holds to the known states. */
export function toLocationPermission(state: unknown): LocationPermission {
  return state === "granted" || state === "prompt" || state === "denied" ? state : "unsupported";
}
