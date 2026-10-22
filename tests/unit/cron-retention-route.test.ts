// /api/cron/retention (N7): needs the Bearer secret (never the query string) and an explicit mode;
// answers counts only, private.
import { beforeEach, describe, expect, it, vi } from "vitest";


const route = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ CRON_SECRET: "s".repeat(40) }) }));
vi.mock("@/server/db/context", () => ({ withRequestContext: vi.fn() }));
vi.mock("@/server/complaints/retention", async (orig) => ({
  ...(await orig<typeof import("@/server/complaints/retention")>()),
  runEvidenceRetention: async (o: { dryRun: boolean }) => {
    route.calls.push(o.dryRun);
    return { dryRun: o.dryRun, complaints: 0, uploads: 0, objects: 0, failed: 0 };
  },
}));

describe("/api/cron/retention", () => {
  beforeEach(() => {
    route.calls = [];
  });
  const req = (qs: string, auth?: string) => new Request(`http://localhost/api/cron/retention${qs}`, { headers: auth ? { authorization: auth } : {} });

  it("401 without the Bearer secret (a query-string secret is ignored); 400 without an explicit mode", async () => {
    const { GET } = await import("@/app/api/cron/retention/route");
    expect((await GET(req("?mode=commit"))).status).toBe(401);
    expect((await GET(req(`?mode=commit&secret=${"s".repeat(40)}`))).status).toBe(401);
    expect((await GET(req("?mode=commit", "Bearer wrong"))).status).toBe(401);
    expect((await GET(req("", `Bearer ${"s".repeat(40)}`))).status).toBe(400);
    expect((await GET(req("?mode=purge", `Bearer ${"s".repeat(40)}`))).status).toBe(400);
    expect(route.calls).toEqual([]);
  });

  it("runs a dry run or a commit, private, counts only", async () => {
    const { GET } = await import("@/app/api/cron/retention/route");
    const dry = await GET(req("?mode=dry-run", `Bearer ${"s".repeat(40)}`));
    expect(dry.status).toBe(200);
    expect(dry.headers.get("cache-control")).toBe("private, no-store");
    expect((await dry.json()).summary).toEqual({ dryRun: true, complaints: 0, uploads: 0, objects: 0, failed: 0 });
    expect((await GET(req("?mode=commit", `Bearer ${"s".repeat(40)}`))).status).toBe(200);
    expect(route.calls).toEqual([true, false]);
  });
});
