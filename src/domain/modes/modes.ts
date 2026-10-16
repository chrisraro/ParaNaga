// Mode visual system metadata: classes, modes, display names, map chip abbreviations, and visual
// key mapping (Task 11). Pure: no DOM, no I/O.
import {
  COLOUR_KEYS,
  COOPERATIVE_BASES,
  FLEET_EVIDENCE_LEVELS,
  FLEET_STATUSES,
  ROUTE_MODES,
  VEHICLE_CLASSES,
  classLabel,
  colourKey,
  cooperativeLabel,
  fleetChip,
  fleetLabel,
  fleetSummary,
  modeName,
  monthYear,
  operatingStatusLabel,
  type ColourKey,
  type CooperativeBasis,
  type FleetClass,
  type FleetEvidenceLevel,
  type FleetRecord,
  type FleetStatus,
  type FleetSummary,
  type RouteMode,
  type VehicleClass,
} from "./fleet";
import { PALETTE_KEYS, type PaletteKey } from "./palette";

export {
  COLOUR_KEYS,
  COOPERATIVE_BASES,
  FLEET_EVIDENCE_LEVELS,
  FLEET_STATUSES,
  ROUTE_MODES,
  VEHICLE_CLASSES,
  classLabel,
  colourKey,
  cooperativeLabel,
  fleetChip,
  fleetLabel,
  fleetSummary,
  modeName,
  monthYear,
  operatingStatusLabel,
  type ColourKey,
  type CooperativeBasis,
  type FleetClass,
  type FleetEvidenceLevel,
  type FleetRecord,
  type FleetStatus,
  type FleetSummary,
  type RouteMode,
  type VehicleClass,
};

export const VISUAL_KEYS = PALETTE_KEYS;
export type VisualKey = PaletteKey;

/** Full human-readable display name for each visual key (chips, legend, lists). */
export const MODE_DISPLAY_NAMES: Record<VisualKey, string> = {
  traditional_puj: "Traditional jeepney",
  modern_puj: "Modern jeepney",
  mixed_trad_modern: "Traditional and modern jeepneys",
  tricycle: "Tricycle",
  e_tricycle: "E-tricycle",
  uv_express: "UV Express",
  bus: "Bus",
  unconfirmed: "Jeepney · type not confirmed",
  walk: "Walk",
  rail: "Train",
};

/** Short map-chip abbreviation placed at mid-leg on the map (Global Constraints table). */
export const MAP_CHIP_TEXT: Record<VisualKey, string> = {
  traditional_puj: "Jeep",
  modern_puj: "Modern",
  mixed_trad_modern: "Jeep + Modern",
  tricycle: "Trike",
  e_tricycle: "E-trike",
  uv_express: "UV",
  bus: "Bus",
  unconfirmed: "Jeep ?",
  walk: "Walk",
  rail: "Train",
};

export function visualKeyForClass(vehicleClass: VehicleClass): VisualKey {
  return vehicleClass;
}

export function visualKeyForColourKey(key: ColourKey): VisualKey {
  return key;
}

export function visualKeyForMode(mode: RouteMode): VisualKey {
  switch (mode) {
    case "jeepney":
      return "traditional_puj";
    case "tricycle":
      return "tricycle";
    case "uv_express":
      return "uv_express";
    case "bus":
      return "bus";
    case "rail":
      return "rail";
  }
}

export function resolveVisualKey(input: VisualKey | RouteMode): VisualKey {
  if (input === "jeepney") return "traditional_puj";
  return input;
}
