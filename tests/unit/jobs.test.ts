import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronJobsHandler } from "@/app/api/cron/jobs/route";
import { registerJobHandler, runJobBatch } from "@/server/jobs/worker";
import type { JobRow } from "@/server/jobs/types";

// ops.* calls the worker makes, in order, with scripted results (default: the lease is ours).
const db = vi.hoisted(() => ({
  claimed: [] as unknown[],
  calls: [] as string[],
  heartbeat: (() => true) as (jobId: string) => boolean,
  finish: (() => true) as (jobId: string) => boolean,
}));

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: { queryChunks: unknown[] }) => {
        const isSql = (c: unknown): c is { value: string[] } => typeof c === "object" && c !== null && "value" in c;
        const text = q.queryChunks.map((c) => (isSql(c) ? c.value.join("") : "?")).join("");
        const params = q.queryChunks.filter((c) => !isSql(c));
        if (text.includes("ops.claim_jobs")) return { rows: db.claimed };
        if (text.includes("ops.heartbeat_job")) {
          db.calls.push(`heartbeat ${params[0]}`);
          return { rows: [{ ok: db.heartbeat(String(params[0])) }] };
        }
        if (text.includes("ops.finish_job")) {
          db.calls.push(`finish ${params[0]} ${params[2]} ${params[3]}`);
          return { rows: [{ ok: db.finish(String(params[0])) }] };
        }
        throw new Error(`unexpected query: ${text}`);
      },
    }),
}));

const job = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id,
  kind: "batch_test",
  payload: {},
  idempotency_key: id,
  status: "running",
  attempts: 1,
  max_attempts: 5,
  run_after: "2026-11-10T00:00:00.000Z",
  locked_until: "2026-11-10T00:02:00.000Z",
  locked_by: "w",
  last_error_code: null,
  created_at: "2026-11-10T00:00:00.000Z",
  finished_at: null,
  ...over,
});

describe("cron jobs route authentication", () => {
  it("rejects request with 401 when CRON_SECRET is missing or invalid", async () => {
    const reqNoAuth = new Request("http://localhost/api/cron/jobs");
    const resNoAuth = await cronJobsHandler(reqNoAuth);
    expect(resNoAuth.status).toBe(401);

    const bodyNoAuth = await resNoAuth.json();
    expect(bodyNoAuth.error.code).toBe("unauthorized");

    const reqWrongSecret = new Request("http://localhost/api/cron/jobs", {
      headers: { authorization: "Bearer invalid-secret" },
    });
    const resWrongSecret = await cronJobsHandler(reqWrongSecret);
    expect(resWrongSecret.status).toBe(401);
  });
});

describe("job registry", () => {
  it("allows registering handlers for job kinds", () => {
    let handled = false;
    registerJobHandler("test_job", async (job: JobRow) => {
      handled = job.id === "test-1";
      return { success: true };
    });

    expect(handled).toBe(false);

    expect(typeof registerJobHandler).toBe("function");
    expect(typeof runJobBatch).toBe("function");
  });
});

describe("runJobBatch", () => {
  const ran: string[] = [];

  beforeEach(() => {
    ran.length = 0;
    db.calls.length = 0;
    db.heartbeat = () => true;
    db.finish = () => true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerJobHandler("batch_test", async (j) => {
      ran.push(j.id);
      return { success: true };
    });
  });

  it("renews each job's lease before starting it and skips a job another worker has taken", async () => {
    db.claimed = [job("a"), job("b"), job("c")];
    db.heartbeat = (id) => id !== "b";

    const summary = await runJobBatch({ workerId: "w" });

    expect(ran).toEqual(["a", "c"]);
    expect(db.calls).toEqual(["heartbeat a", "finish a done null", "heartbeat b", "heartbeat c", "finish c done null"]);
    expect(summary).toEqual({ claimed: 3, succeeded: 2, failed: 0, retried: 0, leaseLost: 1 });
  });

  it("kills a job claimed past its attempt cap instead of running it again", async () => {
    db.claimed = [job("poison", { attempts: 6, max_attempts: 5 }), job("last-try", { attempts: 5, max_attempts: 5 })];

    const summary = await runJobBatch({ workerId: "w" });

    expect(ran).toEqual(["last-try"]);
    expect(db.calls).toContain("finish poison dead MAX_ATTEMPTS");
    expect(summary).toEqual({ claimed: 2, succeeded: 1, failed: 1, retried: 0, leaseLost: 0 });
  });

  it("reports a finish that lost the lease as leaseLost, not as a success", async () => {
    db.claimed = [job("a"), job("b")];
    db.finish = (id) => id !== "a";

    const summary = await runJobBatch({ workerId: "w" });

    expect(ran).toEqual(["a", "b"]);
    expect(summary).toEqual({ claimed: 2, succeeded: 1, failed: 0, retried: 0, leaseLost: 1 });
  });
});
