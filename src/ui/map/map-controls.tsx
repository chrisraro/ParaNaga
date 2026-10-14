"use client";

// Glass map controls (map design brief §1): zoom capsule top-right, locate/recenter capsule
// under it. Rendered outside the Leaflet container so map gestures never swallow taps.

type Props = {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate?: (() => void) | undefined;
};

export function MapControls({ canZoomIn, canZoomOut, onZoomIn, onZoomOut, onLocate }: Props) {
  return (
    <div className="pn-map-controls">
      <div className="pn-glass pn-capsule" role="group" aria-label="Zoom">
        <button
          type="button"
          className="pn-ctl pn-ctl--zoom"
          aria-label="Zoom in"
          disabled={!canZoomIn}
          onClick={onZoomIn}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M9 3v12M3 9h12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <span className="pn-divider" aria-hidden="true" />
        <button
          type="button"
          className="pn-ctl pn-ctl--zoom"
          aria-label="Zoom out"
          disabled={!canZoomOut}
          onClick={onZoomOut}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M3 9h12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {onLocate ? (
        <div className="pn-glass pn-capsule">
          <button
            type="button"
            className="pn-ctl pn-ctl--locate"
            aria-label="Center on my location"
            onClick={onLocate}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" fill="currentColor" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
