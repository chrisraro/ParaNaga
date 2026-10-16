# OpenStreetMap places snapshots

Named places inside Naga City, imported by `pnpm db:import` into `transit.place` /
`transit.place_version` (migration `0003_osm_places.sql`) and shown in search, Explore and
place detail.

## Licence and attribution

- **Data © OpenStreetMap contributors**, available under the
  [Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  Copyright and licence page: <https://www.openstreetmap.org/copyright>.
- The ParaNaga places tables are a **derived database** under the ODbL: they are offered under
  the ODbL too (share-alike), and every screen that lists or shows an OSM place carries
  "© OpenStreetMap contributors (ODbL)" linking to <https://www.openstreetmap.org/copyright>,
  plus an "OpenStreetMap" source badge on each place.
- Each snapshot is recorded in `ingest.source` as `OSM-YYYY-MM-DD` (title "OpenStreetMap places
  snapshot", evidence type `open_data`, checked on = fetch date) and in `ingest.source_document`
  (sha256, bytes).

## Source and query

One Overpass API request (`https://overpass-api.de/api/interpreter`) for the area of OSM relation
**3084673** (Naga City, the same relation as `data/geo/naga-city-boundary.json`), `nwr` with
`out center meta`, filtered to the decision-D10 categories. **Task 14 (Increment E2, snapshot `naga-places-2026-10-16`)
widened this to every named place**: the query is `nwr["name"][KEY]` for `KEY` in `shop`, `amenity`,
`tourism`, `leisure`, `office`, `craft`, `healthcare`, `historic`, `building`, plus
`public_transport=station`+`bus=yes` and `place=square`. The first ten rows below (D10) keep their
precedence; the rest of the table follows them (`CATEGORY_RULES`), and a named element whose key
matches no specific value falls back to a generic category ("Shop", "Leisure place", "Building",
and finally "Place"). The older snapshot below was fetched with the D10 filters only.

| OSM tags | ParaNaga category |
|---|---|
| `amenity=bus_station`; `public_transport=station` + `bus=yes` | `bus_terminal` (a place only — never a ParaNaga terminal or stop) |
| `amenity=hospital`, `amenity=clinic` | `hospital_clinic` |
| `amenity=college`, `amenity=university` | `college_university` |
| `amenity=school` | `school` |
| `amenity=place_of_worship` | `place_of_worship` |
| `amenity=townhall`, `police`, `fire_station`, `post_office`; `office=government` | `government` |
| `amenity=marketplace` | `market` |
| `shop=mall` | `mall` |
| `leisure=park` | `park` |
| `place=square` | `square` |

Task 14 added (specific values first, then "any value" fallbacks; labels in
`src/domain/places/osm-categories.ts`): `restaurant` (amenity restaurant, food_court), `fast_food`,
`cafe`, `bar` (bar, pub, biergarten, nightclub), `bakery`, `supermarket`, `convenience_store`,
`department_store`, `bank`, `atm`, `pharmacy`, `health_service` (doctors, dentist, veterinary,
any `healthcare=*`), `fuel`, `hotel` (hotel, motel, resort), `lodging` (guest_house, hostel, …),
`museum`, `library`, `sports`, then any `tourism` (`attraction`; information boards are "Place"),
`historic`, `leisure`, `office`, `craft`, `shop` (`shop`), `building` and any other `amenity`
(`other_place`, shown as "Place"). `building=church|chapel|cathedral|mosque|temple|shrine` is a
`place_of_worship`; `building=school|kindergarten|college|university|hospital` map to their D10
category. A value of `no` never counts.

The table order is the precedence: a feature that matches several rows gets the first one
(`src/domain/import/osm-places.ts`, `CATEGORY_RULES`). The exact query text is stored in each
file's `header.query`.

## File format

`naga-places-YYYY-MM-DD.osm.json` (the date is the UTC fetch date), written by
`scripts/fetch-osm-places.ts` (owner-run, once; never in CI or at build time):

```json
{"header": {"query": "…", "endpoint": "…", "fetchedAt": "…", "osmBaseTimestamp": "…",
            "boundaryRelation": 3084673, "licence": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors", "responseSha256": "…",
            "removedFields": ["bounds", "changeset", "geometry", "members", "nodes", "otherTags", "uid", "user"]},
 "response": {"version": …, "generator": "…", "osm3s": {…},
              "elements": [{"type", "id", "lat", "lon" | "center", "version", "timestamp", "tags"}, …]}}
```

**Contributor data is removed before the file is written.** The script keeps only `type`, `id`,
`lat`, `lon`, `center`, `version`, `timestamp` and `tags` of each element; OSM contributor data
(`user`, `uid`, `changeset` — personal data, not needed for the ODbL attribution) and the unused
`nodes`, `members`, `bounds` and `geometry` are dropped. Of the tags, only those the importer reads
are kept — `name`, `name:en`, `name:fil`, `alt_name`, `old_name` and the category keys `amenity`,
`shop`, `tourism`, `leisure`, `office`, `craft`, `healthcare`, `historic`, `building`, `place`,
`public_transport`, `bus`; every other tag (phone, opening
hours, website, notes, fixme, source, addresses, …) is dropped (`otherTags`). `header.removedFields`
records all of this (required for real snapshots). The importer refuses any file whose elements still carry `user`, `uid` or
`changeset`. The file is a deterministic `JSON.stringify` of header and stripped response, not
the bytes Overpass sent; `header.responseSha256` is the sha256 of the response body **as received,
before the removal** (a record of what was fetched — it does not match the stored response). The
committed file's own sha256 is pinned in `ingest.source_document`, so `.gitattributes` keeps its
bytes exact (`*.osm.json -text`).

The app and the importer only read committed files; nothing calls OpenStreetMap at import, build
or runtime. A refresh is a new dated file plus a new import, which publishes a new revision
`osm-places-YYYY-MM-DD` carrying the transit data forward unchanged.

## What is kept and what is dropped

Kept, per named feature inside the city polygon: `name`; the aliases `name:en`, `name:fil`,
`alt_name`, `old_name` (values unchanged); the category and the tags that decided it (values
unchanged, for provenance); the coordinate (the node position, or the `center` Overpass computes
for a way or relation — **not an entrance**); OSM type, id, version and timestamp. In
`ingest.raw_feature`, `coordinates_raw` for an OSM place is `String(lon),String(lat)` of the
numbers in the committed snapshot (there is no other source text), and `source_code_raw` is the
key `osm:{type}/{id}`.

Dropped: features without a name, features outside the city polygon, features with no matching
category tag, and every other tag — opening hours, phone, website, image, entrances, addresses,
operator, etc. — and the contributor data removed by the fetch script (above). Duplicate names are
kept as separate places.

Test data lives elsewhere: `tests/fixtures/osm/` holds a hand-made extract with fake names, flagged
`"synthetic": true`; `transit.publish_revision` refuses to publish synthetic places.

## Places snapshots

| File | Fetched (UTC) | OSM base | Elements | Places kept | sha256 |
|---|---|---|---|---|---|
| `naga-places-2026-10-15.osm.json` | 2026-10-15 | 2026-10-15T12:56:10Z | 261 | 233 (28 unnamed dropped) | `38bf7571f20fb57b95f5af7bd48fdcc081b2a878a2ec07cbf41ea656dec15a9e` |
| `naga-places-2026-10-16.osm.json` | 2026-10-16 | 2026-10-16T18:02:51Z | 1355 | 1355 (every named place; Task 14) | `c7af37080e10786cc73c757fbfdf0dcee825aeb434487778b6d274a395371e2a` |

# OpenStreetMap road snapshots

Refreshing the road snapshot is an owner-run procedure, written out in `docs/setup.md`
("Refreshing the road snapshot"): a new dated file, a new sha256 row in the table below and a new
pin in `scripts/lib/roads-snapshot.ts`, then a new import.

The road network ParaNaga traces approximate ride paths on (J1, "Approximate path, not a verified
route shape") and builds the on-device walk graph from (J2, D7). It also resolves the feeder
`place_name` anchors and records the regional route lengths (D5).

## Licence and attribution

Same as the places snapshots above: **Data © OpenStreetMap contributors**, ODbL 1.0. Everything
derived from it — ride paths, the walk graph, regional lengths — is a derived database under the
ODbL, and every screen showing a line or walk path carries "Map data © OpenStreetMap contributors"
linked to <https://www.openstreetmap.org/copyright>. Recorded in `ingest.source` as
`OSMR-YYYY-MM-DD` (D2).

## Source and queries

`scripts/fetch-osm-roads.ts` (owner-run, once; never in CI or at build time) sends two Overpass
requests to `https://overpass-api.de/api/interpreter` (each retried at most twice, on HTTP 429/5xx
only):

1. **Roads.** `way[highway]` plus the named place nodes
   `place~^(village|hamlet|neighbourhood|locality|quarter)$` (feeder anchors), in the area of
   relation **3084673** plus a **300 m** band around its boundary ways (`around`), with
   `out meta; >; out skel qt;`. `out meta` (rather than `out body`) is used because each way's
   version and timestamp are kept; the contributor fields it also returns are removed.
2. **Regional routes (D5).** The OSM relations of the reviewed RS01–RS07 regional services
   (`data/source/research/naga-modes-seed-2026-10-16.json`) with `out meta geom`. The script
   computes `lengthKm` (the sum of the member ways with role `""`, `forward` or `backward`, each way
   counted once) and keeps **only** `{relationId, version, timestamp, name, ref, from, to, lengthKm}`
   in `header.regionalRelations`. The geometry is discarded.

The exact query texts are stored in each file's `header.query` and `header.regionalQuery`.

## File format

`naga-roads-YYYY-MM-DD.osm.json` (UTC fetch date): the header pretty-printed, then one element per
line.

```json
{"header": {"query", "regionalQuery", "endpoint", "fetchedAt", "osmBaseTimestamp",
            "boundaryRelation": 3084673, "bufferM": 300, "licence": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors", "responseSha256", "regionalResponseSha256",
            "removedFields": ["changeset", "otherTags", "uid", "user"], "regionalRelations": [...]},
 "response": {"version", "generator", "osm3s", "elements": [
   {"type": "way", "id", "version", "timestamp", "nodes": [...], "tags": {...}},
   {"type": "node", "id", "lat", "lon"},
   {"type": "node", "id", "lat", "lon", "tags": {"name", "place"}}]}}
```

**Kept:** ways with `type`, `id`, `version`, `timestamp`, `nodes` and only the tags `highway`,
`name`, `alt_name`, `old_name`, `official_name`, `ref`, `oneway`, `junction`, `access`, `foot`,
`area`, and (from the 2026-10-16 snapshot, for jeepney access) `motor_vehicle`, `vehicle`, `psv`,
`bus`, `oneway:psv`, `service`; nodes with `id`, `lat`, `lon`; place nodes also `name` and `place`.
**Dropped before writing:** `user`, `uid`, `changeset` (contributor data) and every other tag
(`otherTags`). `src/domain/import/osm-roads.ts` refuses a file whose elements still carry
`user`/`uid`/`changeset`, and its schemas never output an unknown tag. `responseSha256` and
`regionalResponseSha256` are the sha256 of the bodies **as received, before stripping**; the
committed file's own sha256 is in the table below. `.gitattributes` (`*.osm.json -text`) keeps its
bytes exact.

## How it is used

- `src/domain/geo/street-names.ts`: name normalization for matching only (NFC, diacritics
  stripped, case-folded, `Ave`/`St`/`Dr`/`Rd`/`Hwy`/`Gen.` expanded, punctuation removed);
  `matchStreet` checks `name`, `alt_name`, `old_name`, `official_name` and reviewed aliases.
- `src/domain/geo/road-graph.ts`: `buildRoadGraph(roads, {profile})`. **vehicle** (the jeepney
  profile): drivable classes plus `busway`, one-way respected (`oneway=yes|1|-1`,
  `junction=roundabout`; `oneway:psv` overrides `oneway`); `psv=yes|designated` or
  `bus=yes|designated` lets a jeepney through, otherwise `motor_vehicle=no|private`,
  `vehicle=no|private` and `access=no|private` block; `area=yes` and
  `service=parking_aisle|drive-through` left out. **walk** (D7): every class except `motorway`, `motorway_link`,
  `construction`, `proposed` (and the lifecycle values `abandoned`, `disused`, `razed`); `foot=no`
  excluded; `access=private|no` excluded unless `foot=yes|designated`; undirected. Degree-2 nodes
  are contracted into edge polylines; ~100 m spatial grid; `nearestEdge(point, maxM)`.
- `src/domain/import/trace-route.ts`: the approximate ride path tracer (J1, D6), on the vehicle
  graph. `scripts/preview-route-paths.ts` (`pnpm data:preview-paths`, dev only) writes
  `tmp/route-paths-preview.geojson` (git-ignored, never uploaded) for review in a local GIS tool.
- **Pin.** The importer and the preview read only the newest snapshot whose sha256 equals its pin
  in `scripts/lib/roads-snapshot.ts` (`ROADS_SNAPSHOT_PINS`, the same value as the table below),
  and refuse a snapshot with parse problems or a synthetic one.
- Feeder `place_name` anchors resolve by normalized name against the place nodes; no match or
  more than one match stays **unresolved** (never guessed).

## Road snapshots

| File | Fetched (UTC) | OSM base | Ways | Nodes | Place nodes | Regional relations | Bytes | sha256 |
|---|---|---|---|---|---|---|---|---|
| `naga-roads-2026-10-16.osm.json` | 2026-10-16T00:00:40Z | 2026-10-16T00:01:51Z | 4409 | 17826 | 60 | 14 (RS01–RS07) | 2037344 | `4c270b87dc1b9b91d81a4b1bb314918cc76b42c98f64e4b7fcf606effd30a469` |
| ~~`naga-roads-2026-10-15.osm.json`~~ (removed) | 2026-10-15T23:01:07Z | 2026-10-15T23:00:38Z | 4409 | 17826 | 60 | 14 (RS01–RS07) | 2035617 | `bd9d0d75cb7948dc10893eab2d541c4165d9f292ef6678076632592ce602c1c7` |

The 2026-10-16 snapshot is the same query with the jeepney access tags added to the kept list
(`motor_vehicle`, `vehicle`, `psv`, `bus`, `oneway:psv`, `service`). The 2026-10-15 file was
superseded one hour later, was never imported or pinned in `ingest`, and was removed from the tree
to avoid carrying two 2 MB copies of the same data; it stays in git history (commit ac03cc1).
Kept-tag counts in 2026-10-16: `motor_vehicle` 6 (5 `no`), `vehicle` 13 (`private`),
`service` 62 (8 `parking_aisle`, 2 `drive-through`); no `psv`, `bus` or `oneway:psv` tags in Naga.

In the 2026-10-16 snapshot, Langon, Vistansa, Salunguigui and Deca Vistansa are **not** mapped as
place nodes, so those feeder anchors stay unresolved.

Test data: `tests/fixtures/osm/roads-synthetic.osm.json` is a hand-made fake grid with fake names
(`"synthetic": true`), not OpenStreetMap data.
