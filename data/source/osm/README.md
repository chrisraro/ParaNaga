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
`shop`, `office`, `leisure`, `place`, `public_transport`, `bus`; every other tag (phone, opening
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

## Snapshots

| File | Fetched (UTC) | OSM data as of | Places kept |
|---|---|---|---|
| _none committed yet — the owner runs `scripts/fetch-osm-places.ts` once and adds the row here_ | | | |

Test data lives elsewhere: `tests/fixtures/osm/` holds a hand-made extract with fake names, flagged
`"synthetic": true`; `transit.publish_revision` refuses to publish synthetic places.

## Snapshots

| File | Fetched (UTC) | OSM base | Elements | Places kept | sha256 |
|---|---|---|---|---|---|
| `naga-places-2026-10-15.osm.json` | 2026-10-15 | 2026-10-15T12:56:10Z | 261 | 233 (28 unnamed dropped) | `38bf7571f20fb57b95f5af7bd48fdcc081b2a878a2ec07cbf41ea656dec15a9e` |
