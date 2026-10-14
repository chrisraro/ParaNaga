import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/server/env";

const prodBase = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://app:pw@example.neon.tech/paranaga",
  NEON_AUTH_BASE_URL: "https://auth.example.neon.tech/paranaga/auth",
  NEON_AUTH_COOKIE_SECRET: "x".repeat(32),
  CRON_SECRET: "y".repeat(32),
};

describe("server env (spec §3.14)", () => {
  it("development works with nothing configured", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTO_PUBLISH_ENABLED).toBe(false);
    expect(env.JEV_COMPLAINTS_ENABLED).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const env = parseServerEnv({ NODE_ENV: "development", OPENROUTER_API_KEY: "  " });
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it.each(["typesafe/jev-1.13", "jev-latest", "typesafe/jev-router"])(
    "production refuses the Jev alias %s",
    (model) => {
      expect(() => parseServerEnv({ ...prodBase, JEV_MODEL_ID: model })).toThrow(/dated Jev build/);
    },
  );

  it("production accepts a dated Jev build", () => {
    const env = parseServerEnv({ ...prodBase, JEV_MODEL_ID: "typesafe/jev-1.13-20260917" });
    expect(env.JEV_MODEL_ID).toBe("typesafe/jev-1.13-20260917");
  });

  it("production deployments require database, auth and cron secrets", () => {
    expect(() =>
      parseServerEnv({ VERCEL_ENV: "production", JEV_MODEL_ID: "typesafe/jev-1.13-20260917" }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      parseServerEnv({ APP_ENV: "production", JEV_MODEL_ID: "typesafe/jev-1.13-20260917" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("a local `next start` (NODE_ENV=production, no deployment env) is not strict", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production" })).not.toThrow();
  });

  it("error messages never echo secret values", () => {
    try {
      parseServerEnv({ NODE_ENV: "development", NEON_AUTH_COOKIE_SECRET: "too-short-secret-value" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("too-short-secret-value");
    }
  });
});
