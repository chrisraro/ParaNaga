import type { Ref } from "react";
import type { FixQuality, LocationFix } from "@/domain/geo/location-fix";
import type { Line, StopPin } from "@/domain/api/schemas";
type TracedLine = Line;
import type { Bounds, LatLng } from "@/domain/geo/types";
import type { VisualKey } from "@/domain/modes/modes";
import type { MapSurface } from "@/domain/modes/palette";
import type { MapTerminal } from "./terminals-layer";
import type { TripLinesData } from "./trip-lines-layer";

export type NagaMapPins = { start?: LatLng; destination?: LatLng };

/** A stop to highlight for a trip (boarding or getting off). Drawn as a marker. */
export type HighlightStop = { id: string; lat: number; lng: number; role: "board" | "alight"; label: string };

export type NagaMapProps = {
  /** Latest GPS fix. Never panned to, and not drawn, when it is outside Naga City. */
  userFix?: LocationFix | null;
  /** Overrides the quality derived from `userFix.accuracy`. */
  userQuality?: FixQuality;
  /** The fix is old: the dot is drawn dimmed and without the live pulse. */
  userStale?: boolean;
  pins?: NagaMapPins;
  /** Trip stops to highlight; when the set changes the map fits them (and the pins / trip lines) into view. */
  highlightStops?: readonly HighlightStop[];
  /** Bottom padding (px) when fitting highlighted stops, e.g. the part of the map under a sheet. */
  highlightPaddingBottom?: number;
  /** Change (e.g. the sheet's snap) to re-fit the current highlights / route into the visible map. */
  refitSignal?: number;
  /** Announced once each time `fitBoundsCoords` is fitted anew (a snap re-fit stays silent). */
  fitAnnouncement?: string;
  /** Mapped stop pins to draw (one canvas layer). */
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
   */
  recenterSignal?: number;
  /** When set, the next recentre goes here (inside Naga) instead of to the user fix. */
  recenterTarget?: LatLng | null;
  /** How the recentre announcement names `recenterTarget` (default "the start pin"). */
  recenterTargetLabel?: string;
  /** Shows the locate/recenter button; the parent decides whether to start GPS. */
  onLocate?: () => void;
  /** Shows the 48×48 px "Layers" button in Stack A (Task 12). */
  onOpenLayers?: (() => void) | undefined;
  layersButtonRef?: Ref<HTMLButtonElement>;
  /** Trip walk + ride polylines, chevrons, and mid-leg chips (Task 12). */
  tripLines?: TripLinesData | null;
  /** The option leg the guidance is on: its line is drawn at full strength, the others softer. */
  activeLegIndex?: number | null;
  /** Line for the legend panel (e.g. the trip's lines did not load). */
  legendNotice?: string | null;
  /** Overview lines are only a stand-in for the trip's rides: drawn dimmed and not tappable. */
  routeLinesDimmed?: boolean;
  /** False in guidance: the map follows the current step's stops, not the whole trip. Default true. */
  fitTripLines?: boolean;
  /** Route overview or route-detail polylines (Task 12). */
  routeLines?: readonly TracedLine[] | null;
  /** Route code currently selected in the overview or route detail. */
  selectedRouteCode?: string | null;
  onSelectRoute?: ((routeCode: string) => void) | null;
  /** When true (route detail), draws direction chevrons every 250 m along `routeLines`. */
  showRouteChevrons?: boolean;
  /** Terminals with a coordinate to draw (Task 13); terminals without one are never drawn. */
  terminals?: readonly MapTerminal[] | null;
  /** False on terminal detail: markers show where the terminal is and open nothing. */
  terminalsInteractive?: boolean;
  onTerminalSelect?: ((code: string) => void) | null;
  /** The terminal a tricycle hint names (D15): its marker is emphasized. */
  emphasizedTerminalCode?: string | null;
  /** Optional polyline coordinates to fit into view when they change (e.g. route detail variant). */
  fitBoundsCoords?: readonly LatLng[] | null;
  /** Visual keys to show in the collapsible `MapLegend` above the attribution (Task 11/12). */
  legend?: readonly VisualKey[] | null;
  /** Explicit map surface override; otherwise derived from `mapSurface(effectiveTheme, tilesDrawn)`. */
  mapSurface?: MapSurface;
  className?: string;
  /** Where the map opens (default: Naga City centre at the default zoom). Read once, at mount. */
  initialView?: { center: LatLng; zoom: number };
  /** One place marker in the destination style (place detail), named for screen readers. */
  placeMarker?: { point: LatLng; label: string };
  /** Accessible name of the map region (default "Map of Naga City"). */
  label?: string;
};
