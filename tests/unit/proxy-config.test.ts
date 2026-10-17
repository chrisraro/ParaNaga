import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/neon", () => ({ neonAuth: () => null }));

const { config } = await import("@/proxy");

describe("proxy matcher", () => {
  it("guards account and admin", () => {
    expect(config.matcher).toContain("/account/:path*");
    expect(config.matcher).toContain("/admin/:path*");
  });

  it("also runs on /app, but only when Neon's one-time session token is in the URL (Google return trip)", () => {
    const oauthReturn = config.matcher.find((m) => typeof m === "object" && m.source === "/app/:path*");
    expect(oauthReturn).toEqual({
      source: "/app/:path*",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    });
  });

  it("never matches plain /app navigation", () => {
    expect(config.matcher.filter((m) => m === "/app/:path*")).toHaveLength(0);
  });
});
