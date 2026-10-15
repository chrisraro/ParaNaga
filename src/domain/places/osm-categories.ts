// ParaNaga categories for OpenStreetMap places (decision D10). Shared by the import parser
// (src/domain/import/osm-places.ts), the API schema and the UI; pure and dependency-free so the
// client bundle can import it.

export const OSM_PLACE_CATEGORIES = [
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

export type OsmPlaceCategory = (typeof OSM_PLACE_CATEGORIES)[number];

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
};

export const OSM_ELEMENT_TYPES = ["node", "way", "relation"] as const;
export type OsmElementType = (typeof OSM_ELEMENT_TYPES)[number];
