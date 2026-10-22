// Publication guard (spec 7.3, AC-5 fixtures): a revision that contains synthetic (test) data is never
// published. Pure. The admin publish flow (N5) must call this before it writes a revision.
export type PublishableRow = { kind: string; code: string; isSynthetic: boolean };

export type PublicationBlocker = { kind: string; code: string; reason: "synthetic" };

/** Every row that blocks publication (empty means the revision may be published as far as this guard goes). */
export function publicationBlockers(rows: readonly PublishableRow[]): PublicationBlocker[] {
  return rows.filter((r) => r.isSynthetic).map((r) => ({ kind: r.kind, code: r.code, reason: "synthetic" as const }));
}

export function canPublish(rows: readonly PublishableRow[]): boolean {
  return publicationBlockers(rows).length === 0;
}
