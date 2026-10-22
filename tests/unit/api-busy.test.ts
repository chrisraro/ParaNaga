// A pool that runs out of connections answers 503 "busy" (the client retries), never 500.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: () => Promise.reject(new Error("timeout exceeded when trying to connect")),
}));

const { authedRoute, publicGet } = await import("@/server/api/http");

describe("pool timeout", () => {
  it("a public read answers 503 unavailable", async () => {
    const response = await publicGet(new Request("http://localhost/api/v1/x"), "x", z.object({}), async ({ withDb }) =>
      withDb(async () => ({ body: {}, cacheControl: "no-store" })),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it("a signed-in route answers 503 unavailable", async () => {
    const response = await authedRoute(new Request("http://localhost/api/v1/x"), "x", async () => {
      throw new Error("timeout exceeded when trying to connect");
    });
    expect(response.status).toBe(503);
  });
});
