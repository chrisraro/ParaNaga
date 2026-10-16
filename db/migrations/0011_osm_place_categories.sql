-- 0011_osm_place_categories.sql
-- Increment E2, Task 14: search finds every named OpenStreetMap place, so transit.place_version
-- accepts the new categories (restaurant, cafe, pharmacy, ... and the generic other_place, shown
-- as "Place"). Additive: the ten D10 categories stay valid; existing rows are untouched.
-- The list is src/domain/places/osm-categories.ts (OSM_PLACE_CATEGORIES); a unit test pins the two together.
alter table transit.place_version drop constraint place_version_category_check;
alter table transit.place_version add constraint place_version_category_check check (category in (
  'mall', 'market', 'school', 'college_university', 'hospital_clinic', 'place_of_worship',
  'government', 'bus_terminal', 'park', 'square',
  'restaurant', 'fast_food', 'cafe', 'bar', 'bakery', 'supermarket', 'convenience_store',
  'department_store', 'shop', 'bank', 'atm', 'pharmacy', 'health_service', 'fuel', 'hotel',
  'lodging', 'museum', 'attraction', 'historic', 'library', 'sports', 'leisure', 'office',
  'craft', 'building', 'other_place'));
