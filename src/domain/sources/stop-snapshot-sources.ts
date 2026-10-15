// Sources behind every published mapped stop. Each candidate pin is a placemark of the public
// Google My Maps "Naga City Designated Stops" (S39, the viewer), imported from its KML export (S40):
// every record of Data_Sets/naga_mapped_stops.geojson carries `source_ids: ["S39", "S40"]`, and the
// import records the KML document under S40 (scripts/lib/import-plan.ts). The published views do
// not expose those codes (v_published_sources lists only codes stored on published rows), so the
// register adds them by this explicit list, read from the source catalogue, ONLY while the
// revision publishes at least one stop (tests/unit/stop-snapshot-sources.test.ts pins the list to
// the data). S41/S42 (the announcements that shared the map) are cited by nothing published.
export const STOP_SNAPSHOT_SOURCE_CODES: readonly string[] = ["S39", "S40"];
