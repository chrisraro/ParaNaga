// Reconciliation (A7, N5b): the read-only checks of a stop against its source pins. Pure, but
// server-side only (it reuses the importer's label rule, src/domain/import/conflicts.ts, whose
// module graph hashes with node:crypto). Pairs of nearby stops come from the database
// (transit.admin_reconciliation, migration 0024); a reviewer links them or keeps them separate.
import { labelsSimilar } from "@/domain/import/conflicts";
import { PIN_MISMATCH_M, type Reconciliation, type StopStatus } from "./stops";

export type PinRow = {
  stopPointId: string;
  name: string;
  status: string;
  pinLayer: string;
  pinCode: string | null;
  pinLabel: string;
  distanceM: number;
};

/** Same similarity rule as the importer's near_duplicate conflicts. */
export const similarPairNames = (a: string, b: string) => labelsSimilar(a, b);

/**
 * Pins more than PIN_MISMATCH_M from their stop, or whose label does not resemble the stop's name
 * (an empty pin label never counts as a different name).
 */
export function pinMismatches(rows: PinRow[]): Reconciliation["mismatches"] {
  const out: Reconciliation["mismatches"] = [];
  for (const r of rows) {
    const far = Number.isFinite(r.distanceM) && r.distanceM > PIN_MISMATCH_M;
    const nameDiffers = r.pinLabel.trim() !== "" && r.name.trim() !== r.pinLabel.trim() && !labelsSimilar(r.name, r.pinLabel);
    if (far || nameDiffers) out.push({ ...r, status: r.status as StopStatus, far, nameDiffers });
  }
  return out.sort((a, b) => b.distanceM - a.distanceM || a.name.localeCompare(b.name));
}
