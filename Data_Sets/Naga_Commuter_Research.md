# Naga City commuter transport research and data foundation

Research date: 15 October 2026, Asia/Manila. Geography: Naga City, Camarines Sur, not Naga, Cebu.

## What this research establishes

Public web research produced a documented inventory of the principal transport modes, the approved city jeepney network, major terminal references, fare evidence, feeder candidates and data gaps. It is a useful foundation for an interactive commuter app, but not an exhaustive or navigation-ready survey of every active route and curb.

The strongest network evidence is Ordinance 2025-070 and its signed PDF: eight approved PUJ Class 2 route groups with 282 allocated units. Group 8 contains Loops A–D, so the dataset contains eleven route/variant records. Allocated units are regulatory allowances, not a count of vehicles currently on the road. [S01, S02]

The initial search did not retrieve boarding coordinates. The later public-map update supplies map-pin coordinates for four loops, while legal loading zones, current operator assignments, surveyed route geometry, headways and local destination-to-destination matrices remain unverified. A document's enacted date is not automatically its publication/effectivity date. Web retrieval dates do not establish service availability.

## Transport modes to cover

| Mode | App use | Evidence and remaining work |
|---|---|---|
| Traditional jeepney / PUJ | Main shared commuting corridors | Current national fare announcement retrieved; local matrices and active legacy variants still needed. |
| Modern PUJ / minibus / e-jeep | Main shared commuting corridors | Approved Class 2 plan retrieved; do not infer propulsion, air-conditioning or fare class from the nickname e-jeep. |
| Multicab | Smaller shared PUV where operated | Mentioned in the city's transport framework; current separate route/operator inventory not retrieved. |
| Trimobile / motorized tricycle | Local trips and feeder connections | Local base fare ordinance retrieved. Regular and special franchises have different operating permissions. |
| E-trike / taxicle | Local trips | Named in local fare ordinance; exact active units, areas and capacity amendments require confirmation. |
| Padyak / pedicab | Short local connections | Historical official fare and one dedicated subdivision corridor retrieved. |
| UV Express / filcab / passenger van | Neighboring municipalities and regional trips | Terminal categories documented; exact bay, trip schedule and fare unverified. |
| Bus | Regional commuting and intercity connections | Bicol Central Station is the bus gateway; classify regional and long-distance services separately. |
| Taxi / prebooked private car | Door-to-door fallback | Metered taxi and private charter are different products; current local meter tariffs not established. |
| Ride-hailing | Door-to-door fallback | Grab, JoyRide and Maxim have Naga presence evidence. Exact products, booking availability and prices require current app/operator confirmation. |
| PNR train | Regional commuting when operating | Historical service and official timetable index found; October community status conflicts with older Naga–Legazpi guides. |
| Walking | First/last mile and transfers | Needs actual sidewalks, crossings, entrances and accessibility survey. |

No current scheduled city commuter ferry was established. Do not turn tourism cruises or a result for Naga, Cebu into a commuter connection. Angkas, Move It and JoyRide motorcycle taxi coverage in Naga were not established by this research. A provider's national motorcycle service does not prove local passenger availability.

## Latest fare evidence

| Mode | Fare evidence | Status for app |
|---|---|---|
| Traditional jeepney | ₱14 for first 4 km; ₱2 per succeeding km; announced effective 28 September 2026 | National announcement supported by news and official implementation advisory; obtain applicable Bicol/Naga matrix before exact trip calculation. [S05, S06] |
| Modern jeepney | ₱17 minimum; ₱2.40 per succeeding km; same implementation date | National reported rate, not proof of the class or matrix of every Naga modern vehicle. [S05, S06] |
| Trimobile, e-trike, taxicle | ₱15 base; 20% discount for students, seniors, PWDs and solo parents with valid ID | Ordinance 2024-002 is the latest enacted local fare amendment retrieved. Calculated discounted base is ₱12; distance matrix still needed. [S04] |
| EASTTODA reported practice | ₱15 regular and ₱13 student, reported 22 June 2026 | Conflict: ₱13 is not a 20% discount on ₱15. Store as an observation, not a replacement official rule. [S08] |
| Padyak | ₱10 regular / ₱8 discounted | Official evidence from 2022; current confirmation required. [S07] |
| UV / van / regional bus | No reliable current city-specific complete matrix retrieved | Store unknown; do not reuse tourist ranges as exact fares. |
| Grab / JoyRide / Maxim | Live quote required | Quote depends on actual product and trip; no flat city-wide fare established. |
| PNR | Current fares not confirmed | Do not use the 2025 ₱12–₱124 rail fare range as a current ticket price. [S21] |

PIA's September 2026 advisory requires the applicable updated matrix to be displayed. The official LTFRB matrix link could not be retrieved in this session. PNA's search excerpt reports temporary downloaded guides valid through 31 December 2026; obtain the underlying circular before building automatic expiry rules. [S05, S31]

Local distance coverage needs special care: the 2022 city report described the first three kilometers, but the 2024 ordinance delegates preparation of the matrix to PSO. Do not fill in a per-kilometer increment from older ordinances. Likewise, verify discount rounding and vehicle fare class before calculating jeepney prices. Nationally named jeepney discount groups must be verified against the applicable matrix; do not automatically copy the local solo-parent category to every mode.

A useful preliminary UI can show “minimum reported fare” and “fare matrix verification pending.” It should not show an exact origin–destination fare until distance, class, discounts and rounding are verified. Adding separate vehicle legs should normally add their respective fares, unless a verified transfer arrangement exists.

## Approved city routes

Street sequences below are factual document extraction with spelling normalization, not surveyed geometry. Inbound/outbound follow the source's Entrance/Exit labels. A circuit is kept as a circuit where the source provides one. [S01, S02]

### R1: Centro–San Isidro via Cararayan

Allocated Class 2 units: 20.

Inbound: Cararayan–San Isidro Rd → Balatas Rd → Magsaysay Ave → Peñafrancia Ave → Diaz St → Elias Angeles St → Caceres St.

Outbound: Elias Angeles St → Panganiban Drive → Dayangdang St → Balatas Rd → Cararayan–San Isidro Rd.

### R2: Centro–Del Rosario via Magsaysay Avenue

Allocated Class 2 units: 22.

Inbound: Maharlika Highway → Magsaysay Ave → Peñafrancia Ave → Diaz St → Elias Angeles St → Padian St.

Outbound: Gen. Luna St → P. Burgos St → Peñafrancia Ave → Magsaysay Ave → Maharlika Highway.

### R3: Centro–Del Rosario via Roxas Avenue

Allocated Class 2 units: 28.

Circuit: Naga–Pili boundary, Del Rosario → AH26 → Roxas Ave → Fraternidad St → Biak na Bato St → Gen. Luna St → P. Burgos St → J. Hernandez Ave → Gen. Luna St → Biak na Bato St → Fraternidad St → Roxas Ave → AH26 → Naga–Pili boundary, Del Rosario.

Additional structure in source: Naga–Pili boundary, Del Rosario → AH26 → Almeda Highway → Roxas Ave → AH26 → Mabolo → Camaligan–Gainza Rd → Felix Plazo St → Southbound Terminal; reverse operation described without a separately enumerated return.

Source also lists an Almeda–Mabolo–Southbound Terminal structure. Separate branch interpretation and return path require agency clarification; do not merge the two structures.

### R4: Centro–Del Rosario via Panganiban Drive

Allocated Class 2 units: 55.

Circuit: Naga–Pili boundary, Del Rosario → AH26 → Panganiban Drive → Peñafrancia Ave → Arana St → J. Hernandez Ave → Caceres St → Dinaga St → Panganiban Drive → Naga–Pili boundary, Del Rosario.

### R5: Centro–San Felipe

Allocated Class 2 units: 33.

Inbound: Pacol Rd → Peñafrancia Ave → Diaz St → Elias Angeles St → Padian St → Gen. Luna St.

Outbound: Gen. Luna St → P. Burgos St → Peñafrancia Ave → Pacol Rd.

### R6: Centro–Pacol

Allocated Class 2 units: 29.

Inbound: Pacol Rd → Peñafrancia Ave → Diaz St → Elias Angeles St.

Outbound: Padian St → Dinaga St → Peñafrancia Ave → Pacol Rd.

### R7: Centro–Carolina–Panicuason

Allocated Class 2 units: 24.

Inbound: Panicuason Rd → Carolina Rd → Pacol Rd → Peñafrancia Ave → Diaz St → Elias Angeles St.

Outbound: Padian St → Dinaga St → Peñafrancia Ave → Pacol Rd → Carolina Rd → Panicuason Rd.

### R8-A: Centro–Magsaysay Loop A

Group 8 collectively: 71 allocated units; distribution across loops unknown.

Circuit: Gen. Luna St → P. Burgos St → Peñafrancia Ave → Magsaysay Ave → Taal Ave → J. Miranda Ave → Leon SA Aureus St / Mayflower St → Magsaysay Ave → Roxas Ave → Bicol Central Station → Roxas Ave → Fraternidad St → Biak na Bato St → Gen. Luna St.

71 units allocated to group 8 collectively; no per-loop unit count retrieved. Street order is document-derived, not a surveyed shape. Aureus/Mayflower slash requires clarification where present.

### R8-B: Centro–Magsaysay Loop B

Group 8 collectively: 71 allocated units; distribution across loops unknown.

Circuit: Gen. Luna St → Biak na Bato St → Fraternidad St → Roxas Ave → Bicol Central Station → Roxas Ave → Magsaysay Ave → Leon SA Aureus St / Mayflower St → J. Miranda Ave → Taal Ave → Magsaysay Ave → Peñafrancia Ave → P. Burgos St → Gen. Luna St.

71 units allocated to group 8 collectively; no per-loop unit count retrieved. Street order is document-derived, not a surveyed shape. Aureus/Mayflower slash requires clarification where present.

### R8-C: Centro–Magsaysay Loop C

Group 8 collectively: 71 allocated units; distribution across loops unknown.

Circuit: Gen. Luna St → P. Burgos St → Peñafrancia Ave → Diaz St → Elias Angeles St → Bagumbayan Sur Rd → M.T. Villanueva Ave → Magsaysay Ave → Roxas Ave → Fraternidad St → Biak na Bato St → Gen. Luna St.

71 units allocated to group 8 collectively; no per-loop unit count retrieved. Street order is document-derived, not a surveyed shape. Aureus/Mayflower slash requires clarification where present.

### R8-D: Centro–Magsaysay Loop D

Group 8 collectively: 71 allocated units; distribution across loops unknown.

Circuit: Gen. Luna St → Biak na Bato St → Fraternidad St → Roxas Ave → Magsaysay Ave → M.T. Villanueva Ave → Bagumbayan Rd → Elias Angeles St → Caceres St → Gen. Luna St.

71 units allocated to group 8 collectively; no per-loop unit count retrieved. Street order is document-derived, not a surveyed shape. Aureus/Mayflower slash requires clarification where present.

## Route amendments and local names

Resolution 2025-735 authorized a 30-day Eastbound Terminal trial for Loops A/B on 11 November 2025. It describes Loop A reaching Eastbound before BCS, and Loop B reaching BCS before Eastbound then Raul S. Roco Street. Store this as a separate trial revision. The trial's duration does not prove it became permanent or that the earlier route resumed. Obtain the completion report or later instrument. [S03]

Resolution 2025-172 modified C/D during an earlier 90-day trial, adopted 22 April 2025. The later September ordinance supplies the baseline used here. Retain the earlier resolution for version history; do not assume its missing attachment describes today's alignment. [S29]

Legacy route names include Concepcion via Panganiban/diversion, Magsaysay, San Felipe/Lomeda, Pacol/Carolina, Cararayan/San Isidro and Bagumbayan/Calauag. Historical panel colors can assist identification after field confirmation: Panganiban yellow, diversion red, Magsaysay white, San Felipe orange, Carolina blue, Cararayan/San Isidro green, Bagumbayan/Calauag brown and Pacol pink. These are old identifiers, not evidence of present fleet appearance. Keep route aliases separate from official route groups. [S28]

The community Para po project documented eleven intra-city route items and jeepney photographs during June 2026. It could be a useful collaboration lead. It does not establish a complete GTFS feed, legal curb locations, current fares or ownership of reusable assets. Check license and provenance before import. [S27]

## Terminals and transfer hubs

- **Bicol Central Station** — Ninoy & Cory Avenue, Triangulo. Map each passenger entrance and bus bay; do not confuse BCS with PNR railway station. Evidence: S09.
- **Eastbound Terminal** — Anciano Street / Naga City Subdivision area. Confirm current compound entrances, bay assignments and aliases such as Central Jeep Terminal. Evidence: S03, S12.
- **LCC / Integrated Southbound Terminal** — Felix Plazo Street, Sabang. The retrieved three-year franchise is historical. Current renewal and each destination bay unverified. Evidence: S10.
- **Integrated Northbound Terminal** — Queborac Drive, Bagumbayan Sur. Confirm entrances, current operators and Canaman/Calabanga terminal practices. Evidence: S11, S12.
- **Centro loading cluster** — Padian / Gen. Luna / Elias Angeles / Diaz / Dinaga / Caceres streets. This is a cluster, not one fixed terminal. Record a separate curb for each direction and variant. Evidence: S01.
- **Naga PNR railway station** — Naga City; exact passenger entrance not verified. Current tickets, timetable, rail corridor status and exact entrance need PNR confirmation. Evidence: S19, S21.

The city's external destination categories identify northbound towns, eastbound regional destinations, south suburbs and southbound towns. These labels are administrative categories, not reliable compass directions for passenger guidance. Libmanan, for example, appears in the city's southbound terminal category. [S12]

| Candidate terminal/category | Destination inventory to verify | Fare and timetable |
|---|---|---|
| Northbound / Queborac | Canaman, Bombon, Magarao, Calabanga, Tinambac, Siruma | Not established |
| LCC / south suburbs | Milaor, Gainza, Minalabac, San Fernando | Not established |
| LCC / north suburb | Camaligan | Not established |
| LCC / southbound | Pasacao, Pamplona, Libmanan; verify services farther toward Sipocot, Lupi, Ragay, Del Gallego and Daet | Not established |
| Eastbound | Pili, Bula, Nabua, Iriga, Goa/Partido, Legazpi/Tabaco | Not established |
| BCS buses | Regional services and long-distance connections | Confirm operator ticket window, destination and service class individually |

Category evidence comes from the terminal ordinance and the September 2026 city festival advisory. Festival parking locations are temporary event provisions, not permanent boarding points. The farther southbound destinations are leads from that advisory, not confirmed daily trips from a particular bay. [S12, S13]

## Feeder routes and gaps

The city ordinance index and individual instruments identify Balatas–Cararayan trimobiles, Palmera/Salunguigui–Cararayan Centro, and Deca Vistansa–Cararayan via Salunguigui. Current curb locations, operators, exact prices and legal limits need local confirmation. The Deca item was initially index-only; the stop update below adds the newer 2025-067 unified route and waiting-area provisions. [S24, S26, S37]

St. James–St. Andrew padyak has a documented subdivision corridor in Concepcion Grande. A historical ordinance also establishes special trimobile operating areas in the seven upper barangays. Special franchises are area constrained; do not offer any special tricycle as a city-wide ride by default. [S23, S25]

For each TODA/padyak association obtain current authorized roads, terminal location, regular/shared versus exclusive service rules, fare matrix, hours, permitted capacity, and available transfer points. No comprehensive current TODA registry was retrieved.

## Rail and on-demand services

PNR's official operations documentation links a Naga–Lupi Viejo timetable and 2026 order-of-day documents. That supports a corridor to investigate, but an older working timetable is not a current service guarantee. The community Bicol rail page reports Naga–Lupi Viejo operational and Naga–Legazpi suspended in October 2026. Verify directly with PNR before publishing either as live status. The 2025 PIA resumption report is historical. [S19–S21]

Grab lists Naga in its transport coverage. JoyRide coverage is supported by its PLDT partnership and a June 2026 report about JoyRide Car. Maxim has a Naga-specific operator contact page, but its public ordering page displays delivery wording. Verify passenger product availability before treating Maxim as a confirmed passenger option. Do not infer motorcycle taxi authorization from the existence of a local app office. Exact fare quotes were not obtained. [S14–S18]

## City-wide completeness audit

PSA lists 27 Naga barangays. Use all 27 as the survey checklist; a route touching a barangay does not mean every subdivision is served. [S22]

Abella, Bagumbayan Norte, Bagumbayan Sur, Balatas, Calauag, Cararayan, Carolina, Concepcion Grande, Concepcion Pequeña, Dayangdang, Del Rosario, Dinaga, Igualdad Interior, Lerma, Liboton, Mabolo, Pacol, Panicuason, Peñafrancia, Sabang, San Felipe, San Francisco, San Isidro, Santa Cruz, Tabuco, Tinago, Triangulo.

All 27 currently have “not surveyed” status in this package. Audit each for: trunk routes, feeder coverage, terminal/curb coordinates, both directions, fare evidence, hours, school/hospital access, rainy-season access and gaps at night. Areas without usable service must remain visible as coverage gaps.

## How to implement correct-side-of-road guidance

This section is a proposed design, not a claim that the required geometry has been collected.

1. Create a separate directed shape for each route, direction and operating revision. One-way downtown streets make a reversed outbound shape unreliable.
2. Represent each boarding curb as a distinct point linked to its road segment and directed route. Store road-facing side, permitted boarding/alighting, destination direction, landmark and photo.
3. Map sidewalks, terminal pedestrian entrances, median barriers, overpasses and approved crossings. The shortest straight line may put the passenger on an inaccessible curb.
4. Walk-route the passenger to a valid boarding point on the chosen direction. Evaluate crossing availability and walking distance when ranking trips.
5. Use GPS accuracy, heading and road geometry to judge position. If the accuracy envelope spans both curbs, say “Check the landmark/boarding photo” instead of claiming the user is on the wrong side.
6. Show “toward San Felipe,” “toward Centro” or a landmark cue; bare “left/right” depends on where the user faces. Display the intended vehicle direction as an arrow.
7. Prefer “stand beside [verified landmark]” and an evidence-backed boarding photo. Use notification/vibration only when location confidence supports it.
8. Exclude curbs where boarding is prohibited, even when a route passes nearby. A passing route does not establish a legal stop.

No exact curb or right-side instruction should be generated from the street lists alone. Do not use a whole-terminal centroid as a boarding coordinate. No live fleet feed or GPS tracking integration was found; estimated arrivals must not be advertised as real-time.

## Suggested app modules and data model

Consumer screens: destination search; map and nearby boarding points; compare trips; walk-to-boarding guide; vehicle/signboard identification; fare breakdown; transfer instructions; approaching-destination alert; saved home/work trips; offline route cards; disruptions; report a fare/route/stop correction.

Admin screens: source intake; route and revision editor; directional shape editor; curb/terminal-bay editor; fare matrix importer and approval; service-hours editor; survey review; discrepancy queue; disruptions with expiry; coverage audit; publication/version history.

| Entity | Essential fields |
|---|---|
| route | Stable ID, official name, local aliases, mode, operator, legal evidence |
| route_variant | Direction, signboard/headsign, directed shape, effective interval, observed operating status |
| boarding_point | Curb geometry, road segment, landmark, photo, direction, legal loading rules, GPS quality |
| route_boarding_point | Route variant, stop order, cumulative traveled distance, boarding/alighting permission |
| terminal / bay | Compound, pedestrian entrances, bay point, route assignments, hours |
| fare_rule / fare_matrix_row | Vehicle class, distance or stop-pair price, category, rounding, source, effective interval |
| service_window | Day type, first/last observed departure, dispatch model, headway sample and confidence |
| crossing / walk_edge | Directed pedestrian connection, median/barrier, stairs, accessibility, evidence |
| source / observation | URL/document/photo, published date, observed date, retrieved date, authority, reviewer |
| disruption | Affected revision/road/stop, interval, temporary replacement, source, automatic expiry |

Store money as integer centavos or exact decimal. Distance is along the actual directed transit shape, not aerial distance. Preserve source text, normalized names and correction history separately. Support regular/student/senior/PWD profiles without collecting unnecessary ID scans. Local solo-parent eligibility must be mode scoped. Null means unknown, not zero or free.

A planner can search walking + directed route + transfer graphs and return cheapest, least walking and fewest transfers. Scheduled rail and buses need verified timetables; unscheduled PUVs need observed service windows and wait ranges. An LLM can explain a verified itinerary but should not invent route edges, fares or curb locations.

## Verification and launch plan

1. Request the complete approved LPTRP/maps and all later amendments from the city transport/PSO/traffic/planning offices. Request current active route/CPC lists and fare matrices from LTFRB Region V. Obtain the TODA/special franchise registry and latest local matrix from the responsible city offices.
2. Visit BCS, Eastbound, LCC/Southbound, Northbound and the Centro clusters. Confirm the exact pedestrian entrance and every destination bay. Interview dispatchers and photograph displayed matrices with effective dates.
3. Ride each active direction/loop with GPS logging, including the ambiguous Roxas branch and Aureus/Mayflower sections. Record actual deviations, authorized curbs, signage and destination drop-off points. Confirm observed routes with operators and the city rather than silently replacing legal paths.
4. Survey feeders across all 27 barangays. For each service record regular and discounted fares, service window, full-load dispatch behavior and alternatives after the last trip. Repeat samples in weekday peaks, off-peak, evenings and weekends.
5. Publish a small verified network first, with clear coverage boundaries and report-correction tools. Expand until the barangay audit and all direction/feeder checks are complete. Monitor fare orders, traffic advisories and operator changes continuously.

Suggested release gate: every published route has reviewed geometry and current operational evidence; every recommended boarding point has a legal curb/entrance and direction; every exact fare has an applicable current matrix; every hours claim has recent operator or observed evidence; trial and event changes carry explicit status and expiry. This is a proposed quality gate, not evidence of completed checks.

Use the accompanying field_survey_template.csv to gather evidence. The JSON is a research seed, deliberately marked navigation_ready=false. A later stop update adds documentary candidates separately from surveyed boarding points. It is not a GTFS feed, and the empty boarding_points list must not be presented as a completed stop inventory.

## Source register

- [S01] [Naga approved LPTRP, Ordinance 2025-070](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2025-070/) — official; published/enacted: 2025-09-23; checked 2026-10-15.
- [S02] [Signed LPTRP ordinance PDF](https://www2.naga.gov.ph/wp-content/uploads/2025/10/Ordno-2025-070-Institutionalizing-the-Approved-LPTRP.pdf) — official; published/enacted: 2025-09-23; checked 2026-10-15.
- [S03] [Loop A/B Eastbound trial, Resolution 2025-735](https://www2.naga.gov.ph/sp_resolutions/2025-735/) — official; published/enacted: 2025-11-11; checked 2026-10-15.
- [S04] [Local minimum fare and discounts, Ordinance 2024-002](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2024-002/) — official; published/enacted: 2024-01-16; checked 2026-10-15.
- [S05] [PIA: implementation of updated PUV matrices](https://pia.gov.ph/news/luzon/ncr/ltfrb-reminds-puv-operators-drivers-to-display-updated-fare-matrix) — government_news; published/enacted: 2026-09-28; checked 2026-10-15.
- [S06] [PhilSTAR Life: September fare rates](https://philstarlife.com/news-and-views/486689-dotr-approves-puv-fare-hikes-effective-sept-28) — news; published/enacted: 2026-09-26; checked 2026-10-15.
- [S07] [Naga local fare reduction and padyak rates](https://www2.naga.gov.ph/riding-public-hails-naga-citys-reduction-of-transport-fare/) — official; published/enacted: 2022-10-11; checked 2026-10-15.
- [S08] [EASTTODA reported fares](https://naga.bomboradyo.com/easttoda-nagrereklamo-sa-ilegal-na-e-trike-at-habal-habal-kita-ng-mga-driver-bumagsak/) — news; published/enacted: 2026-06-22; checked 2026-10-15.
- [S09] [Bicol Central Station address](https://www2.naga.gov.ph/2023-city-service/request-for-terminal-pass/) — official; published/enacted: not established; checked 2026-10-15.
- [S10] [Southbound terminal, Ordinance 2021-087](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2021-087/) — official; published/enacted: 2021-11-16; checked 2026-10-15.
- [S11] [Northbound terminal, Ordinance 2016-034](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-2016-034/) — official_historical; published/enacted: 2016-06-24; checked 2026-10-15.
- [S12] [Terminal destination categories, Ordinance 2006-044](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-2006-044/) — official_historical; published/enacted: 2006-09-11; checked 2026-10-15.
- [S13] [2026 festival traffic advisory](https://tourism.naga.gov.ph/traffic-advisory-penafrancia-festival-parade-routes/) — official_event_only; published/enacted: not established; checked 2026-10-15.
- [S14] [Grab transport coverage](https://www.grab.com/ph/transport/) — operator; published/enacted: not established; checked 2026-10-15.
- [S15] [PLDT/JoyRide partnership and coverage](https://pldtenterprise.com/news-and-events/customer-partnerships/joyride-and-pldt-enterprise-partner-revolutionize-ride-hailing-operations) — partner; published/enacted: not established; checked 2026-10-15.
- [S16] [JoyRide Car 2026 coverage report](https://qa.philstar.com/business/motoring/2026/06/30/2538729/joyride-car-readies-higher-demand-amid-erratic-weather-conditions/amp/) — news; published/enacted: 2026-06-30; checked 2026-10-15.
- [S17] [Maxim Naga contact page](https://taximaxim.com/ph/en/8798-naga/contacts/) — operator; published/enacted: not established; checked 2026-10-15.
- [S18] [Maxim Naga ordering page](https://taximaxim.com/ph/en/8798-naga/order-a-taxi-online) — operator; published/enacted: not established; checked 2026-10-15.
- [S19] [PNR operating documents and timetable index](https://sites.google.com/pnr.gov.ph/operations/documentation) — official; published/enacted: not established; checked 2026-10-15.
- [S20] [PNR Bicol fan status page](https://sites.google.com/view/pnrbicolline/home) — community_unconfirmed; published/enacted: not established; checked 2026-10-15.
- [S21] [PIA historical rail resumption](https://pia.gov.ph/news/legazpi-naga-train-service-resumes/) — government_news_historical; published/enacted: 2025-03-05; checked 2026-10-15.
- [S22] [PSA Naga barangays](https://psa.gov.ph/classification/psgc/barangays/0501724000) — official; published/enacted: not established; checked 2026-10-15.
- [S23] [Special upper barangay trimobiles, Ordinance 1998-103](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-1998-103/) — official_historical; published/enacted: 1998-09-30; checked 2026-10-15.
- [S24] [Palmera-Cararayan, Ordinance 2020-052](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2020-052/) — official; published/enacted: 2020-06-09; checked 2026-10-15.
- [S25] [St. James-St. Andrew padyak, Ordinance 2022-009](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2022-009/) — official; published/enacted: 2022-01-25; checked 2026-10-15.
- [S26] [City transport ordinance index, including Deca route](https://www2.naga.gov.ph/transport-and-traffic/) — official_index; published/enacted: not established; checked 2026-10-15.
- [S27] [Para po intra-city mapping project](https://meta.wikimedia.org/wiki/WikiAdvocates/Programs/Para_po_Project/Intracity) — community; published/enacted: 2026-06-28; checked 2026-10-15.
- [S28] [Legacy transport code/colors](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-1993-049/) — official_historical; published/enacted: 1993; checked 2026-10-15.
- [S29] [Loop C/D trial amendment, Resolution 2025-172](https://www2.naga.gov.ph/sp_resolutions/2025-172/) — official; published/enacted: 2025-04-22; checked 2026-10-15.
- [S30] [Naga City Guide transport overview](https://www.nagacityguide.com/getting-around-naga-city-your-commuters-guide-to-tricycles-jeepneys-e-jeep-vans-ride-hailing-apps/) — secondary_outdated_fares; published/enacted: 2025-10-13; checked 2026-10-15.
- [S31] [PNA: temporary fare guides](https://www.pna.gov.ph/index.php/articles/1285005) — government_news_search_excerpt; published/enacted: 2026-09-28; checked 2026-10-15.

## Method and limits

Searched public government, operator, news and community pages; read the approved route text and PDF text; extracted route names, allocations and street orders; cross-checked newer fare announcements against older local material. Some pages/attachments and the LTFRB fare endpoint were unavailable. Search-only evidence is identified in the register. No private Facebook messages, authenticated booking sessions, field visits, GPS traces or fare transactions were accessed.

This research cannot honestly claim all current transportation options or all recent destination fares. The official city route plan is the strongest complete subset retrieved. The unresolved operational, fare and spatial fields are work items for an authoritative commuter dataset.

## Update: designated loading and unloading stops

Added 15 October 2026. The user reports newly placed signs along Magsaysay and Peñafrancia. That is retained as a corridor-level observation; exact sign positions and installation dates have not been supplied or independently verified.

**New documentary finding:** SafeTravelPH, a participant in Naga's LPTRP work, reports a formal-stop simulation on four loop routes from 28 August to 1 September 2025. Its September follow-up identifies an LGU stop schematic. I downloaded and visually inspected the original Loop A clockwise graphic and transcribed 30 labeled stop/landmark candidates. [S32–S34]

This supports the existence of a formal-stop pilot. It does not establish that every newly installed sign belongs to that pilot, that all 30 candidates remain active, or that all city PUV routes now share the same stops. Current physical installations and legal adoption still require the latest PSO register and field evidence.

### Thirty labels from the Loop A graphic

The lists below are grouped for reading. They are not a verified stop sequence or an exact road assignment. All labels refer to the clockwise Loop A schematic; do not reverse them automatically to produce Loop B curb locations. [S34]

| Corridor / diagram section | Labels to reconcile with current signs |
|---|---|
| Peñafrancia-facing portion and junction | San Francisco Church; USI; Cam High; BISCAST; Penafrancia–Magsaysay |
| Magsaysay-facing portion | UMA Residences; Starbucks; NCF Magsaysay; Philhealth; Villa Caceres; Magsaysay–Leon Aureus; Magsaysay–Mayflower; Rotonda |
| Lower circuit / downtown landmarks | Bennet’s Plaza; Mother Seton; Yashano; Robinsons; Pag-Ibig ALDP; S&R; Esplanade; Fraternidad St.; Biak Na Bato St.; Boning’s Trading; Plaza Rizal |
| Dashed sections in the schematic | Civic Center; City Hall; BFP; PNR Rd.; Bus Terminal; Landers/STI |

Raw spellings from the graphic are retained in JSON/CSV. Abbreviations and business names need address confirmation. “Rotonda” is ambiguous. “PNR Rd.” is a road label, not automatically the PNR railway station. The dashed line's exact meaning is not specified in the graphic: do not infer optional service or dispatch frequency from its appearance. The source does not separately define boarding-only versus alighting-only permissions.

### Other stop and planning evidence

- A PSO public Facebook post has an indexed reference to designated stops, but the full post/attachments could not be retrieved. Keep this as a primary-source lead, not a transcribed stop list. [S35]
- A 16 January 2026 report describes further loading-zone planning for CBD 1/2, Peñafrancia, Jacob and M.T. Villanueva. It establishes ongoing planning, not a completed location inventory. [S36]
- Ordinance 2025-067 specifies existing waiting areas in Deca Vistansa and Cararayan Proper for VISTODA/LAVISTODA. These are two additional documented waiting-area candidates, separate from the loop graphic. The feeder lead in the earlier dataset is updated to reflect this newer instrument. [S37]
- The city's indexed M.T. Villanueva redevelopment announcement describes future passenger loading areas with completion targeted for May 2027. The full page was unavailable. Track this as a planned/redevelopment corridor, not proof of operational stops today. [S38]

### App and survey changes

The package now includes designated_stop_candidates.csv and a designated_stop_candidates JSON collection: 30 Loop A labels plus two special-trimobile waiting areas. Every candidate is marked navigation_ready=false and has unknown coordinates/curb permissions. The existing boarding_points collection remains reserved for surveyed, approved points.

Add a stop status lifecycle: candidate → documentary designation → physically installed → field verified → published, with separate temporary/relocated/retired states. Legal designation and physical installation are independent evidence fields.

Each actual sign should record: official stop ID; verbatim text; location/photo; road-facing side; allowed modes/routes; boarding/alighting permissions; sign condition; revision/effective dates; and any replaced stop. Store opposite curbs separately, even where they share a landmark name. Check temporary restrictions and construction relocation. An app must never infer that passing a sign permits every route or mode to use it.

Next authoritative intake: latest PSO/Traffic Management Division stop register and map, SimEx stop list and evaluation, subsequent adoption/relocation decisions, and current corridor signs. Validate Magsaysay and Peñafrancia first, then audit all route variants. No stop count for the full city is established by this research.

### Additional sources

- [S32] [SafeTravelPH Naga formal-stop simulation](https://www.safetravelph.org/post/naga-city-gets-support-from-safetravelph-for-ptmp-route-simulation-exercise) — project_participant; date: 2025-08-18; updated 2025-09-09; checked 2026-10-15.
- [S33] [SafeTravelPH report with LGU Loop A stop graphic](https://www.safetravelph.org/post/jeepney-modernization-needs-more-than-formulas-initial-lessons-from-naga-city) — project_participant; date: 2025-09-10; updated 2025-09-23; checked 2026-10-15.
- [S34] [LGU-branded Loop A clockwise stop schematic hosted by SafeTravelPH](https://static.wixstatic.com/media/17915d_39dfca6796bc46f9b910a654ad7a67b8~mv2.png) — LGU_branded_graphic_via_project_participant;visually_inspected; date: not established; checked 2026-10-15.
- [S35] [PSO designated-stop public post](https://www.facebook.com/nagacitypublicsafetyoffice/posts/767253932516108/) — official_social_search_excerpt;full_post_unavailable; date: not established; checked 2026-10-15.
- [S36] [January 2026 loading-zone planning report](https://streetjournalms.com/naga-city-rolls-out-multi-pronged-plan-to-ease-traffic-congestion/) — news; date: 2026-01-16; checked 2026-10-15.
- [S37] [VISTODA/LAVISTODA waiting stations, Ordinance 2025-067](https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2025-067/) — official; date: 2025-09-09; checked 2026-10-15.
- [S38] [M.T. Villanueva redevelopment and future loading areas](https://www2.naga.gov.ph/underground-cabling-road-redevelopment-of-m-t-villanueva-ave-set-for-may-2027-completion/) — official_search_excerpt;full_page_unavailable; date: not established; checked 2026-10-15.

## Update: public Google My Maps stop records found

Retrieved 15 October 2026. A public “Virtual Map” link in indexed transport simulation announcements resolves to **Naga City Designated Stops** in Google My Maps. The public viewer and its KML export were fetched successfully without sign-in. The search reader could not render the map, so its public metadata and KML were read directly. [S39–S42]

Map link: https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4

Short link shared in announcements: https://maps.app.goo.gl/fZF4ns7mwE4gqG479?g_st=ic

The public metadata displays owner name **Tan Gumba**. This is a display name, not independently verified identity or official position. No evidence retrieved establishes that Allen Reondanga created the map. He may have shared it, but that attribution remains unconfirmed.

| Source layer | Point records |
|---|---:|
| Loop Service A | 30 |
| Loop Service B | 31 |
| Loop Service C | 34 |
| Loop Service D | 33 |
| Total | 128 |

There are **114 exactly distinct coordinate pairs**. This does not mean 114 distinct physical stops: exact shared coordinates and very close pins across layers need reconciliation. All 128 route-layer records are retained. The KML contains Point geometries, with no route LineString geometries. Pin coordinates are now available; current legal curb permissions and physical signs remain unverified.

### Examples: source pins around Peñafrancia and Magsaysay

| Layer/code | Source description | Latitude | Longitude |
|---|---|---:|---:|
| Loop Service A/A5 | BISCAST | 13.6314651 | 123.1927517 |
| Loop Service B/B27 | BISCAST | 13.6315759 | 123.192658 |
| Loop Service A/A6 | Cor. Peñafrancia Ave & Magsaysay Ave. | 13.6328896 | 123.1942656 |
| Loop Service B/B26 | Cor. Peñafrancia Ave & Magsaysay Ave | 13.6329889 | 123.1941831 |
| Loop Service A/A7 | Avenue Hotel/UMA Residence | 13.632102 | 123.1958976 |
| Loop Service B/B25 | Avenue Hotel/UMA Residence | 13.6321528 | 123.1960653 |
| Loop Service A/A9 | NCF Magsaysay | 13.6299067 | 123.1979773 |
| Loop Service B/B23 | NCF Magsaysay | 13.6299849 | 123.1980793 |
| Loop Service A/A10 | Westpark/Philhealth | 13.6292228 | 123.1985007 |
| Loop Service B/B22 | Westpark/Philhealth | 13.6292459 | 123.198745 |

The differing coordinates for matching A/B landmarks provide useful evidence for separate directional pins. They do not by themselves prove legal curb placement, road-facing side or current operation. Project these onto the surveyed road/curb and check the actual signs before issuing “cross the road” guidance.

### Import details and corrections to previous gaps

- `naga_mapped_stops_source.kml`: downloaded public source export.
- `naga_mapped_stops.geojson`: all 128 Point features with source layer, source stop code, description, direction and verification status.
- `naga_mapped_stops.csv`: tabular version of those pins.
- `naga_transport_seed.json`: retains earlier documentary candidates and adds `mapped_stop_records` and `public_stop_map` metadata.

The earlier statement that no stop coordinates were retrieved is superseded for this four-layer public map. The statement that no surveyed/approved boarding points were collected remains true. `boarding_points` is still reserved for verified navigational points.

Do not infer stop sequence from KML order. Some C/D layer records use A/B stop codes, so stop code alone is not globally unique and its prefix does not necessarily identify the route. Preserve the source layer and create a separate internal identifier. Reconcile the map with the newer Eastbound route change before assuming that the snapshot includes those stops. Do not use this four-loop map as an all-city/all-mode stop registry.

The source graphic and Google map are separate versions. They differ in labels: for example, the map includes a Magsaysay/Dayangdang junction and describes Westpark/Philhealth. Do not overwrite either source to force a match. Keep raw labels, and reconcile names and relocations through a reviewed crosswalk.

### New sources

- [S39] [Naga City Designated Stops – public Google My Maps](https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4) — public_map;metadata_and_points_retrieved; checked 2026-10-15.
- [S40] [Public Google My Maps KML export](https://www.google.com/maps/d/kml?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4&forcekml=1) — public_export;retrieved_and_parsed; checked 2026-10-15.
- [S41] [SimEx announcement sharing Virtual Map](https://www.facebook.com/groups/HowsYourByaheBes/posts/2096521480872101/) — indexed_social_announcement;full_page_unavailable; checked 2026-10-15.
- [S42] [Asintado SimEx update sharing same map](https://www.facebook.com/100050332366551/photos/1367446708276395/) — indexed_social_announcement;full_page_unavailable; checked 2026-10-15.
