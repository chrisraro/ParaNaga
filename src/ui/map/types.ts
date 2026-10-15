import type { FixQuality, LocationFix } from "@/domain/geo/location-fix";
import type { LatLng } from "@/domain/geo/types";

export type NagaMapPins = { start?: LatLng; destination?: LatLng };

/** A stop to highlight for a trip (boarding or getting off). Drawn as a marker, never joined by a line. */
export type HighlightStop = { id: string; lat: number; lng: number; role: "board" | "alight"; label: string };

export type NagaMapProps = {
  /** Latest GPS fix. Never panned to, and not drawn, when it is outside Naga City. */
  userFix?: LocationFix | null;
  /** Overrides the quality derived from `userFix.accuracy`. */
  userQuality?: FixQuality;
  /** The fix is old: the dot is drawn dimmed and without the live pulse. */
  userStale?: boolean;
  pins?: NagaMapPins;
  /** Trip stops to highlight; when the set changes the map fits them (and the pins) into view. */
  highlightStops?: readonly HighlightStop[];
  /** Bottom padding (px) when fitting highlighted stops, e.g. the part of the map under a sheet. */
  highlightPaddingBottom?: number;
  /** Fixed centre pin for "Choose on map". */
  crosshair?: boolean;
  /** Fires once when the map is ready and after every move. */
  onCenterChange?: (center: LatLng, insideCity: boolean) => void;
  /** Change this number to recentre: on the user fix when it is inside Naga, else Plaza Rizal. */
  recenterSignal?: number;
  /** When set, the next recentre goes here (inside Naga) instead of to the user fix. */
  recenterTarget?: LatLng | null;
  /** Shows the locate/recenter button; the parent decides whether to start GPS. */
  onLocate?: () => void;
  className?: string;
};
