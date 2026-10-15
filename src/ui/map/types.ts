import type { FixQuality, LocationFix } from "@/domain/geo/location-fix";
import type { LatLng } from "@/domain/geo/types";

export type NagaMapPins = { start?: LatLng; destination?: LatLng };

export type NagaMapProps = {
  /** Latest GPS fix. Never panned to, and not drawn, when it is outside Naga City. */
  userFix?: LocationFix | null;
  /** Overrides the quality derived from `userFix.accuracy`. */
  userQuality?: FixQuality;
  /** The fix is old: the dot is drawn dimmed and without the live pulse. */
  userStale?: boolean;
  pins?: NagaMapPins;
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
