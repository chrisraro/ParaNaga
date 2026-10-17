// POST /api/v1/plan handler: body validation before any database work, the error envelope,
// no-store on every response, and no coordinates in logs. The repository is mocked with the
// real Loop A/B fixture so the happy path runs without a database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { apiErrorSchema, type NetworkSnapshot } from "@/domain/api/schemas";
import { encodeWalkGraph } from "@/domain/walk/walk-graph";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const repo = vi.hoisted(() => ({
  snapshot: null as NetworkSnapshot | null,
  lines: null as unknown,
  streets: null as string | null,
  linesStatus: "ok" as "ok" | "none" | "incomplete",
  fail: false,
  calls: 0,
  loads: 0,
}));

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    repo.calls += 1;
    if (repo.fail) throw new Error("connection to postgres at 13.6233869,123.1846726 failed");
    // The rate limiter's ops.take_token call: always within limit in these tests.
    return fn({ execute: async () => ({ rows: [{ ok: true }] }) });
  },
}));
vi.mock("@/server/repos/network-repo", () => ({
  getPublishedRevision: async () => repo.snapshot?.revision ?? null,
  getSnapshot: async (_db: unknown, id: string) => (repo.snapshot?.revision.revisionId === id ? repo.snapshot : null),
  getLines: async () => {
    repo.loads += 1;
    return repo.linesStatus === "ok" ? { status: "ok", body: repo.lines } : repo.linesStatus === "none" ? { status: "none" } : { status: "incomplete", missing: 1 };
  },
  getWalkGraphMeta: async () => (repo.streets === null ? { status: "none" } : { status: "ok", versionId: "v", sha256: "x", bytes: repo.streets.length }),
  getWalkGraphPayload: async () => repo.streets,
}));

const { POST } = await import("@/app/api/v1/plan/route");
const { resetPlanNetworkForTests } = await import("@/server/repos/network-cache");
const STREETS = JSON.stringify(encodeWalkGraph(realStreets()));

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
const PILI = { lat: 13.5828, lng: 123.2756 };

const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new Request("http://localhost/api/v1/plan", { method: "POST", body, headers }));
const json = (v: unknown) => JSON.stringify(v);

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorSchema.parse(await response.json());
  expect(body.error.code).toBe(code);
  return body;
}

describe("POST /api/v1/plan", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    repo.snapshot = realLinesSnapshot();
    repo.lines = realLines();
    repo.streets = STREETS;
    repo.linesStatus = "ok";
    repo.fail = false;
    repo.calls = 0;
    repo.loads = 0;
    resetPlanNetworkForTests();
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it("plans on the published snapshot: 200, no-store, schema-valid, unverified", async () => {
    const response = await post(json({ origin: PLAZA_RIZAL, destination: BISCAST }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = planResponseSchema.parse(await response.json());
    expect(body.plan.coverage).toBe("provisional");
    expect(body.plan.notes[0]).toBe("Unverified route — confirm with the driver");
    expect(body.plan.options.map((o) => o.mode)).toContain("jeepney");
    for (const o of body.plan.options) {
      for (const leg of o.legs) {
        if (leg.kind === "ride") expect(leg).toMatchObject({ verification: "unverified", pathVerified: false, boardingVerified: false });
      }
    }
  });

  it("reads the Lines and street graph once per revision, not once per request", async () => {
    for (let i = 0; i < 3; i++) expect((await post(json({ origin: PLAZA_RIZAL, destination: BISCAST }))).status).toBe(200);
    expect(repo.loads).toBe(1);
  });

  it("a revision published without paths or a street graph still plans (tricycle without a street route)", async () => {
    repo.linesStatus = "none";
    repo.streets = null;
    const response = await post(json({ origin: PLAZA_RIZAL, destination: BISCAST }));
    expect(response.status).toBe(200);
    const body = planResponseSchema.parse(await response.json());
    expect(body.plan.options.map((o) => o.mode)).not.toContain("jeepney");
  });

  it("503 (never cached) when the published paths are incomplete, and the next request tries again", async () => {
    repo.linesStatus = "incomplete";
    await expectError(await post(json({ origin: PLAZA_RIZAL, destination: BISCAST })), 503, "unavailable");
    repo.linesStatus = "ok";
    expect((await post(json({ origin: PLAZA_RIZAL, destination: BISCAST }))).status).toBe(200);
  });

  it.each([
    ["not JSON", "origin=1", { "content-type": "application/json" }],
    ["the wrong content type", json({ origin: PLAZA_RIZAL, destination: BISCAST }), { "content-type": "text/plain" }],
    ["a missing point", json({ origin: PLAZA_RIZAL }), undefined],
    ["string coordinates", json({ origin: { lat: "13.6", lng: "123.1" }, destination: BISCAST }), undefined],
    ["a point outside Naga", json({ origin: PILI, destination: BISCAST }), undefined],
  ])("rejects %s with 400 before touching the database", async (_name, body, headers) => {
    const res = await expectError(await post(body, headers), 400, "bad_request");
    expect(res.error.message).not.toMatch(/13\.|123\./);
    expect(repo.calls).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it("refuses an oversized body with 413", async () => {
    const big = json({ origin: PLAZA_RIZAL, destination: BISCAST, pad: "x".repeat(2000) });
    await expectError(await post(big), 413, "payload_too_large");
    expect(repo.calls).toBe(0);
  });

  it("refuses an oversized streamed body without a Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode("x".repeat(512)));
        c.close();
      },
    });
    const request = new Request("http://localhost/api/v1/plan", {
      method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half",
    } as RequestInit);
    await expectError(await POST(request), 413, "payload_too_large");
  });

  it("404 when nothing is published; 503 when the snapshot has no stops", async () => {
    repo.snapshot = null;
    await expectError(await post(json({ origin: PLAZA_RIZAL, destination: BISCAST })), 404, "not_found");
    repo.snapshot = { ...realLinesSnapshot(), stops: [] };
    await expectError(await post(json({ origin: PLAZA_RIZAL, destination: BISCAST })), 503, "unavailable");
  });

  it("a server failure returns the internal envelope and logs no coordinates", async () => {
    repo.fail = true;
    await expectError(await post(json({ origin: PLAZA_RIZAL, destination: BISCAST })), 500, "internal");
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain('"route":"plan"');
    expect(logged).not.toMatch(/13\.6|123\.1|postgres|lat|lng/);
  });
});
