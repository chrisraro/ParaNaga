import "server-only";
import type { Lines } from "@/domain/api/schemas";
import { parseWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";
import type { Db } from "@/server/db/context";
import { getLines, getWalkGraphMeta, getWalkGraphPayload } from "@/server/repos/network-repo";

// The planner's geometry for the published revision: its approximate paths (Lines) and street graph.
// Both are immutable per revision, so the decoded pair is kept in memory per revision id (at most
// MAX_REVISIONS, oldest dropped) and the Lines object stays the same across requests, which is what
// keeps the planner's per-Lines planning network memo (planningNetwork) warm. A failed load is not kept.

export type PlanNetwork = { lines: Lines | null; streets: WalkGraph | null };

export const MAX_REVISIONS = 2;

/** The published paths are only partly there: never planned on (the plan route answers 503). */
export class NetworkIncomplete extends Error {}

const cache = new Map<string, Promise<PlanNetwork>>();

async function load(db: Db, revisionId: string): Promise<PlanNetwork> {
  const read = await getLines(db, revisionId);
  if (read.status === "incomplete") throw new NetworkIncomplete("The published paths are incomplete.");
  const lines = read.status === "ok" ? read.body : null;

  let streets: WalkGraph | null = null;
  const meta = await getWalkGraphMeta(db, revisionId);
  if (meta.status === "ok") {
    // A published street graph that cannot be read is never replaced by "no graph": the plan route answers 503.
    const payload = await getWalkGraphPayload(db, revisionId, meta.versionId);
    let raw: unknown = null;
    try {
      raw = payload === null ? null : JSON.parse(payload);
    } catch {
      raw = null;
    }
    const parsed = raw === null ? null : parseWalkGraph(raw);
    if (!parsed?.ok) throw new NetworkIncomplete("The published street graph could not be read.");
    streets = parsed.graph;
  }
  return { lines, streets };
}

/** The Lines and street graph of `revisionId`, loaded once (concurrent callers share the load). */
export function planNetwork(db: Db, revisionId: string): Promise<PlanNetwork> {
  const hit = cache.get(revisionId);
  if (hit) return hit;
  const pending = load(db, revisionId);
  cache.set(revisionId, pending);
  pending.catch(() => {
    if (cache.get(revisionId) === pending) cache.delete(revisionId);
  });
  while (cache.size > MAX_REVISIONS) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Tests only. */
export function resetPlanNetworkForTests(): void {
  cache.clear();
}
