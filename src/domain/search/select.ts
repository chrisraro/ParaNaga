// What picking a search result does, and the honest notice shown for results whose own screen
// does not exist yet (Place and Terminal detail arrive with Task 6; saving places with Task 8).
// Pure: the search screen turns the action into navigation or an endpoint request.
import { OSM_CATEGORY_LABEL } from "../places/osm-categories";
import type { LatLng } from "../geo/types";
import { endpointForResult, regionalCategoryLabel, type SearchResult } from "./search";

/** `?for=` of /app/search: which trip end a pick sets, or a place to save; null = browsing. */
export type SearchPurpose = "start" | "destination" | "save";

export function parseSearchPurpose(raw: string | null | undefined): SearchPurpose | null {
  return raw === "start" || raw === "destination" || raw === "save" ? raw : null;
}

export type SearchAction =
  /** Set that trip end through the endpoint channel, then return to the map. */
  | { type: "endpoint"; which: "start" | "destination"; endpoint: { point: LatLng; label: string } }
  /** An existing screen (route detail). */
  | { type: "open"; href: string }
  /** An inline notice on the search screen (no screen to open yet, or nothing to set). */
  | { type: "notice" }
  /** Not tappable (old route names, feeder leads). */
  | { type: "none" };

export function actionFor(result: SearchResult, purpose: SearchPurpose | null): SearchAction {
  if (result.kind === "route") return { type: "open", href: `/app/routes/${encodeURIComponent(result.code)}` };
  if (result.kind === "legacy" || result.kind === "feeder") return { type: "none" };
  const endpoint = endpointForResult(result);
  if (endpoint && (purpose === "start" || purpose === "destination")) return { type: "endpoint", which: purpose, endpoint };
  return { type: "notice" };
}

export type SearchNotice = {
  title: string;
  body: string;
  /** Present for places with a location (browsing): "Set as start" / "Set as destination". */
  endpoint: { point: LatLng; label: string } | null;
  /** The place comes from OpenStreetMap: show the attribution with the notice. */
  osm: boolean;
};

const NOT_A_TRIP_END = "so it cannot be a trip start or destination";

export function noticeFor(result: SearchResult, purpose: SearchPurpose | null): SearchNotice {
  const endpoint = endpointForResult(result);
  if (purpose === "save" && endpoint) {
    // Saving is not built yet: the page note says so once; the notice gives the place's facts.
    const facts = noticeFor(result, null);
    return { ...facts, body: facts.body.replace(/ Place details open soon\.$/, ""), endpoint: null };
  }
  switch (result.kind) {
    case "osm":
      return {
        title: result.title,
        body: `${OSM_CATEGORY_LABEL[result.category]}. Location from OpenStreetMap — entrance not mapped. Place details open soon.`,
        endpoint,
        osm: true,
      };
    case "pin":
      return {
        title: result.title,
        body: `Mapped stop candidate${result.loops.length > 0 ? ` (${result.loops.join(", ")})` : ""}, not verified for navigation. Trips from mapped pins are unverified. Place details open soon.`,
        endpoint,
        osm: false,
      };
    case "saved":
      return { title: result.title, body: "Saved place on this phone.", endpoint, osm: false };
    case "terminal":
      return {
        title: result.title,
        body: `Terminal${result.locationText ? ` · ${result.locationText}` : ""}. Its location is not mapped, ${NOT_A_TRIP_END}. Terminal details open soon.`,
        endpoint: null,
        osm: false,
      };
    case "barangay":
      return {
        title: result.title,
        body: `Barangay · not surveyed. No boundary or centre is on file, ${NOT_A_TRIP_END}. Barangay details open soon.`,
        endpoint: null,
        osm: false,
      };
    case "study": {
      const where = [result.routeCode, result.direction].filter((x): x is string => !!x).join(" ");
      return {
        title: result.title,
        body: `A stop label from the 2025 route study${where ? ` (${where})` : ""}. It has no location on file, ${NOT_A_TRIP_END}.`,
        endpoint: null,
        osm: false,
      };
    }
    case "regional":
      return {
        title: result.title,
        body: `${regionalCategoryLabel(result.category)} destinations are listed${result.terminalName ? ` for ${result.terminalName}` : ""}. Individual services are not verified, and the terminal's location is not mapped. Terminal details open soon.`,
        endpoint: null,
        osm: false,
      };
    case "route":
    case "legacy":
    case "feeder":
      return { title: result.title, body: "", endpoint: null, osm: false };
  }
}
