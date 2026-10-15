import { haversineMeters } from "@/domain/geo/geometry";
import { compareCodeUnits } from "./hash";
import { normalizeLabel, type IdentifiedStop } from "./mapped-stops";

export type ConflictKind = "code_prefix_mismatch" | "exact_coordinate_shared" | "near_duplicate";

export type DetectedConflict = {
  kind: ConflictKind;
  /** Sorted, distinct source identities of the records involved. */
  refs: string[];
  detail: Record<string, unknown>;
};

export const NEAR_DUPLICATE_METERS = 15;

const tokens = (label: string): string[] =>
  normalizeLabel(label)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Labels are "similar" when equal, when one's words contain the other's, or when half their words overlap. */
export function labelsSimilar(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const common = [...sa].filter((t) => sb.has(t)).length;
  if (common === sa.size || common === sb.size) return true;
  return common / (sa.size + sb.size - common) >= 0.5;
}

const sortRefs = (refs: string[]) => [...new Set(refs)].sort(compareCodeUnits);

export function detectConflicts(records: IdentifiedStop[]): DetectedConflict[] {
  const out: DetectedConflict[] = [];

  for (const r of records) {
    const prefix = r.code.charAt(0).toUpperCase();
    if (prefix !== r.layer) {
      out.push({
        kind: "code_prefix_mismatch",
        refs: [r.sourceIdentity],
        detail: { layer: r.layer, sourceLayer: r.sourceLayer, code: r.code, expectedPrefix: r.layer, label: r.label },
      });
    }
  }

  const byCoord = new Map<string, IdentifiedStop[]>();
  for (const r of records) {
    const k = `${r.lat},${r.lng}`;
    const g = byCoord.get(k);
    if (g) g.push(r);
    else byCoord.set(k, [r]);
  }
  for (const group of byCoord.values()) {
    if (group.length < 2) continue;
    out.push({
      kind: "exact_coordinate_shared",
      refs: sortRefs(group.map((g) => g.sourceIdentity)),
      detail: {
        lat: group[0]!.lat,
        lng: group[0]!.lng,
        records: group.map((g) => ({ sourceLayer: g.sourceLayer, code: g.code, label: g.label })),
      },
    });
  }

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i]!;
      const b = records[j]!;
      if (a.layer === b.layer) continue;
      if (a.lat === b.lat && a.lng === b.lng) continue; // reported as exact_coordinate_shared
      const meters = haversineMeters(a, b);
      if (meters > NEAR_DUPLICATE_METERS) continue;
      if (!labelsSimilar(a.label, b.label)) continue;
      out.push({
        kind: "near_duplicate",
        refs: sortRefs([a.sourceIdentity, b.sourceIdentity]),
        detail: {
          meters: Math.round(meters * 100) / 100,
          records: [a, b].map((x) => ({ sourceLayer: x.sourceLayer, code: x.code, label: x.label })),
        },
      });
    }
  }

  return out.sort((x, y) => (x.kind === y.kind ? compareCodeUnits(x.refs.join(","), y.refs.join(",")) : compareCodeUnits(x.kind, y.kind)));
}
