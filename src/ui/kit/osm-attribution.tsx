// OpenStreetMap attribution (ODbL 1.0, data/source/osm/README.md). Rendered on every list, card
// and detail that shows an OpenStreetMap place, next to the "OpenStreetMap" source badge
// (StatusBadge variant "osm"). A left-aligned footnote, never a pill or a button.

import "./styles";

export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const OSM_ATTRIBUTION_TEXT = "© OpenStreetMap contributors (ODbL)";

export function OsmAttribution({ testId }: { testId?: string }) {
  return (
    <p className="pn-note-plain" data-testid={testId}>
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
        {OSM_ATTRIBUTION_TEXT}
      </a>
    </p>
  );
}
