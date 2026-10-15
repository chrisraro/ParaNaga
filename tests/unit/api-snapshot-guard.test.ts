// The snapshot is cached as immutable, so an incomplete read must never go out as a 200.
// The DB context and repo are mocked; this checks the handler's guard and that public reads
// ask for a read-only snapshot transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema, isCompleteSnapshot, type NetworkSnapshot } from "@/domain/api/schemas";

const calls: { options: unknown }[] = [];
let snapshot: NetworkSnapshot | null = null;

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>, options?: unknown) => {
    calls.push({ options });
    return fn({});
  },
}));
vi.mock("@/server/repos/network-repo", () => ({ getSnapshot: async () => snapshot }));

const { GET } = await import("@/app/api/v1/network/snapshot/[revisionId]/route");

const revisionId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
const revision = { revisionId, label: "r", kind: "provisional" as const, publishedAt: "2026-10-15T00:00:00.000Z" };
const stop = {
  id: "11111111-1111-4111-8111-111111111111", name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726,
  status: "candidate" as const, navigationApproved: false, source: { layer: "Loop Service A", code: "A1", label: "Plaza Rizal" },
};
const variant = {
  variantId: "22222222-2222-4222-8222-222222222222", routeId: "33333333-3333-4333-8333-333333333333",
  routeCode: "R8-A", routeName: "Loop A", direction: "clockwise" as const, kind: "permanent" as const,
  evidenceLevel: "provisional" as const, verification: "unverified" as const, isCircular: true, stopIds: [stop.id],
  mode: "jeepney" as const,
};
const request = () => GET(new Request(`http://localhost/api/v1/network/snapshot/${revisionId}`), { params: Promise.resolve({ revisionId }) } as never);

describe("network/snapshot completeness guard", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("isCompleteSnapshot needs stops only (publish does not require routable variants)", () => {
    expect(isCompleteSnapshot({ stops: [stop], variants: [variant] })).toBe(true);
    expect(isCompleteSnapshot({ stops: [stop], variants: [] })).toBe(true);
    expect(isCompleteSnapshot({ stops: [], variants: [variant] })).toBe(false);
  });

  it("serves a snapshot with stops but no variants (nothing routable yet)", async () => {
    snapshot = { revision, stops: [stop], variants: [], fareRules: [], terminals: [], routes: [] };
    const response = await request();
    expect(response.status).toBe(200);
  });

  it("serves a complete snapshot as immutable, read in a read-only transaction", async () => {
    snapshot = { revision, stops: [stop], variants: [variant], fareRules: [], terminals: [], routes: [] };
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=31536000, immutable");
    expect(calls).toEqual([{ options: { readOnly: true } }]);
  });

  it.each([
    ["no stops", { stops: [], variants: [variant] }],
    ["nothing", { stops: [], variants: [] }],
  ])("returns 503 no-store for %s", async (_name, part) => {
    snapshot = { revision, fareRules: [], terminals: [], routes: [], ...part } as NetworkSnapshot;
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe("unavailable");
  });
});
