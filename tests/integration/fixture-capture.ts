// Writing captured API responses as e2e fixtures (CAPTURE_E2E_FIXTURES=1, see reference-api.test.ts).
// A capture runs on a throwaway branch where the revision is republished, which resets
// published_at; the fixtures must keep main's committed date so a recapture changes data, never
// dates (every "Oct 15, 2026" assertion depends on it). Pure helpers + one writer, unit-tested in
// tests/unit/fixture-capture.test.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const FIXTURE_DIR = "tests/e2e/fixtures/network";
/** The fixture whose revision every other capture is anchored to. */
export const ANCHOR_FIXTURE = "stops-all.json";

export type RevisionRef = { revisionId: string; publishedAt: string | null };

/** The first object carrying both `revisionId` (a string) and `publishedAt`, depth-first; or null. */
export function findRevision(value: unknown): RevisionRef | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findRevision(v);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.revisionId === "string" && "publishedAt" in o) {
      return { revisionId: o.revisionId, publishedAt: (o.publishedAt ?? null) as string | null };
    }
    for (const v of Object.values(o)) {
      const found = findRevision(v);
      if (found) return found;
    }
  }
  return null;
}

/** A copy of `value` where every revision object naming `committed.revisionId` has its committed publishedAt. */
export function keepPublishedAt(value: unknown, committed: RevisionRef): unknown {
  if (Array.isArray(value)) return value.map((v) => keepPublishedAt(v, committed));
  if (value && typeof value === "object") {
    const o = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, keepPublishedAt(v, committed)]));
    if (o.revisionId === committed.revisionId && "publishedAt" in o) o.publishedAt = committed.publishedAt;
    return o;
  }
  return value;
}

/** The revision a committed fixture names: the file's own, else the anchor's. */
export function committedRevision(name: string, dir = FIXTURE_DIR): RevisionRef | null {
  for (const file of [name, ANCHOR_FIXTURE]) {
    const path = `${dir}/${file}`;
    if (existsSync(path)) {
      const found = findRevision(JSON.parse(readFileSync(path, "utf8")));
      if (found) return found;
    }
  }
  return null;
}

/** Writes `raw` (a JSON response body) as fixture `name`, keeping the committed publishedAt. */
export function writeFixture(name: string, raw: string, dir = FIXTURE_DIR): void {
  const body: unknown = JSON.parse(raw);
  const committed = committedRevision(name, dir);
  writeFileSync(`${dir}/${name}`, JSON.stringify(committed ? keepPublishedAt(body, committed) : body, null, 1) + "\n");
}
