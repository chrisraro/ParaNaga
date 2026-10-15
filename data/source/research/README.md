# Reviewed research seeds

`naga-modes-seed-YYYY-MM-DD.json` holds the reviewed records for all transport modes: sources
N01–N41 and U01, terminals T01–T16, the tricycle feeder routes, per-route vehicle classes (fleet),
cooperative names, regional services, fare-rule source additions, new fare rules F06–F12, fare
observations, time-estimate parameters, street aliases and a conflicts register.

The importer reads only this file (newest date wins). It is validated by
`src/domain/import/modes-seed.ts` (`parseModesSeed` for the strict shape, `validateModesSeed` for
the rules, `importableRecords` for what may be imported). The file lives here, not in `Data_Sets/`,
because `Data_Sets/` is the original research package and is read as a whole.

## Provenance

- Drafted once by `scripts/draft-modes-seed.ts` from the research register
  `naga-transport-candidates-2026-10.json` (October 2026 research; not committed, never read by the
  app or the importer), `Data_Sets/naga_transport_seed.json` and the OSM places snapshot
  `data/source/osm/naga-places-2026-10-15.osm.json`. `header.preparedFrom` pins the sha256 of each
  input's LF-normalised content (CRLF → LF), so the pin does not depend on the checkout's line endings.
- Sources are copied verbatim (title, URL, publisher, date text, type, retrieved). The Jev scores
  (`typesafe/jev-1.13-20260917`) are kept in `properties` as provenance only; they are never shown as
  facts.
- `U01` is the project owner's confirmation of 2026-10-16 (type `owner_confirmation`, no URL):
  traditional jeepneys operate on every LPTRP route R1–R8 (service only; stop locations, stop order
  and paths stay unverified); air-conditioned modern jeepneys operate on R4 and R7; riders pay about
  ₱3–₱5 more on R4 modern and at least ₱5 more on R7 modern than the traditional fare. The fare
  reports are stored as `fareObservations` (`reported_practice`), never as rules.
- The 2017 e-jeepney route is not in this file (user decision 2026-10-16); its only source, N09, is
  excluded.
- Terminal coordinates come only from OpenStreetMap, each with type, id, version, timestamp and where
  it was read (`coordinate.read_from`). Four objects are not in the places snapshot (PNR way
  23662289, nodes 4545730692, 4850021530, 14053567159): their version and timestamp were read from
  the OSM API 0.6 on 2026-10-16, and each timestamp precedes the research query's `osm_base`, so the
  research coordinate belongs to the same version. Way coordinates are centroids, not entrances.

## Review rule

Every record carries `review: { decision: "import" | "exclude", reason, reviewedOn }`. Excluded
records stay in the file with their reason (for example the OSM "UV-Express Southbound Terminal",
MATCo, the Sabang regional routes, the pre-hike ticket prices, the Eastbound dispatch fee and the
unverified tricycle speed) and are never returned by `importableRecords()`. A change to a record
is a new review: edit the value, the reason and `reviewedOn` together.

`streetAliases` maps a legal-text street name to an OSM name for path tracing. Each alias needs a
reason; the list starts empty and is filled from the tracer's unmatched streets.

## Licences

- Fields derived from OpenStreetMap (terminal coordinates and OSM ids, regional relation ids,
  anchors that point at OSM objects) are © OpenStreetMap contributors, a derived database under the
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Show "Map data © OpenStreetMap
  contributors" linked to <https://www.openstreetmap.org/copyright> wherever they appear.
- No OSM contributor data (`user`, `uid`, `changeset`) is kept.

## Personal data

No cooperative chairperson names and no addresses are kept. The schema has no field for them and
refuses unknown keys; the chairperson conflict is recorded in `conflicts` without the names.

## Synthetic data

`tests/fixtures/modes/modes-seed-synthetic.json` has the same shape with obviously fake names and
`header.synthetic: true`; it must never be published.
