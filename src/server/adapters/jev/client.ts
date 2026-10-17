import "server-only";
import { z } from "zod";
import {
  mayClassifyWithJev,
  type ContentKind,
  type JevOutcome,
  type JevUnavailableReason,
  type ModerationFlags,
} from "@/domain/moderation/policy";
import { serverEnv } from "@/server/env";
import { withRequestContext } from "@/server/db/context";
import { takeToken } from "@/server/ratelimit/rate-limiter";
import { safeRequestId } from "@/server/request-id";
import { createHash } from "node:crypto";

// Jev decisions adapter (spec §3.8). Never throws: every failure becomes
// { status: "unavailable", reason } so callers keep content pending.
//
// ASSUMED WIRE FORMAT (the alpha Decisions API is not pinned in docs/spec; isolated in WireResponse):
//   request  { model, policy_version, state: { submission_type, text } }
//   response { id, model, recommendation: "publish"|"reject"|"human_review", confidence: 0..1 }
// `model` in the response must equal the pinned id, otherwise the evidence is discarded.
//
// Logs carry only an event name and a reason; never the key, the body or user text.

const WireResponse = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
    recommendation: z.enum(["publish", "reject", "human_review"]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** Per-day request counter. Production uses the Postgres-backed one (shared by every instance). */
export interface JevBudget {
  /** Atomically takes one request for the day; false when the cap is reached. */
  tryConsume(day: string, cap: number): Promise<boolean>;
}

export function createInMemoryBudget(): JevBudget {
  const counts = new Map<string, number>();
  return {
    async tryConsume(day, cap) {
      const used = counts.get(day) ?? 0;
      if (used >= cap) return false;
      counts.set(day, used + 1);
      return true;
    },
  };
}

export type JevConfig = {
  url: string;
  apiKey: string | undefined;
  modelId: string;
  policyVersion: string;
  timeoutMs: number;
  dailyBudget: number;
};

/** Reads the pinned config from env (src/server/env.ts already refuses undated builds in production). */
export function jevConfigFromEnv(): JevConfig {
  const e = serverEnv();
  return {
    url: e.JEV_DECISIONS_URL,
    apiKey: e.OPENROUTER_API_KEY,
    modelId: e.JEV_MODEL_ID,
    policyVersion: e.JEV_POLICY_VERSION,
    timeoutMs: e.JEV_TIMEOUT_MS,
    dailyBudget: e.JEV_DAILY_BUDGET_REQUESTS,
  };
}

export type JevDeps = {
  config?: JevConfig;
  fetch?: typeof fetch;
  budget?: JevBudget;
  now?: () => Date;
};

export type ClassifyInput = { kind: ContentKind; text: string; flags: ModerationFlags };

const unavailable = (reason: JevUnavailableReason): JevOutcome => ({ status: "unavailable", reason });

/**
 * The daily cap shared by every serverless instance: one ops.take_token bucket per UTC day (the
 * 86 400 s window is aligned to the epoch day). A database error answers false, so Jev is skipped
 * and the content stays pending: the spend cap fails closed.
 */
export function createPostgresBudget(): JevBudget {
  return {
    async tryConsume(day, cap) {
      try {
        const key = createHash("sha256").update(`jev:day|${day}`).digest("hex");
        return await withRequestContext({ userId: null, requestId: safeRequestId() }, (db) => takeToken(db, key, 86_400, cap));
      } catch {
        return false;
      }
    },
  };
}

const defaultBudget = createPostgresBudget();

export function createJevClient(deps: JevDeps = {}) {
  const budget = deps.budget ?? defaultBudget;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  return {
    async classify(input: ClassifyInput): Promise<JevOutcome> {
      try {
        // Complaint text must never leave the server unless both switches are on.
        if (!mayClassifyWithJev(input.kind, input.flags)) return unavailable("complaints_not_classified");

        const config = deps.config ?? jevConfigFromEnv();
        if (!config.apiKey) return unavailable("not_configured");

        const day = now().toISOString().slice(0, 10);
        if (!(await budget.tryConsume(day, config.dailyBudget))) return unavailable("budget_exhausted");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let res: Response;
        try {
          res = await doFetch(config.url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({
              model: config.modelId,
              policy_version: config.policyVersion,
              state: { submission_type: input.kind === "complaint" ? "complaint" : "post", text: input.text },
            }),
            signal: controller.signal,
          });
        } catch (err) {
          return unavailable(controller.signal.aborted || (err as Error)?.name === "AbortError" ? "timeout" : "network");
        } finally {
          clearTimeout(timer);
        }

        if (res.status === 401 || res.status === 402 || res.status === 403) return unavailable("auth");
        if (res.status === 429) return unavailable("rate_limited");
        if (res.status >= 500) return unavailable("server_error");
        if (!res.ok) return unavailable("client_error");

        let json: unknown;
        try {
          json = await res.json();
        } catch {
          return unavailable("malformed");
        }
        const parsed = WireResponse.safeParse(json);
        if (!parsed.success) return unavailable("malformed");
        if (parsed.data.model !== config.modelId) return unavailable("model_mismatch");

        return {
          status: "ok",
          verdict: { recommendation: parsed.data.recommendation, confidence: parsed.data.confidence },
        };
      } catch {
        return unavailable("network");
      }
    },
  };
}
