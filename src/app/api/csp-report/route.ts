import { withRequestContext } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";
import { safeRequestId } from "@/server/request-id";

const MAX_BYTES = 8 * 1024;
const MAX_LOGGED = 5;

type Violation = { directive: string; blocked: string };

/** Keyword values such as 'inline' or 'eval' stay as they are; URLs are cut to their origin. */
const originOnly = (blocked: string) => {
  try {
    return new URL(blocked).origin;
  } catch {
    return blocked;
  }
};

/**
 * Both report formats: `report-uri` sends {"csp-report": {...}} (application/csp-report), the
 * Reporting API (`report-to`, Reporting-Endpoints) sends an array of {type: "csp-violation", body}.
 */
function violations(parsed: unknown): Violation[] {
  const pick = (r: Record<string, unknown>): Violation => ({
    directive: String(r["effectiveDirective"] ?? r["violated-directive"] ?? r["effective-directive"] ?? "unknown").slice(0, 80),
    blocked: originOnly(String(r["blockedURL"] ?? r["blocked-uri"] ?? "unknown")).slice(0, 120),
  });
  if (Array.isArray(parsed)) {
    return parsed
      .filter((e): e is { type: string; body: Record<string, unknown> } => !!e && typeof e === "object" && (e as { type?: unknown }).type === "csp-violation" && typeof (e as { body?: unknown }).body === "object" && (e as { body?: unknown }).body !== null)
      .slice(0, MAX_LOGGED)
      .map((e) => pick(e.body));
  }
  if (parsed && typeof parsed === "object") {
    const report = (parsed as { "csp-report"?: unknown })["csp-report"];
    return [pick(report && typeof report === "object" ? (report as Record<string, unknown>) : {})];
  }
  throw new SyntaxError("not a report");
}

/** True when this sender is over its budget. Fails open: this is a log sink, never a gate. */
async function overLimit(request: Request): Promise<boolean> {
  try {
    const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
    return await withRequestContext({ userId: null, requestId }, async (db) => !(await checkRateLimit(db, request, RATE_LIMITS.cspReportPerMinute)));
  } catch {
    return false;
  }
}

// Receives CSP violation reports (spec §5.10; the policy is enforced since N8).
// Logs only the directive and blocked origin, never full URLs or page content.
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES) return new Response(null, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) return new Response(null, { status: 413 });
  let found: Violation[];
  try {
    found = violations(JSON.parse(text));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (await overLimit(request)) return new Response(null, { status: 429 });
  for (const v of found) console.warn(JSON.stringify({ event: "csp_violation", ...v }));
  return new Response(null, { status: 204 });
}
