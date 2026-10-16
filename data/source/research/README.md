# Reviewed research seeds

`naga-modes-seed-YYYY-MM-DD.json` holds the reviewed records for all transport modes: sources
N01–N41, U01 and U02 (owner report), research sources RT01–RT24, RL01–RL19, RP01–RP22 and RH01–RH21, terminals T01–T16, the tricycle feeder routes, per-route vehicle classes (fleet),
cooperative names, regional services, fare-rule source additions, new fare rules F06–F12, fare
observations, time-estimate parameters, street aliases and a conflicts register.

The importer reads only this file (newest date wins). It is validated by
`src/domain/import/modes-seed.ts` (`parseModesSeed` for the strict shape, `validateModesSeed` for
the rules, `importableRecords` for what may be imported). The file lives here, not in `Data_Sets/`,
because `Data_Sets/` is the original research package and is read as a whole.

## Research families (2026-10-17)

| Family | Codes | Records | Input (sha256 in `header.preparedFrom`; not committed) | Imported | Excluded |
|---|---|---|---|---|---|
| Tricycle restrictions | RT01–RT24 | 24 | `tricycle-restrictions-candidates-2026-10.json` | 24 | 0 |
| Loops and routes | RL01–RL19 | 19 | `loops-and-routes-candidates-2026-10.json` | 19 | 0 |
| Padyak | RP01–RP22 | 22 | `padyak-candidates-2026-10.json` (sources in `padyak-2026-10.md`) | 21 | 1 (RP22: no padyak content) |
| Jeepney hours | RH01–RH21 | 21 | `jeepney-hours-candidates-2026-10.json` (sources in `jeepney-hours-2026-10.md`) | 19 | 2 (RH16, RH17: no service content) |
| Owner report | U02 | 1 | Project owner report, 2026-10-17 (plan section E) | 1 | 0 |

The R-prefixed codes never clash with terminal codes `T01…`. Their pattern is `^R[TLPH][0-9]{2}$`.

Record sections added with these families:

- `roadRules`: tricycle and padyak road restrictions (evidence level, enactment, sources RT/RP).
- `padyakAreas`: padyak service areas with named OSM place-node anchors, associations and documented year.
- `routeNotes`: short rider-facing notes on loop routes (R8-A..D, R2), each with an evidence level
  (`official`, `news`, `community`, `owner_report_unverified`) and optional `near` point.
- Sources RT/RL/RP/RH are the research families above; U02 is the owner report (2026-10-17) and
  supports only owner-reported notes and barangays.

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

## Import and publication

`pnpm db:import --dry-run` parses this file, checks it against the pinned road snapshot (it aborts
on any problem, for example a missing time-estimate parameter) and prints the counts of what would
be written; `--commit` writes everything in one transaction and publishes the revision
`anywhere-alight-<road snapshot date>`, carrying the earlier transit data forward. Excluded records are
reported with their reason and never written. The records land in the tables of migrations 0006 to
0009 (`docs/spec/04-data-model.md`, "Modes, approximate paths and estimate records").

## What is still not in this file

Headways and waiting times, reviewed (surveyed) shapes, TODA zones and tricycle speeds, the LTFRB
Region V route and unit lists and the fuel-subsidy beneficiary list, PNR timetables and fares, and
the SimEx and 2025 LPTRP tricycle-zone results. They need the City PSO or the cooperatives office,
or field work; see `docs/spec/07-delivery.md` section 7.10.

## Review rule

Every record carries `review: { decision: "import" | "exclude", reason, reviewedOn }`. Excluded
records stay in the file with their reason (for example the OSM "UV-Express Southbound Terminal",
MATCo, the Sabang regional routes, the pre-hike ticket prices, the Eastbound dispatch fee and the
unverified tricycle speed) and are never returned by `importableRecords()`. A change to a record
is a new review: edit the value, the reason and `reviewedOn` together.

`streetAliases` maps a legal-text street name to an OSM name for path tracing (Task 5). Each alias
carries its evidence: `osm_way_ids` (the ways carrying `osm_name`) and `evidence_snapshot` (the
pinned road snapshot they were read from), plus a reason. An alias is added only when the evidence
is unambiguous: when two OSM streets could match, the one meeting both list neighbours (by shared
node) is taken and the reason says so; otherwise the street stays unmatched and the variant shows
"Path could not be traced from the street list". A compound legal entry ("A / B") gets one alias per
named street. A unit test checks every alias against the pinned snapshot.

## Licences

- Fields derived from OpenStreetMap (terminal coordinates and OSM ids, regional relation ids,
  anchors that point at OSM objects) are © OpenStreetMap contributors, a derived database under the
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Show "Map data © OpenStreetMap
  contributors" linked to <https://www.openstreetmap.org/copyright> wherever they appear.
- No OSM contributor data (`user`, `uid`, `changeset`) is kept.

## Personal data

No cooperative chairperson names and no addresses are kept. Private individuals named in the research (blog authors, a journalist, a map owner) are not kept either: the site or publication name is used instead. The schema has no field for them and
refuses unknown keys; the chairperson conflict is recorded in `conflicts` without the names.

## Synthetic data

`tests/fixtures/modes/modes-seed-synthetic.json` has the same shape with obviously fake names and
`header.synthetic: true`; it must never be published.

## Revised seed policy (Increment E)

The seed was edited in place after its first import (same file name, new hash). The importer now treats the same date with a different hash as a revised-seed batch (key `modes-seed:<date>:<sha12>`, revision `modes-<date>.<n>`) instead of refusing it; an older date is still refused. A revised batch records its own research-conflict register. See ADR 010 in `docs/spec/03-architecture.md`.
