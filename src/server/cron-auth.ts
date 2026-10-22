import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
 * A query-string secret is never accepted: URLs end up in logs. No secret configured: always false.
 */
export function cronAuthorized(request: Request, expected: string | undefined): boolean {
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
