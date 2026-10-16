// "How times are estimated": the basis rows, built from the revision's time-estimate model (J3,
// D8–D11). Each row names its sources and which ends are assumptions. Pure.
import type { EtaModel, EtaParam } from "../api/schemas";
import type { EtaParamKey } from "./params";

export type BasisRowKey = "walk" | "jeepney_offpeak" | "jeepney_peak" | "peak_windows" | "waiting" | "traffic";

export type BasisRow = {
  key: BasisRowKey;
  text: string;
  sourceCodes: string[];
  /** The assumption notes behind this row (A1–A3), empty when fully sourced. */
  assumptions: string[];
};

/** Short citations for the sources the model cites; an unknown code is shown as the code alone. */
const CITATION: Readonly<Record<string, string>> = {
  N04: "Ordinance 2025-110",
  N16: "SafeTravelPH 2025",
  N28: "Tolentino & Sigua 2022",
  N29: "Puerto Princesa study 2025",
};

export const WAITING_ROW = "Waiting: unknown — no published schedules or headways for Naga";
export const TRAFFIC_ROW = "Not live traffic. ParaNaga uses no traffic service.";

const cite = (codes: readonly string[]) => codes.map((c) => (CITATION[c] ? `${CITATION[c]}, ${c}` : c)).join("; ");
const num = (n: number) => String(Math.round(n * 100) / 100);
const band = (p: EtaParam) => (p.low === p.high ? `${num(p.low!)}` : `${num(p.low!)}–${num(p.high!)}`);
const notes = (...ps: EtaParam[]) => ps.flatMap((p) => (p.isAssumption && p.assumptionNote ? [p.assumptionNote] : []));

/** Basis of a speed band: its sources, or which end is the assumption when the band is mixed (A2). */
function speedBasis(p: EtaParam): string {
  if (!p.isAssumption) return `(${cite(p.sourceCodes)})`;
  if (p.sourceCodes.length === 0) return "(ParaNaga assumption)";
  return `(upper from ${p.sourceCodes.join(", ")}; lower is a ParaNaga assumption)`;
}

/** The six rows, in display order. Expects a model that passed the estimator's checks. */
export function basisRows(model: EtaModel): BasisRow[] {
  const get = (k: EtaParamKey) => {
    const p = model.params.find((x) => x.key === k);
    if (!p) throw new Error(`time-estimate model has no ${k}`);
    return p;
  };
  const walk = get("walk_speed_kmh");
  const slow = get("walk_slowdown_factor");
  const off = get("jeepney_speed_offpeak_kmh");
  const peak = get("jeepney_speed_peak_kmh");
  const windows = get("peak_windows");

  const slowPct = Math.round((slow.high! / slow.low! - 1) * 100);
  const slowBasis = slow.isAssumption ? "ParaNaga assumption" : cite(slow.sourceCodes);
  const windowList = (windows.windows ?? []).map((w) => `${w.start}–${w.end}`).join(", ");
  const everyDay = windows.days === "every_day" ? `, applied every day${windows.isAssumption ? " (no day-of-week data)" : ""}` : "";

  return [
    {
      key: "walk",
      text: `Walking: ${band(walk)} km/h (${cite(walk.sourceCodes)}); up to ${slowPct}% slower for crossings (${slowBasis})`,
      sourceCodes: [...walk.sourceCodes, ...slow.sourceCodes],
      assumptions: notes(walk, slow),
    },
    { key: "jeepney_offpeak", text: `Jeepney off-peak: ${band(off)} km/h ${speedBasis(off)}`, sourceCodes: [...off.sourceCodes], assumptions: notes(off) },
    { key: "jeepney_peak", text: `Jeepney peak: ${band(peak)} km/h ${speedBasis(peak)}`, sourceCodes: [...peak.sourceCodes], assumptions: notes(peak) },
    {
      key: "peak_windows",
      text: `Peak windows: ${windowList} (${cite(windows.sourceCodes)})${everyDay}`,
      sourceCodes: [...windows.sourceCodes],
      assumptions: notes(windows),
    },
    { key: "waiting", text: WAITING_ROW, sourceCodes: [], assumptions: [] },
    { key: "traffic", text: TRAFFIC_ROW, sourceCodes: [], assumptions: [] },
  ];
}
