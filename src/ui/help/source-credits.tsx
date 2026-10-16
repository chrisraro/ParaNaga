"use client";

import { PLACE_PHOTOS } from "@/domain/media/photos";
import { SOURCE_RIGHTS } from "@/domain/sources/rights";
import { externalHref } from "@/domain/sources/present";
import { attributionParts, currentTileConfig } from "@/client/map/tile-config";
import { ReferencePhoto } from "@/ui/places/reference-photo";
import { GOOGLE_ATTRIBUTION, GOOGLE_DAILY_CAP } from "@/domain/places/google";

export function SourceCredits({ revisionId }: { revisionId?: string }) {
  const tile = currentTileConfig();
  return (
    <div className="pn-detail__stack" data-testid="source-credits">
      <section aria-labelledby="data-licenses">
        <h2 id="data-licenses" className="pn-section__title">Data licenses and map credits</h2>
        <p className="pn-footnote">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. OSM source data and ParaNaga databases derived from it are available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database License 1.0</a>.</p>
        <p className="pn-footnote">{tile.url ? "Configured basemap credits: " : "No production basemap provider configured. "}{attributionParts(tile.attribution).map((part, i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : <span key={i}>{part.text}</span>)}</p>
        <ul className="pn-group">
          <li className="pn-source"><a href="/data/attribution/naga-places-2026-10-16.osm.json" download>Download OSM places source extract (16 Oct 2026)</a></li>
          <li className="pn-source"><a href="/data/attribution/naga-roads-2026-10-16.osm.json" download>Download OSM roads source extract (16 Oct 2026)</a></li>
          <li className="pn-source"><a href="/data/attribution/naga-city-boundary.json" download>Download OSM Naga boundary (relation 3084673)</a></li>
          <li className="pn-source"><a href="/data/attribution/NOTICE.txt">Read data license and transformation notice</a></li>
          {revisionId ? <>
            <li className="pn-source"><a href={`/api/v1/network/lines/${encodeURIComponent(revisionId)}`}>Current derived OSM route lines (JSON)</a></li>
            <li className="pn-source"><a href={`/api/v1/network/walk-graph/${encodeURIComponent(revisionId)}`}>Current derived OSM walking graph (JSON)</a></li>
          </> : null}
        </ul>
        <p className="pn-footnote">These licenses cover the named data or photo component, not the entire app. Source credits do not imply endorsement. Article links are factual references, not permission to republish articles or images.</p>
      </section>
      <section aria-labelledby="software-credits">
        <h2 id="software-credits" className="pn-section__title">Fonts and open-source software</h2>
        <p className="pn-footnote">Geist Sans and Geist Mono © The Geist Project Authors, used under the SIL Open Font License 1.1. Next.js, React, Leaflet and other dependencies retain their respective licenses.</p>
        <p><a href="/licenses/Geist-OFL.txt">Geist copyright and full font license</a></p>
        <p><a href="/licenses/THIRD-PARTY-NOTICES.txt">Third-party copyright and license notices</a></p>
      </section>
      <section aria-labelledby="street-view-credits">
        <h2 id="street-view-credits" className="pn-section__title">Google Street View</h2>
        <p className="pn-footnote">Interactive panoramas are provided directly by Google Maps through Maps Embed API, only after you open the viewer. Google and imagery-provider attribution remains inside the viewer. Coverage, image dates, signs and boarding curbs are not verified by ParaNaga. No Street View imagery is downloaded or cached by ParaNaga.</p>
        <p><a href="https://www.google.com/intl/en-US_US/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google Maps terms</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google privacy policy</a></p>
      </section>
      <section aria-labelledby="google-places-credits" data-testid="google-places-credits">
        <h2 id="google-places-credits" className="pn-section__title">Google Places suggestions</h2>
        <p className="pn-footnote">{GOOGLE_ATTRIBUTION}. When search on this phone finds fewer than 3 matches, or you tap “Search more places”, Google receives what you typed, through ParaNaga’s server, to suggest places. ParaNaga keeps Google’s answer up to 24 hours under a one-way hash, with no typed text and no IP address. Google results are third-party and not verified; a pick only places a pin on this map. At most {GOOGLE_DAILY_CAP} Google requests are made a day, then only OpenStreetMap results are shown.</p>
        <p className="pn-footnote">Rights note: whether Google’s terms allow these suggestions beside a non-Google map is unresolved.</p>
        <p><a href="https://cloud.google.com/maps-platform/terms" target="_blank" rel="noopener noreferrer">Google Maps Platform terms</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google privacy policy</a></p>
      </section>
      <section aria-labelledby="photo-credits">
        <h2 id="photo-credits" className="pn-section__title">Photo credits and capture dates</h2>
        <p className="pn-footnote">Each photo keeps its creator, source and license. Capture dates describe the image, not a recent site inspection. Images may be resized and cropped in cards; adaptations retain their source license. No Google Maps or Street View screenshots are redistributed.</p>
        <p><a href="/media/places/CREDITS.json" download>Download photo attribution manifest</a></p>
        <ul className="pn-group" data-testid="photo-credits">
          {PLACE_PHOTOS.map((photo) => <li key={photo.id} id={photo.id} className="pn-source" data-testid="photo-credit"><ReferencePhoto photo={photo} full /></li>)}
        </ul>
      </section>
      <details className="pn-source" data-testid="research-rights">
        <summary>Full research register and reuse notes ({SOURCE_RIGHTS.length} sources)</summary>
        <p className="pn-footnote">Includes background research and excluded evidence, which may not be cited by the current published revision. Rights notes checked 16 Oct 2026. Unresolved permissions are identified separately; source availability alone is not a reuse license.</p>
        <ul className="pn-group">
          {SOURCE_RIGHTS.map((source) => {
            const href = externalHref(source.url);
            return <li key={source.code} className="pn-source" data-rights={source.status}>
              <strong>{source.code} · {source.title}</strong>
              <span className="pn-source__meta">{source.publisher} · {source.license}</span>
              <span className="pn-source__meta">{source.use}</span>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer">Original source</a> : <span>No public link offered</span>}
              {source.licenseUrl ? <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">License or legal basis</a> : null}
            </li>;
          })}
        </ul>
      </details>
    </div>
  );
}
