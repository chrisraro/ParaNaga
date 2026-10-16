// ParaNaga categories for OpenStreetMap places (decision D10, widened in Increment E2 Task 14 to
// every named place). Shared by the import parser (src/domain/import/osm-places.ts), the API
// schema and the UI; pure and dependency-free so the client bundle can import it.

/** The D10 categories: they ship inside the search index (first paint). */
export const CORE_PLACE_CATEGORIES = [
  "mall",
  "market",
  "school",
  "college_university",
  "hospital_clinic",
  "place_of_worship",
  "government",
  "bus_terminal",
  "park",
  "square",
] as const;

/** Every other named place: loaded as a separate lazy chunk (network/search-places). */
export const MORE_PLACE_CATEGORIES = [
  "restaurant",
  "fast_food",
  "cafe",
  "bar",
  "bakery",
  "supermarket",
  "convenience_store",
  "department_store",
  "shop",
  "bank",
  "atm",
  "pharmacy",
  "health_service",
  "fuel",
  "hotel",
  "lodging",
  "museum",
  "attraction",
  "historic",
  "library",
  "sports",
  "leisure",
  "office",
  "craft",
  "building",
  /** Generic fallback: a named element with a place key we have no word for. Shown as "Place". */
  "other_place",
] as const;

export const OSM_PLACE_CATEGORIES = [...CORE_PLACE_CATEGORIES, ...MORE_PLACE_CATEGORIES] as const;

export type OsmPlaceCategory = (typeof OSM_PLACE_CATEGORIES)[number];

const CORE = new Set<string>(CORE_PLACE_CATEGORIES);
export const isCorePlaceCategory = (category: string): boolean => CORE.has(category);

/** Display name of each category ("Mall · from OpenStreetMap"). */
export const OSM_CATEGORY_LABEL: Record<OsmPlaceCategory, string> = {
  mall: "Mall",
  market: "Market",
  school: "School",
  college_university: "College or university",
  hospital_clinic: "Hospital or clinic",
  place_of_worship: "Place of worship",
  government: "Government office",
  bus_terminal: "Bus station",
  park: "Park",
  square: "Plaza",
  restaurant: "Restaurant",
  fast_food: "Fast food",
  cafe: "Cafe",
  bar: "Bar or pub",
  bakery: "Bakery",
  supermarket: "Supermarket",
  convenience_store: "Convenience store",
  department_store: "Department store",
  shop: "Shop",
  bank: "Bank",
  atm: "ATM",
  pharmacy: "Pharmacy",
  health_service: "Health service",
  fuel: "Gas station",
  hotel: "Hotel",
  lodging: "Guesthouse or lodging",
  museum: "Museum",
  attraction: "Attraction",
  historic: "Historic site",
  library: "Library",
  sports: "Sports facility",
  leisure: "Leisure place",
  office: "Office",
  craft: "Workshop",
  building: "Building",
  other_place: "Place",
};

export const OSM_ELEMENT_TYPES = ["node", "way", "relation"] as const;
export type OsmElementType = (typeof OSM_ELEMENT_TYPES)[number];
