// The server's per-revision planning geometry cache: loaded once, shared by concurrent callers, at most
// two revisions kept, a failed load not kept.
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ lines: 0, fail: false }));
vi.mock("@/server/repos/network-repo", () => ({
  getLines: async () => {
    repo.lines += 1;
    if (repo.fail) throw new Error("boom");
    return { status: "none" };
  },
  getWalkGraphMeta: async () => ({ status: "none" }),
  getWalkGraphPayload: async () => null,
}));

const { planNetwork, resetPlanNetworkForTests, MAX_REVISIONS } = await import("@/server/repos/network-cache");
const db = {} as never;

beforeEach(() => {
  repo.lines = 0;
  repo.fail = false;
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
});
