# Reviewed research seeds

`naga-modes-seed-YYYY-MM-DD.json` holds the reviewed records for all transport modes: sources
N01–N41, U01, U02 and U03 (owner reports), research sources RT01–RT32, RL01–RL19, RP01–RP22 and RH01–RH21, terminals T01–T16, the tricycle feeder routes, per-route vehicle classes (fleet),
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
| TODA ordinances (Increment F) | RT25–RT32 | 8 | TODA research 2026-10-17 (ordinances 1998-103, 1998-107, 1999-046, 2001-047, 2004-008, 2009-073, 2018-079, 2020-052) | 8 | 0 |
| Loops and routes | RL01–RL19 | 19 | `loops-and-routes-candidates-2026-10.json` | 19 | 0 |
| Padyak | RP01–RP22 | 22 | `padyak-candidates-2026-10.json` (sources in `padyak-2026-10.md`) | 21 | 1 (RP22: no padyak content) |
| Jeepney hours | RH01–RH21 | 21 | `jeepney-hours-candidates-2026-10.json` (sources in `jeepney-hours-2026-10.md`) | 19 | 2 (RH16, RH17: no service content) |
| Owner report | U02 | 1 | Project owner report, 2026-10-17 (plan section E) | 1 | 0 |
| Owner report | U03 | 1 | Project owner report, 2026-10-17 (far areas plan) | 1 | 0 |

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

## TODA and tricycle terminal research (Increment F, revised batch)

The seed gained U03 (owner report of 2026-10-17: far areas Cararayan, Pacol and Panicuason charge special trips; a Balatas to Cararayan tricycle terminal; Del Rosario vias Panganiban, Diversion and Magsaysay-Francia; TODAs at Ateneo and at jeepney terminals) and the official ordinance sources RT25 to RT32. U03 is unverified and never shown as a fact. Ordinance 2025-067 is already N06 and RT08. Note RN04 (the 'Francia' signboard on R2) now also cites U03.

What the TODA research found: Naga has no published roster of registered TODAs and no TODA terminal list. Core-city for-hire trimobiles run on a color-zoned franchise system with no published names or terminals. The upper barangays (Panicuason, Carolina, Pacol, San Isidro, Cararayan, Balatas, Del Rosario) run on 1998 to 2025 ordinances that name special-franchise zones, unit counts and centro-to-junction routes; zone units may not operate outside their zone except in emergencies. The data supports a jeepney to the upper-barangay centro or junction, then a zone tricycle, but not door-to-door tricycle service from Centro. The only tricycle route documented to touch Ateneo de Naga is VISTODA/LAVISTODA (Ord 2025-067), with waiting areas at Deca Vistansa and Cararayan Proper that have no coordinates. An Ateneo TODA terminal and TODAs at jeepney terminals are not documented anywhere and rest on the owner report only. The single OSM tricycle terminal is Balatas Tricycle Terminal (T14, community). Because no other TODA terminal has coordinates, no TODA terminal rows were added: they could not be planned. No distance fare matrix or special-trip fare exists in any ordinance; the P60 to P80 special-trip figures are unofficial. Open conflicts: VISTODA unit counts (30 vs 33), the Cararayan Orange zone merged into White (2009-073) against later unit counts, and Salunguigui versus Deca-Langon (10 units each, same or different).

## Route letters (routes update, revised batch 2026-10-18)

The seed gained U04, the project owner's field photo of a PUJ stop sign at CSNHS (southbound,
2026-10-18), a `routeAliases` section (RA01–RA11) and conflicts CX11–CX12. Aliases are written as
`transit.route_alias` by the modes writer (owned kind `route_alias`: the whole set comes from this
file) and feed route search and the route detail caption. The CSNHS sign letters were matched to
the LPTRP routes by the route name printed beside each letter: B = R8-B (Naga Loop Service), E = R2,
I = R6, J = R7; they are `owner_report_unverified`, since no web source gives the E–J lettering.
The San Felipe (R5) and Cararayan (R1) letters are blurred (G or H) and are excluded until a clear
photo or document confirms them. The 1998–2014 ordinance letters (multicab Loops G–J) are not kept
(CX11). No stop coordinates were added: the sign has no location on file. See
`docs/plans/2026-10-18-routes-update.md`.

## Intercity (IC1)

`naga-intercity-seed-YYYY-MM-DD.json` holds the reviewed records for travel out of Naga ("Leaving
Naga", S24). It is separate from the modes seed. It is validated by
`src/domain/import/intercity-seed.ts`:
- `parseIntercitySeed` checks the strict shape;
- `validateIntercitySeed` checks the rules;
- `importableIntercity` returns what may be imported.

Its importer is `scripts/import-intercity.ts` (IC1 Task 4), which writes into the open draft and
never publishes. The plan is `docs/plans/2026-10-28-intercity-ic1-plan.md`.

**Provenance.**
- The evidence is `naga-intercity-research-2026-10-28.md`, an exact copy of
  `docs/research/2026-10-28-naga-intercity.md`, an AI-written research draft.
- `header.preparedFrom` pins the sha256 of its LF-normalised text, and a unit test checks the pin.
- Research references R1–R35 become source codes IC01–IC35 (`sourceMap`), because R-codes clash
  with the `R[TLPH]` families.
- Titles, URLs and date text are copied verbatim from the register.
- `evidence_type` is assigned per the plan:
  - official: R4, R13–R16;
  - community: R3, R5, R9, R32, R35;
  - booking_site: R25–R27;
  - travel_guide: R29;
  - low_quality: R28;
  - news: everything else.
- `ai_confidence` is null on every source: the research gives confidence per claim, not per source.

| Section | Records | Imported | Excluded |
|---|---|---|---|
| Sources IC01–IC35 | 35 | 35 | 0 |
| Destinations (D-…) | 31 | 31 | 0 |
| Terminals (T17 Naga Airport, no coordinate) | 1 | 1 | 0 |
| Services (RS06 v2, RS08–RS24) | 18 | 18 | 0 |
| Service links (RS01, RS02, RS03, RS05) | 4 | 4 | 0 |
| Dataset notes (`intercity_south_long_haul`) | 1 | 1 | 0 |
| Excluded register (X-…) | 10 | 0 | 10 |

**Rules the seed follows.**
- Unknown values are null and show as "not found". No fare, time, coordinate or PSGC code is
  invented, so `psgc_code` is null everywhere.
- Every non-community service has `basis`, `as_of` and `review_by`. `review_by` is
  `reviewByFor(basis, as_of)` or earlier.
- Fare observations always carry their month and basis (`at_launch`, `booking_site` or
  `travel_guide`). They are never rules and are never added together.
- Suspended and discontinued services (RS09, RS06 v2) have no fares, departures or fare rules.
- The South Long Haul is a dataset note (`planned_not_funded`, no trains run), never a service.
- RS06 v2 keeps the published name, destination, OSM relation ids and source N01. It removes the
  second operator and becomes `discontinued_reported` since 2026-03-30 (IC23).
- Its `distance_km` and `distance_basis` are rebuilt from the pinned road snapshot
  `data/source/osm/naga-roads-2026-10-16.osm.json`, using the formula in `scripts/lib/lines-plan.ts`.
  Check them against the published row before commit.

**Review.**
- Every record carries `review: { decision, reason, reviewedOn, reviewer }`.
- The file is a draft: `reviewStatus: "draft"`, with `reviewer: "owner"` as a placeholder and
  AI-proposed decisions.
- `commitProblems` refuses a commit until the owner reviews it and sets
  `reviewStatus: "owner_approved"`.
