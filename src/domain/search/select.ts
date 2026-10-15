// What picking a search result does: set a trip end, save a place (for=save: an OpenStreetMap or
// mapped-pin place opens the name dialog), open the result's own screen (place, terminal, route
// detail), or show an honest notice where no screen exists (a saved place, a regional category
// without a terminal). Pure: the search screen turns the action into navigation, an endpoint
// request or the save dialog.
import { OSM_CATEGORY_LABEL } from "../places/osm-categories";
import { barangayHref, osmPlaceHref, pinPlaceHref, studyLabelHref, terminalHref } from "../places/place-detail";
import type { LatLng } from "../geo/types";
import type { SavedPlaceSource } from "../saved/saved";
import { endpointForResult, regionalCategoryLabel, type SearchResult } from "./search";

/** `?for=` of /app/search: which trip end a pick sets, or a place to save; null = browsing. */
export type SearchPurpose = "start" | "destination" | "save";

export function parseSearchPurpose(raw: string | null | undefined): SearchPurpose | null {
  return raw === "start" || raw === "destination" || raw === "save" ? raw : null;
}

export type SearchAction =
  /** Set that trip end through the endpoint channel, then return to the map. */
  | { type: "endpoint"; which: "start" | "destination"; endpoint: { point: LatLng; label: string; place: SavedPlaceSource } }
  /** for=save: name and store this place on the phone. `label` is the place's own name. */
  | { type: "save"; place: { label: string; point: LatLng; source: SavedPlaceSource } }
  /** The result's own screen (place, terminal or route detail). */
  | { type: "open"; href: string }
  /** An inline notice on the search screen (saving a place, a saved place, a category without a terminal). */
  | { type: "notice" }
  /** Not tappable (old route names, feeder leads). */
  | { type: "none" };

/** The detail screen of a result, or null when it has none. */
export function detailHref(result: SearchResult): string | null {
  switch (result.kind) {
    case "osm":
      return osmPlaceHref(result.key);
    case "pin":
      return pinPlaceHref(result.key);
    case "route":
      return `/app/routes/${encodeURIComponent(result.code)}`;
    case "terminal":
      return terminalHref(result.code);
    case "barangay":
      return barangayHref(result.key);
    case "study":
      return studyLabelHref(result.code);
    case "regional":
      return result.terminalCode ? terminalHref(result.terminalCode) : null;
    case "saved":
    case "legacy":
    case "feeder":
      return null;
  }
}

export function actionFor(result: SearchResult, purpose: SearchPurpose | null): SearchAction {
  if (result.kind === "legacy" || result.kind === "feeder") return { type: "none" };
  const endpoint = endpointForResult(result);
  if (endpoint && (purpose === "start" || purpose === "destination")) return { type: "endpoint", which: purpose, endpoint };
  // A saved place is already saved: its notice says so.
  if (endpoint && purpose === "save") {
    return result.kind === "saved" ? { type: "notice" } : { type: "save", place: { label: result.title, point: endpoint.point, source: endpoint.place } };
  }
  const href = detailHref(result);
  return href ? { type: "open", href } : { type: "notice" };
}

export type SearchNotice = {
  title: string;
  body: string;
  /** Present for a saved place while browsing: "Set as start" / "Set as destination". */
  endpoint: { point: LatLng; label: string; place: SavedPlaceSource } | null;
  /** The place comes from OpenStreetMap: show the attribution with the notice. */
  osm: boolean;
};

const NOT_A_TRIP_END = "so it cannot be a trip start or destination";

/** The facts shown when a result has no screen to open (see actionFor); never "opens soon" copy. */
export function noticeFor(result: SearchResult, purpose: SearchPurpose | null): SearchNotice {
  const endpoint = purpose === "save" ? null : endpointForResult(result);
  switch (result.kind) {
    case "osm":
      return {
        title: result.title,
        body: `${OSM_CATEGORY_LABEL[result.category]}. Location from OpenStreetMap — entrance not mapped.`,
        endpoint,
        osm: true,
      };
    case "pin":
      return {
        title: result.title,
        body: `Mapped stop candidate${result.loops.length > 0 ? ` (${result.loops.join(", ")})` : ""}, not verified for navigation. Trips from mapped pins are unverified.`,
        endpoint,
        osm: false,
      };
    case "saved":
      return { title: result.title, body: purpose === "save" ? "Already saved on this phone." : "Saved place on this phone.", endpoint, osm: false };
    case "terminal":
      return {
        title: result.title,
        body: `Terminal${result.locationText ? ` · ${result.locationText}` : ""}. Its location is not mapped, ${NOT_A_TRIP_END}.`,
        endpoint: null,
        osm: false,
      };
    case "barangay":
      return {
        title: result.title,
        body: `Barangay · not surveyed. No boundary or centre is on file, ${NOT_A_TRIP_END}.`,
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
        body: `${regionalCategoryLabel(result.category)} destinations are listed${result.terminalName ? ` for ${result.terminalName}` : ""}. Individual services are not verified${result.terminalName ? ", and the terminal's location is not mapped" : ""}.`,
        endpoint: null,
        osm: false,
      };
    case "route":
    case "legacy":
    case "feeder":
      return { title: result.title, body: "", endpoint: null, osm: false };
  }
}
