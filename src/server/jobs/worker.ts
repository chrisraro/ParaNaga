import "server-only";
import { sql } from "drizzle-orm";
import { withRequestContext, type Db } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";
import type { JobHandler, JobHandlerResult, JobRow, EnqueueJobOptions } from "./types";

const registry = new Map<string, JobHandler>();

/**
 * Registers a handler for a job kind.
 */
export function registerJobHandler(kind: string, handler: JobHandler): void {
  registry.set(kind, handler);
}

/**
 * Enqueues a job in `ops.job`.
 * Idempotency key defaults to random UUID if not specified.
 */
export async function enqueueJob(
  db: Db,
  kind: string,
  payload: Record<string, unknown>,
  options: EnqueueJobOptions = {},
): Promise<string> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const maxAttempts = options.maxAttempts ?? 5;
  const runAfter = options.runAfter ? options.runAfter.toISOString() : new Date().toISOString();

  const result = await db.execute<{ id: string }>(sql`
    insert into ops.job (kind, payload, idempotency_key, max_attempts, run_after)
    values (${kind}, ${JSON.stringify(payload)}::jsonb, ${idempotencyKey}, ${maxAttempts}, ${runAfter}::timestamptz)
    on conflict (kind, idempotency_key) where status not in ('done', 'dead')
    do update set run_after = least(ops.job.run_after, excluded.run_after)
    returning id
  `);

  return result.rows[0]?.id ?? "";
}

/**
 * Claims jobs from `ops.job` using atomic `ops.claim_jobs(p_worker_id, p_limit, p_lease_seconds)`.
 * Commits immediately before executing any handler I/O (spec §3.10).
 */
export async function claimJobs(
  workerId: string,
  limit: number = 10,
  leaseSeconds: number = 120,
): Promise<JobRow[]> {
  const requestId = safeRequestId();
  return withRequestContext({ userId: null, requestId }, async (db) => {
    const result = await db.execute<JobRow>(sql`
      select id, kind, payload, idempotency_key, status, attempts, max_attempts,
             run_after, locked_until, locked_by, last_error_code, created_at, finished_at
        from ops.claim_jobs(${workerId}, ${limit}, ${leaseSeconds})
    `);
    return result.rows;
  });
}

/**
 * Extends the lease on a currently claimed job.
 */
export async function heartbeatJob(
  jobId: string,
  workerId: string,
  leaseSeconds: number = 120,
): Promise<boolean> {
  const requestId = safeRequestId();
  return withRequestContext({ userId: null, requestId }, async (db) => {
    const result = await db.execute<{ ok: boolean }>(sql`
      select ops.heartbeat_job(${jobId}::uuid, ${workerId}, ${leaseSeconds}) as ok
    `);
    return result.rows[0]?.ok === true;
  });
}

/**
 * Marks a job finished: 'done', 'retry' (with backoff), or 'dead'.
 */
export async function finishJob(
  jobId: string,
  workerId: string,
  status: "done" | "retry" | "dead",
  errorCode: string | null = null,
  retryDelaySeconds: number = 60,
): Promise<boolean> {
  const requestId = safeRequestId();
  return withRequestContext({ userId: null, requestId }, async (db) => {
    const result = await db.execute<{ ok: boolean }>(sql`
      select ops.finish_job(${jobId}::uuid, ${workerId}, ${status}, ${errorCode}, ${retryDelaySeconds}) as ok
    `);
    return result.rows[0]?.ok === true;
  });
}

/**
 * Processes a single batch of claimed jobs.
 * Each job execution is isolated with its own DB context outside the claim transaction.
 */
export async function runJobBatch(
  options: { workerId?: string; batchSize?: number; leaseSeconds?: number } = {},
): Promise<{ claimed: number; succeeded: number; failed: number; retried: number; leaseLost: number }> {
  const workerId = options.workerId ?? `worker-${crypto.randomUUID().slice(0, 8)}`;
  const batchSize = options.batchSize ?? 10;
  const leaseSeconds = options.leaseSeconds ?? 120;

  const jobs = await claimJobs(workerId, batchSize, leaseSeconds);
  const summary = { claimed: jobs.length, succeeded: 0, failed: 0, retried: 0, leaseLost: 0 };

  for (const job of jobs) {
    const heartbeat = () => heartbeatJob(job.id, workerId, leaseSeconds);
    const lost = (stage: "start" | "finish") => {
      console.warn(JSON.stringify({ event: "job_lease_lost", jobId: job.id, kind: job.kind, stage }));
      summary.leaseLost++;
    };
    // A finish that updates nothing means another worker took the job over: not ours to count.
    const finish = async (
      counter: "succeeded" | "failed" | "retried",
      ...args: [status: "done" | "retry" | "dead", errorCode?: string, retryDelaySeconds?: number]
    ) => {
      if (await finishJob(job.id, workerId, ...args)) summary[counter]++;
      else lost("finish");
    };

    // The batch shares one lease taken at claim time and runs in sequence, so a later job's lease
    // may have expired (and the job been reclaimed) while earlier ones ran. Renew it or skip.
    // A heartbeat that throws (database blip) is treated the same: the lease will expire and the
    // job is claimed again, instead of the whole batch failing with every job left running.
    if (!(await heartbeat().catch(() => false))) {
      lost("start");
      continue;
    }

    // ops.claim_jobs counts an attempt on every claim, including a reclaim after a run that never
    // reached finish_job (the only place the cap is applied). Stop a job that keeps dying mid-run.
    if (job.attempts > job.max_attempts) {
      console.warn(JSON.stringify({ event: "job_attempts_exhausted", jobId: job.id, kind: job.kind }));
      await finish("failed", "dead", "MAX_ATTEMPTS");
      continue;
    }

    const handler = registry.get(job.kind);
    if (!handler) {
      // Unrecognized job kind, fail permanently to avoid spinning
      console.warn(JSON.stringify({ event: "job_unknown_kind", jobId: job.id, kind: job.kind }));
      await finish("failed", "dead", "UNKNOWN_KIND");
      continue;
    }

    try {
      const outcome: JobHandlerResult = await handler(job, heartbeat);
      if (outcome.success) {
        await finish("succeeded", "done");
      } else if (outcome.retry) {
        const delay = outcome.retryDelaySeconds ?? Math.min(30 * Math.pow(2, job.attempts), 3600);
        await finish("retried", "retry", outcome.errorCode ?? "HANDLER_RETRY", delay);
      } else {
        await finish("failed", "dead", outcome.errorCode ?? "HANDLER_FAILED");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.name : "UNHANDLED_EXCEPTION";
      console.error(JSON.stringify({ event: "job_exception", jobId: job.id, kind: job.kind, error: message }));
      const delay = Math.min(30 * Math.pow(2, job.attempts), 3600);
      await finish("retried", "retry", message, delay);
    }
  }

  return summary;
}
