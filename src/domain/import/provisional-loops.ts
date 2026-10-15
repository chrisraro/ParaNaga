import type { IdentifiedStop } from "./mapped-stops";

export type LoopSequenceItem = { seq: number; recordIdentity: string };

const SEQUENCED: Readonly<Record<string, "A" | "B">> = { "R8-A": "A", "R8-B": "B" };
const NOT_SEQUENCED = new Set(["R8-C", "R8-D"]);

/**
 * Provisional order for Loop A (A1…A30) and Loop B (B1…B31) by decision: the layers carry only their
 * own prefix and numbers are complete. Loops C and D reuse A/B codes, so any order would be invented
 * and they return null. This is not a surveyed stop sequence.
 */
export function provisionalLoopSequence(records: IdentifiedStop[], routeId: string): LoopSequenceItem[] | null {
  if (NOT_SEQUENCED.has(routeId)) return null;
  const letter = SEQUENCED[routeId];
  if (!letter) throw new Error(`provisionalLoopSequence: unsupported route "${routeId}"`);

  const layer = records.filter((r) => r.layer === letter);
  if (layer.length === 0) throw new Error(`No records for layer ${letter}`);

  const parsed = layer.map((r) => {
    const m = /^([A-Za-z])(\d+)$/.exec(r.code);
    if (!m || m[1]!.toUpperCase() !== letter) {
      throw new Error(`Layer ${letter} record "${r.code}" does not carry the layer's own prefix`);
    }
    return { record: r, n: Number(m[2]) };
  });
  parsed.sort((a, b) => a.n - b.n);
  parsed.forEach((p, i) => {
    if (p.n !== i + 1) {
      throw new Error(`Layer ${letter} codes are not complete and contiguous from 1: expected ${letter}${i + 1}, found ${p.record.code}`);
    }
  });
  return parsed.map((p, i) => ({ seq: i + 1, recordIdentity: p.record.sourceIdentity }));
}
