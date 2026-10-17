import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ipAddress } from "@vercel/functions";
import type { Db } from "@/server/db/context";
import { serverEnv } from "@/server/env";

export interface RateLimitConfig {
  prefix: string;
  windowSeconds: number;
  limit: number;
}

/** Pre-configured rate limits from spec §7.8 & outline */
export const RATE_LIMITS = {
  planPerMinute: { prefix: "plan:min", windowSeconds: 60, limit: 30 },
  planPerDay: { prefix: "plan:day", windowSeconds: 86400, limit: 600 },
  mutationPerMinute: { prefix: "mut:min", windowSeconds: 60, limit: 60 },
  mutationPerHour: { prefix: "mut:hour", windowSeconds: 3600, limit: 500 },
  /** New accounts post rarely; the community hub keeps its own, lower limits (spec 5.3 "W (limits)"). */
  communityPostPerHour: { prefix: "cpost:hour", windowSeconds: 3600, limit: 10 },
  communityCommentPerHour: { prefix: "ccomment:hour", windowSeconds: 3600, limit: 60 },
  /** Driver reports: 5/day per user (spec 05 §5.6). */
  complaintPerDay: { prefix: "complaint:day", windowSeconds: 86400, limit: 5 },
  /** Signed evidence links for the reporter's own files. */
  evidenceUrlPerHour: { prefix: "evidence:hour", windowSeconds: 3600, limit: 60 },
} as const;

/**
 * Creates an opaque key hash (SHA-256) for rate-limiting.
 * Uses user id for authenticated members, or sha256(ip + salt) for guests.
 * Never stores raw IP addresses, user agents, or personal data.
 */
export function getRateLimitKey(
  prefix: string,
  request: Request,
  userId: string | null = null,
): string {
  if (userId) {
    const raw = `${prefix}|user|${userId}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  const env = serverEnv();
  const salt = env.NEON_AUTH_COOKIE_SECRET ?? "paranaga-guest-ratelimit-salt";
  const ip = ipAddress(request) ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
  const ua = request.headers.get("user-agent") ?? "";
  // Simplify user-agent to coarse family to avoid high cardinality / bypass while staying privacy-preserving
  const uaFamily = ua.slice(0, 32);

  const raw = `${prefix}|guest|${ip}|${uaFamily}|${salt}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Invokes the atomic `ops.take_token` database function.
 * Returns true if the token was taken (within limit), false if rate limited.
 */
export async function takeToken(
  db: Db,
  keyHash: string,
  windowSeconds: number,
  limit: number,
): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`
    select ops.take_token(${keyHash}, ${windowSeconds}, ${limit}) as ok
  `);
  return result.rows[0]?.ok === true;
}

/**
 * Checks a rate limit configuration against the DB.
 * Returns true if permitted, false if rate limited.
 */
export async function checkRateLimit(
  db: Db,
  request: Request,
  config: RateLimitConfig,
  userId: string | null = null,
): Promise<boolean> {
  const key = getRateLimitKey(config.prefix, request, userId);
  return takeToken(db, key, config.windowSeconds, config.limit);
}
