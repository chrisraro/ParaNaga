// /api/cron/retention (N7): needs the Bearer secret (never the query string) and an explicit mode;
// answers counts only, private.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestStorage } from "@/server/storage/adapter";

const route = vi.hoisted(() => ({ calls: [] as unknown[] }));
const env = vi.hoisted(() => ({ secret: "s".repeat(40) as string | undefined, storage: true }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({
    CRON_SECRET: env.secret,
    ...(env.storage ? { STORAGE_ENDPOINT: "https://storage.example", STORAGE_ACCESS_KEY_ID: "id", STORAGE_SECRET_ACCESS_KEY: "key" } : {}),
  }),
}));
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
    env.secret = "s".repeat(40);
    env.storage = true;
    setTestStorage(null);
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

  it("no secret configured: nobody can run it", async () => {
    env.secret = undefined;
    const { GET, POST } = await import("@/app/api/cron/retention/route");
    for (const auth of [undefined, "Bearer ", "Bearer undefined"]) {
      expect((await GET(req("?mode=commit", auth))).status).toBe(401);
      expect((await POST(req("?mode=commit", auth))).status).toBe(401);
    }
    expect(route.calls).toEqual([]);
  });

  it("no object storage configured: a commit is refused (rows never go without their files), a dry run still lists", async () => {
    env.storage = false;
    const { GET } = await import("@/app/api/cron/retention/route");
    expect((await GET(req("?mode=commit", `Bearer ${"s".repeat(40)}`))).status).toBe(503);
    expect(route.calls).toEqual([]);
    expect((await GET(req("?mode=dry-run", `Bearer ${"s".repeat(40)}`))).status).toBe(200);
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
