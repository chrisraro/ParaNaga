// Explore (Increment A, Task 7; decision D5): the OpenStreetMap places of the search index by
// category, and a directory of everything else on file (mapped-pin places, routes, terminals,
// barangays, feeder leads, the rail status note). Pure: no I/O, no React.
//
// Honesty: an OSM bus station is a place, never a ParaNaga terminal or stop (global constraints).
// No photos, hours or entrances exist; the screen says so.
import type { RouteList, RouteSummary, SearchIndex, SearchOsmPlace, SearchPinPlace } from "../api/schemas";
import { isActiveRoute } from "../planner/route-display";
import type { OsmPlaceCategory } from "./osm-categories";

// ------------------------------------------------------------------ categories

export const EXPLORE_CATEGORY_IDS = [
  "all", "faith", "schools", "markets", "health", "government", "parks", "terminals",
  "food", "shops", "services", "stay", "sights", "other",
] as const;
export type ExploreCategoryId = (typeof EXPLORE_CATEGORY_IDS)[number];

export type ExploreCategory = {
  id: ExploreCategoryId;
  label: string;
  /** The D10 OpenStreetMap categories in this chip; null for All. */
  osm: readonly OsmPlaceCategory[] | null;
  /** Plural noun for the empty line ("No health places on file yet."). */
  noun: string;
};

/** The chips, in artboard order, mapped from the OSM categories (D10 first, then Task 14's named places). Every category has exactly one chip. */
export const EXPLORE_CATEGORIES: readonly ExploreCategory[] = [
  { id: "all", label: "All", osm: null, noun: "places" },
  { id: "faith", label: "Faith", osm: ["place_of_worship"], noun: "places of worship" },
  { id: "schools", label: "Schools", osm: ["school", "college_university"], noun: "schools" },
  { id: "markets", label: "Markets & malls", osm: ["market", "mall"], noun: "markets or malls" },
  { id: "health", label: "Health", osm: ["hospital_clinic", "health_service", "pharmacy"], noun: "health places" },
  { id: "government", label: "Government", osm: ["government"], noun: "government offices" },
  { id: "parks", label: "Parks & plazas", osm: ["park", "square"], noun: "parks or plazas" },
  { id: "terminals", label: "Terminals", osm: ["bus_terminal"], noun: "bus stations" },
  { id: "food", label: "Food & drink", osm: ["restaurant", "fast_food", "cafe", "bar", "bakery"], noun: "places to eat or drink" },
  { id: "shops", label: "Shops", osm: ["supermarket", "convenience_store", "department_store", "shop"], noun: "shops" },
  { id: "services", label: "Services", osm: ["bank", "atm", "fuel", "office", "craft", "library"], noun: "services" },
  { id: "stay", label: "Stay", osm: ["hotel", "lodging"], noun: "places to stay" },
  { id: "sights", label: "Sights & sports", osm: ["museum", "attraction", "historic", "sports", "leisure"], noun: "sights or sports places" },
  { id: "other", label: "Other places", osm: ["building", "other_place"], noun: "other places" },
];

export function exploreCategory(id: ExploreCategoryId): ExploreCategory {
  return EXPLORE_CATEGORIES.find((c) => c.id === id) ?? EXPLORE_CATEGORIES[0]!;
}

/** The chip an OSM category belongs to (its card's tile and icon). */
export function chipOfOsmCategory(category: OsmPlaceCategory): Exclude<ExploreCategoryId, "all"> {
  const chip = EXPLORE_CATEGORIES.find((c) => c.osm?.includes(category));
  return (chip?.id ?? "government") as Exclude<ExploreCategoryId, "all">;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Places of one chip, A–Z by name (ties by key, so the order is stable). */
export function placesInCategory(places: readonly SearchOsmPlace[], id: ExploreCategoryId): SearchOsmPlace[] {
  const osm = exploreCategory(id).osm;
  return places
    .filter((p) => osm === null || osm.includes(p.category))
    .sort((a, b) => collator.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** "No health places on file yet." */
export function emptyCategoryText(id: ExploreCategoryId): string {
  return `No ${exploreCategory(id).noun} on file yet.`;
}

/** Cards shown per chip before "Show all {n} places", so the directory below stays reachable. */
export const CARD_LIMIT = 12;
/** Task 14: up to this many places "Show all" reveals at once; more than that, CARD_STEP at a time. */
export const CARD_ALL_MAX = 300;
export const CARD_STEP = 100;

/** The button below the cards when `shown` of `total` are visible (null = none), and the count after one tap. */
export function showMoreCards(total: number, shown: number): { label: string; next: number } | null {
  if (shown >= total) return null;
  return total <= CARD_ALL_MAX ? { label: `Show all ${total} places`, next: total } : { label: `Show ${Math.min(CARD_STEP, total - shown)} more places`, next: shown + CARD_STEP };
}

// ------------------------------------------------------------------ directory

export const DIRECTORY_SEGMENTS = [
  { value: "stops", label: "Mapped stops" },
  { value: "routes", label: "Routes" },
  { value: "terminals", label: "Terminals" },
  { value: "barangays", label: "Barangays" },
  { value: "leads", label: "Leads" },
] as const;
export type DirectorySegment = (typeof DIRECTORY_SEGMENTS)[number]["value"];

/** Mapped-pin places A–Z by label. */
export function mappedStopsAZ(places: readonly SearchPinPlace[]): SearchPinPlace[] {
  return [...places].sort((a, b) => collator.compare(a.label, b.label) || (a.key < b.key ? -1 : 1));
}

/** "Loop Service A" → "A"; any other layer name is not a loop. */
function loopLetter(layer: string | null): string | null {
  const m = layer ? /^Loop Service ([A-Z])$/.exec(layer.trim()) : null;
  return m ? m[1]! : null;
}

/** "4 pins · Loop A, B, C, D"; "1 pin" when no pin is in a loop layer. */
export function pinPlaceSub(place: Pick<SearchPinPlace, "pins">): string {
  const n = place.pins.length;
  const letters = [...new Set(place.pins.map((p) => loopLetter(p.layer)).filter((l): l is string => l !== null))].sort();
  return [n === 1 ? "1 pin" : `${n} pins`, letters.length > 0 ? `Loop ${letters.join(", ")}` : null].filter(Boolean).join(" · ");
}

export type RouteDirectoryGroup = { title: string; routes: RouteSummary[] };

/** The route list by group number ("Group 8"), in the API's order; routes without one last. */
export function routeDirectoryGroups(list: Pick<RouteList, "groups">): RouteDirectoryGroup[] {
  // Only the 11 active services of Ordinance 2025-070 are listed as routes (no special trips, no feeder codes).
  const active = list.groups.map((g) => ({ ...g, routes: g.routes.filter((r) => isActiveRoute(r.code)) }));
  const numbered = active.filter((g) => g.groupNumber !== null && g.routes.length > 0);
  const other = active.filter((g) => g.groupNumber === null).flatMap((g) => g.routes);
  const out = numbered.map((g) => ({ title: `Group ${g.groupNumber}`, routes: g.routes }));
  if (other.length > 0) out.push({ title: "Other routes", routes: other });
  return out;
}

/** The evidence badge of a route row: Verified, Provisional stops or Documented only. */
export function routeEvidenceBadge(route: Pick<RouteSummary, "verification" | "hasProvisionalStops">): "verified" | "provisional-stops" | "documented" {
  if (route.verification === "verified") return "verified";
  return route.hasProvisionalStops ? "provisional-stops" : "documented";
}

/** Barangays A–Z. */
export function barangaysAZ(barangays: SearchIndex["barangays"]): SearchIndex["barangays"] {
  return [...barangays].sort((a, b) => collator.compare(a.name, b.name));
}

/** Feeder leads by code (SF01…SF05). */
export function feederLeadsByCode(leads: SearchIndex["feederLeads"]): SearchIndex["feederLeads"] {
  return [...leads].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export const LEAD_STATUS_TEXT = "Documented, not verified";

/** A lead's second line from its status: "unverified" (or none) → LEAD_STATUS_TEXT; anything else spelled out. */
export function leadStatusText(status: string | null): string {
  if (!status || status === "unverified") return LEAD_STATUS_TEXT;
  const text = status.replace(/[_;]+/g, " ").trim();
  return `Documented · status: ${text}`;
}
export const TERMINAL_ROW_SUB = "Location not mapped";
/** The coordinate badge of a terminal with an OpenStreetMap coordinate (community data, ODbL). */
export const TERMINAL_OSM_SUB = "Community-mapped location (OpenStreetMap)";

/** A terminal row or pill: the OSM badge when a coordinate is on file, else "Location not mapped". */
export function terminalLocationText(hasCoordinate: boolean): string {
  return hasCoordinate ? TERMINAL_OSM_SUB : TERMINAL_ROW_SUB;
}

/**
 * The rail status note, copied from `rail_status` in Data_Sets/naga_transport_seed.json
 * (naga_lupi_viejo: community_reports_operational;verify_PNR, naga_legazpi:
 * community_reports_suspended;verify_PNR, sources S19–S21). No API carries it: update this copy
 * with the seed.
 */
export const RAIL_STATUS_TEXT =
  "PNR Naga–Lupi Viejo: reported operating. Naga–Legazpi: reported suspended. Verify with PNR.";
export const RAIL_SOURCE_CODES = ["S19", "S20", "S21"] as const;

/** "S19, S20 (not in register), S21": codes the published sources register does not list are marked. */
export function railSourcesText(registerCodes: ReadonlySet<string> | null): string {
  return RAIL_SOURCE_CODES.map((c) => (registerCodes && !registerCodes.has(c) ? `${c} (not in register)` : c)).join(", ");
}

export const EXPLORE_PLACES_NOTE = "Places come from OpenStreetMap. Sourced photos show landmarks; entrances and hours remain unverified. Photo dates and credits are linked on each image.";

/** A category id from a `?c=` query (the Home chips link here); null when absent or unknown. */
export function parseExploreCategory(raw: string | null): ExploreCategoryId | null {
  return EXPLORE_CATEGORY_IDS.find((id) => id === raw) ?? null;
}
