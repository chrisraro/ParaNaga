// /api/csp-report (N8): both report formats, origin-only logging, size cap, rate limit (fails open).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, dbThrows: false }));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, run: (db: unknown) => Promise<unknown>) => {
    if (state.dbThrows) throw new Error("no database");
    return run({});
  },
}));
vi.mock("@/server/ratelimit/rate-limiter", () => ({
  RATE_LIMITS: { cspReportPerMinute: { prefix: "csp:min", windowSeconds: 60, limit: 20 } },
  checkRateLimit: async () => state.allowed,
}));

const post = (body: string, type = "application/csp-report") =>
  new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type }, body });

describe("/api/csp-report", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    state.allowed = true;
    state.dbThrows = false;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("logs a report-uri report as directive + blocked origin only", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const res = await POST(post(JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://evil.example/a/b?c=1" } })));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "csp_violation", directive: "img-src", blocked: "https://evil.example" }));
  });

  it("logs Reporting API (report-to) batches, csp-violation entries only, at most 5", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const entry = { type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline" } };
    const res = await POST(post(JSON.stringify([{ type: "deprecation", body: {} }, ...Array(7).fill(entry)]), "application/reports+json"));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "csp_violation", directive: "script-src-elem", blocked: "inline" }));
  });

  it("400 on a body that is not a report, 413 over 8 KB", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post("42"))).status).toBe(400);
    expect((await POST(post(JSON.stringify({ "csp-report": { x: "y".repeat(9000) } })))).status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("429 and nothing logged when the sender is over its limit; fails open without a database", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const body = JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "data" } });
    state.allowed = false;
    expect((await POST(post(body))).status).toBe(429);
    expect(warn).not.toHaveBeenCalled();
    state.dbThrows = true;
    expect((await POST(post(body))).status).toBe(204);
  });
});
