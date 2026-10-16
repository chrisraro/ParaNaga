// The Lines path of each variant a trip rides, for guidance on a ride without marked stops
// (progress.ts: metres left on the approximate path). Pure. Without the Lines on the phone the
// guidance falls back to its plain copy, so nothing here is required.
import type { PlanOptionDto } from "../api/plan";
import type { Lines } from "../api/schemas";
import { isCircuitLine } from "../planner/paths";
import type { GuidanceTrip } from "./steps";

export function ridePathsFor(option: Pick<PlanOptionDto, "legs">, lines: Lines | null | undefined): GuidanceTrip["ridePaths"] {
  if (!lines) return undefined;
  const out: Record<string, { encoded: string; isCircuit: boolean }> = {};
  for (const leg of option.legs) {
    if (leg.kind !== "ride" || leg.board === null) continue;
    const line = lines.lines.find((l) => l.variantId === leg.variantId);
    if (line) out[leg.variantId] = { encoded: line.encoded, isCircuit: isCircuitLine(line) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
