import type { FixQuality, LocationFix } from "@/domain/geo/location-fix";
import type { StopPin } from "@/domain/api/schemas";
import type { Bounds, LatLng } from "@/domain/geo/types";

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
  /** Mapped stop pins to draw (one canvas layer). Never joined by lines. */
  stopPins?: readonly StopPin[];
  /** Whether tapping a stop pin selects it (false while placing a pin). */
  stopPinsInteractive?: boolean;
  onStopSelect?: (stopId: string) => void;
  /** Fires once when the map is ready and after every move, with the visible bounds. */
  onBoundsChange?: (bounds: Bounds) => void;
  /** Fixed centre pin for "Choose on map". */
  crosshair?: boolean;
  /** Fires once when the map is ready and after every move. */
  onCenterChange?: (center: LatLng, insideCity: boolean) => void;
  /**
   * Change this number to recentre: on the user fix when it is inside Naga, else Plaza Rizal.
   * Invariant: it starts at 0 and only ever increases for the lifetime of the screen that owns it.
   * The map treats any value other than 0 seen at mount as a pending request (so a recentre asked
   * for before this lazily loaded map existed still runs); a map remounted under a screen whose
   * signal is already above 0 would therefore replay the last recentre once.
   */
  recenterSignal?: number;
  /** When set, the next recentre goes here (inside Naga) instead of to the user fix. */
  recenterTarget?: LatLng | null;
  /** How the recentre announcement names `recenterTarget` (default "the start pin"). */
  recenterTargetLabel?: string;
  /** Shows the locate/recenter button; the parent decides whether to start GPS. */
  onLocate?: () => void;
  className?: string;
};
