# Source reuse audit — 16 October 2026

This records the implemented controls and unresolved evidence. It is not a certification that the app or every upstream source is legally cleared.

| Component | Use and basis | App treatment |
|---|---|---|
| OpenStreetMap places, boundary, roads, terminals, relations, walking graph and traced lines | OSM contributors; ODbL 1.0 | Visible map/data credit, license link, source extracts, and per-revision derivative downloads. The ODbL covers its database component, not unrelated source data or app code. |
| Ordinances and resolutions | Official legal text; Philippine RA 8293 §175 | Factual/legislative references, linked to originals. This does not clear copyrighted third-party graphics attached to a legal text. |
| Government news, PSA, commercial services, newspapers, radio, research papers, community and fan reports | Facts-only research and citations | No general republication grant assumed. Article prose, logos and photographs are not copied into new app assets. Government publication alone is not a blanket grant: §176 contains commercial-use and third-party-work qualifications. |
| Public My Maps pins and SafeTravelPH stop graphic | Rights/provenance unresolved | Explicit notes in the catalog and a failing strict release gate. Existing imports need permission or replacement. |
| Commons photos | Each selected file's own CC BY-SA license; named creator retained | Creator, title, original source, capture date, license and changes displayed; WebP derivatives retain the same license. Metadata-only Jev rankings plus visual inspection; six low-confidence choices have explicit user approval. |
| Google Maps / Street View | Subject to Google's terms and product-specific restrictions | Manual coordinate links only. No screenshots or third-party Google photos downloaded, no scraped reviews, no extracted navigation dataset, no removed attribution. |
| MapTiler / other basemaps | Provider-specific terms and required credits | Known mandatory credits retained. Unknown production provider without credits disabled. Existing service-worker policy keeps cross-origin tiles out of offline caches. Account entitlement still requires owner verification. |
| Geist Sans / Mono | SIL OFL 1.1 | Full copyright/license file served and linked in Sources. |
| Software dependencies | Installed, locked package metadata and full notice/license texts where supplied | 711 package entries inventoried, including development tools. Three Triplit exact-version declarations remain unresolved; they were not found in current production traces. Notices are not a substitute for an exact-version license grant. |

Primary references checked:

- [OSM copyright and license](https://www.openstreetmap.org/copyright), [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/).
- [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), plus each file's own description page in the attribution manifest. Required notices and changes must remain with reuse; adaptations retain compatible share-alike terms. No uploader endorsement is implied.
- [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/), [Google Maps additional terms](https://www.google.com/intl/en-US_US/help/terms_maps/), [Street View API policies](https://developers.google.com/maps/documentation/streetview/policies).
- [RA 8293, §§175–176](https://lawphil.net/statutes/repacts/ra1997/ra_8293_1997.html). This is the basis for the limited official-text treatment, not an assertion that all government-hosted media is unrestricted.
- [MapTiler required attribution](https://www.maptiler.com/copyright/), [Geist OFL](https://github.com/vercel/geist-font/blob/main/OFL.txt), [Triplit upstream license](https://github.com/aspen-cloud/triplit/blob/main/LICENSE). The last link does not resolve exact-version package terms.

Refresh policy: preserve the original source URL, capture date, author, license and restrictions; inspect the actual image and verify site identity. Store Jev's actual decision and any human approval. Do not change `permission_required` simply because a source is public or cited. New permission records must identify the rights holder, scope, date and durable evidence, and address third-party underlying content. Run the integrity and strict release checks after every source change.
