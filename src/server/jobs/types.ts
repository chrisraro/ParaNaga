import "server-only";

export type JobStatus = "queued" | "running" | "retry" | "done" | "dead";

export interface JobRow {
  [key: string]: unknown;
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  locked_by: string | null;
  last_error_code: string | null;
  created_at: string;
  finished_at: string | null;
}

export type JobHandlerResult =
  | { success: true }
  | { success: false; retry: boolean; errorCode?: string; retryDelaySeconds?: number };

export type JobHandler = (
  job: JobRow,
  heartbeat: () => Promise<boolean>,
) => Promise<JobHandlerResult>;

export interface EnqueueJobOptions {
  idempotencyKey?: string;
  maxAttempts?: number;
  runAfter?: Date;
}
