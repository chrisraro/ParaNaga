// The five time-estimate parameter keys (D8/D9): the single list used by the seed parser, the
// importer, the API schemas and migration 0007's checks (kept in sync by hand there). Pure.
export const ETA_PARAM_KEYS = [
  "walk_speed_kmh", "walk_slowdown_factor", "jeepney_speed_offpeak_kmh", "jeepney_speed_peak_kmh", "peak_windows",
] as const;
export type EtaParamKey = (typeof ETA_PARAM_KEYS)[number];
