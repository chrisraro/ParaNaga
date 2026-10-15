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
`out center meta`, filtered to the decision-D10 categories:

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

The table order is the precedence: a feature that matches several rows gets the first one
(`src/domain/import/osm-places.ts`, `CATEGORY_RULES`). The exact query text is stored in each
file's `header.query`.

## File format

`naga-places-YYYY-MM-DD.osm.json` (the date is the UTC fetch date), written by
`scripts/fetch-osm-places.ts` (owner-run, once; never in CI or at build time):

```json
{"header": {"query": "…", "endpoint": "…", "fetchedAt": "…", "osmBaseTimestamp": "…",
            "boundaryRelation": 3084673, "licence": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors", "responseSha256": "…"},
 "response": <the Overpass response, byte for byte>}
```

The app and the importer only read committed files; nothing calls OpenStreetMap at import, build
or runtime. A refresh is a new dated file plus a new import, which publishes a new revision
`osm-places-YYYY-MM-DD` carrying the transit data forward unchanged.

## What is kept and what is dropped

Kept, per named feature inside the city polygon: `name`; the aliases `name:en`, `name:fil`,
`alt_name`, `old_name` (verbatim); the category and the tags that decided it (verbatim, for
provenance); the coordinate (the node position, or the `center` Overpass computes for a way or
relation — **not an entrance**); OSM type, id, version and timestamp.

Dropped: features without a name, features outside the city polygon, features with no matching
category tag, and every other tag — opening hours, phone, website, image, entrances, addresses,
operator, etc. The OSM user metadata in the raw response (`user`, `uid`, `changeset`) stays only in
the committed file and is never imported. Duplicate names are kept as separate places.

## Snapshots

| File | Fetched (UTC) | OSM data as of | Places kept |
|---|---|---|---|
| _none committed yet — the owner runs `scripts/fetch-osm-places.ts` once and adds the row here_ | | | |

Test data lives elsewhere: `tests/fixtures/osm/` holds a hand-made extract with fake names, flagged
`"synthetic": true`; `transit.publish_revision` refuses to publish synthetic places.
