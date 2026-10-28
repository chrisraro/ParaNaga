// The server's per-revision planning geometry cache: loaded once, shared by concurrent callers, at most
// two revisions kept, a failed load not kept.
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ snaps: 0, snap: { stops: [{}], variants: [{}] } as unknown, lines: 0, fail: false, graph: null as string | null }));
vi.mock("@/server/repos/network-repo", () => ({
  getSnapshot: async () => {
    repo.snaps += 1;
    if (repo.fail) throw new Error("boom");
    return repo.snap;
  },
  getLines: async () => {
    repo.lines += 1;
    if (repo.fail) throw new Error("boom");
    return { status: "none" };
  },
  getWalkGraphMeta: async () => (repo.graph === null ? { status: "none" } : { status: "ok", versionId: "v", sha256: "x", bytes: 1 }),
  getWalkGraphPayload: async () => repo.graph,
}));

const { publishedSnapshot, planNetwork, resetPlanNetworkForTests, MAX_REVISIONS } = await import("@/server/repos/network-cache");
const db = {} as never;

beforeEach(() => {
  repo.lines = 0;
  repo.snaps = 0;
  repo.snap = { stops: [{}], variants: [{}] };
  repo.fail = false;
  repo.graph = null;
  resetPlanNetworkForTests();
});

describe("planNetwork", () => {
  it("loads once per revision and hands every caller the same object", async () => {
    const [a, b] = await Promise.all([planNetwork(db, "r1"), planNetwork(db, "r1")]);
    expect(a).toBe(b);
    expect(await planNetwork(db, "r1")).toBe(a);
    expect(repo.lines).toBe(1);
  });

  it("keeps at most two revisions, dropping the oldest", async () => {
    expect(MAX_REVISIONS).toBe(2);
    await planNetwork(db, "r1");
    await planNetwork(db, "r2");
    await planNetwork(db, "r3");
    expect(repo.lines).toBe(3);
    await planNetwork(db, "r2");
    await planNetwork(db, "r3");
    expect(repo.lines).toBe(3);
    await planNetwork(db, "r1");
    expect(repo.lines).toBe(4);
  });

  it("does not keep a failed load", async () => {
    repo.fail = true;
    await expect(planNetwork(db, "r1")).rejects.toThrow("boom");
    repo.fail = false;
    await expect(planNetwork(db, "r1")).resolves.toEqual({ lines: null, streets: null });
    expect(repo.lines).toBe(2);
  });

  it.each([["not JSON", "{oops"], ["not a street graph", "{\"v\":9}"]])("a published street graph that is %s is incomplete, never cached as no graph", async (_n, payload) => {
    repo.graph = payload;
    await expect(planNetwork(db, "r1")).rejects.toBeInstanceOf((await import("@/server/repos/network-cache")).NetworkIncomplete);
    repo.graph = null;
    await expect(planNetwork(db, "r1")).resolves.toEqual({ lines: null, streets: null });
  });
});

describe("publishedSnapshot", () => {
  it("reads once per revision, shares concurrent callers, keeps at most two revisions", async () => {
    const [a, b] = await Promise.all([publishedSnapshot(db, "r1"), publishedSnapshot(db, "r1")]);
    expect(a).toBe(b);
    expect(repo.snaps).toBe(1);
    await publishedSnapshot(db, "r2");
    await publishedSnapshot(db, "r3");
    await publishedSnapshot(db, "r1");
    expect(repo.snaps).toBe(4);
  });

  it("evicts on error, and never keeps a missing or incomplete snapshot", async () => {
    repo.fail = true;
    await expect(publishedSnapshot(db, "r1")).rejects.toThrow("boom");
    repo.fail = false;
    await expect(publishedSnapshot(db, "r1")).resolves.toBe(repo.snap);
    expect(repo.snaps).toBe(2);
    repo.snap = null;
    await publishedSnapshot(db, "r2");
    await publishedSnapshot(db, "r2");
    expect(repo.snaps).toBe(4);
    repo.snap = { stops: [], variants: [] };
    await publishedSnapshot(db, "r3");
    await publishedSnapshot(db, "r3");
    expect(repo.snaps).toBe(6);
  });
});
