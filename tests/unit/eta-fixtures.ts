import type { EtaModel } from "@/domain/api/schemas";
import type { EtaOptionInput } from "@/domain/eta/eta";

/** The published time-estimate model (modes-lines-2026-10-16), as in the snapshot. */
export const ETA_MODEL: EtaModel = {
  timeZone: "Asia/Manila",
  utcOffsetMinutes: 480,
  params: [
    {
      key: "jeepney_speed_offpeak_kmh", low: 10, high: 15, unit: "km_per_h", windows: null, days: null, appliesTo: ["jeepney"],
      isAssumption: false, assumptionNote: null,
      basis: "Naga baseline about 10 km/h (SafeTravelPH SimEx); comparable-city observed upper about 15 km/h (Puerto Princesa)",
      sourceCodes: ["N16", "N29"],
    },
    {
      key: "jeepney_speed_peak_kmh", low: 7, high: 13, unit: "km_per_h", windows: null, days: null, appliesTo: ["jeepney"],
      isAssumption: true,
      assumptionNote: "A2: the low end (7 km/h) is 30% below the Naga ~10 km/h baseline, an assumption; the high end (13) is N29's 13.3 rounded down",
      basis: "High end from N29 (observed peak 13.3 km/h); low end assumption A2",
      sourceCodes: ["N29"],
    },
    {
      key: "peak_windows", low: null, high: null, unit: "windows",
      windows: [{ start: "06:00", end: "08:00" }, { start: "11:00", end: "13:00" }, { start: "16:00", end: "19:00" }],
      days: "every_day", appliesTo: ["jeepney"], isAssumption: true, assumptionNote: "A3: applied every day; no day-of-week source",
      basis: "Ordinance 2025-110 peak-hour truck ban on Roxas Ave (Asia/Manila)", sourceCodes: ["N04"],
    },
    {
      key: "walk_slowdown_factor", low: 1, high: 1.25, unit: "factor", windows: null, days: null, appliesTo: ["walk"],
      isAssumption: true, assumptionNote: "A1: crossings, waiting at roads, slower walkers (high end = low end × 1.25); no source",
      basis: "ParaNaga assumption A1", sourceCodes: [],
    },
    {
      key: "walk_speed_kmh", low: 4.238, high: 4.238, unit: "km_per_h", windows: null, days: null, appliesTo: ["walk"],
      isAssumption: false, assumptionNote: null, basis: "Observed pedestrian walking speed", sourceCodes: ["N28"],
    },
  ],
};

/** A Manila wall-clock time on 2026-10-16 as a Date (fixed +08:00). */
export const manila = (hhmm: string) => new Date(`2026-10-16T${hhmm}:00+08:00`);

export const walk = (estimateMeters: number) => ({ kind: "walk" as const, estimateMeters });
export const jeep = (distanceMeters: number, distanceBasis: "approximate_path" | "stop_to_stop_straight_line" = "approximate_path") => ({
  kind: "ride" as const, mode: "jeepney" as const, distanceMeters, distanceBasis,
});
export const trike = (distanceMeters: number) => ({
  kind: "ride" as const, mode: "tricycle" as const, distanceMeters, distanceBasis: "stop_to_stop_straight_line" as const,
});
export const opt = (...legs: EtaOptionInput["legs"]): EtaOptionInput => ({ legs });
