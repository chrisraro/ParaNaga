import { describe, expect, it } from "vitest";
import { getRateLimitKey, RATE_LIMITS } from "@/server/ratelimit/rate-limiter";

describe("rate limiter key generation", () => {
  it("generates deterministic SHA-256 hash for authenticated users", () => {
    const req = new Request("http://localhost/api/v1/plan");
    const key1 = getRateLimitKey("plan:min", req, "user-123");
    const key2 = getRateLimitKey("plan:min", req, "user-123");
    const keyDiffUser = getRateLimitKey("plan:min", req, "user-456");

    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyDiffUser);
  });

  it("generates deterministic SHA-256 hash for guest requests by IP and UA family", () => {
    const req1 = new Request("http://localhost/api/v1/plan", {
      headers: {
        "x-forwarded-for": "203.0.113.195",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
    });

    const req2 = new Request("http://localhost/api/v1/plan", {
      headers: {
        "x-forwarded-for": "203.0.113.195",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
    });

    const reqDiffIp = new Request("http://localhost/api/v1/plan", {
      headers: {
        "x-forwarded-for": "198.51.100.42",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
    });

    const key1 = getRateLimitKey("plan:min", req1, null);
    const key2 = getRateLimitKey("plan:min", req2, null);
    const keyDiff = getRateLimitKey("plan:min", reqDiffIp, null);

    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyDiff);
  });

  it("separates different prefix namespaces for the same client", () => {
    const req = new Request("http://localhost/api/v1/plan", {
      headers: { "x-forwarded-for": "203.0.113.195" },
    });
    const keyMin = getRateLimitKey(RATE_LIMITS.planPerMinute.prefix, req, null);
    const keyDay = getRateLimitKey(RATE_LIMITS.planPerDay.prefix, req, null);

    expect(keyMin).not.toBe(keyDay);
  });
});
