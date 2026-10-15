// The e2e fixture capture keeps the committed publishedAt automatically (Task 11 review, Minor A).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { committedRevision, findRevision, keepPublishedAt, writeFixture } from "../integration/fixture-capture";

const REV = "67e56657-7542-462e-b57c-eb14439a0c7a";
const COMMITTED = { revisionId: REV, publishedAt: "2026-10-15T12:59:57.089Z" };
const RECAPTURED = { revisionId: REV, label: "osm-places-2026-10-15", kind: "provisional", publishedAt: "2026-10-16T18:02:00.000Z" };

describe("fixture capture", () => {
  it("finds the revision a response names, at any depth", () => {
    expect(findRevision({ revision: RECAPTURED, stops: [] })).toEqual({ revisionId: REV, publishedAt: RECAPTURED.publishedAt });
    expect(findRevision({ plan: { revisionId: REV } })).toBeNull();
    expect(findRevision([{ x: 1 }, { revision: { revisionId: REV, publishedAt: null } }])).toEqual({ revisionId: REV, publishedAt: null });
  });

  it("restores the committed publishedAt on every revision object of that revision, nothing else", () => {
    const body = { revision: RECAPTURED, nested: [{ revision: RECAPTURED }], other: { revisionId: "x", publishedAt: "2020-01-01T00:00:00Z" }, n: 3 };
    expect(keepPublishedAt(body, COMMITTED)).toEqual({
      revision: { ...RECAPTURED, publishedAt: COMMITTED.publishedAt },
      nested: [{ revision: { ...RECAPTURED, publishedAt: COMMITTED.publishedAt } }],
      other: { revisionId: "x", publishedAt: "2020-01-01T00:00:00Z" },
      n: 3,
    });
  });

  it("writes a recapture with the committed date; a new fixture takes the anchor's", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fixtures-"));
    writeFileSync(path.join(dir, "stops-all.json"), JSON.stringify({ revision: { ...RECAPTURED, publishedAt: COMMITTED.publishedAt } }));
    writeFixture("snapshot.json", JSON.stringify({ revision: RECAPTURED, stops: [] }), dir);
    expect(JSON.parse(readFileSync(path.join(dir, "snapshot.json"), "utf8")).revision.publishedAt).toBe(COMMITTED.publishedAt);
    expect(committedRevision("snapshot.json", dir)).toEqual(COMMITTED);
  });

  it("the committed fixtures all name one revision with one publishedAt", () => {
    const anchor = committedRevision("stops-all.json");
    expect(anchor).not.toBeNull();
    for (const name of ["search-index.json", "routes.json", "sources.json", "terminal-t01.json", "stop-a1.json"]) {
      expect(committedRevision(name), name).toEqual(anchor);
    }
  });
});
