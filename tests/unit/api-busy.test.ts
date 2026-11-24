// A pool that runs out of connections, a deadlock and a serialization failure answer 503 "busy"
// (the client retries), never 500.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: () => Promise.reject(new Error("timeout exceeded when trying to connect")),
}));

const { authedRoute, publicGet } = await import("@/server/api/http");
const { onDuplicate } = await import("@/server/db/pg-error");

describe("pool timeout", () => {
  it("a public read answers 503 unavailable", async () => {
    const response = await publicGet(new Request("http://localhost/api/v1/x"), "x", z.object({}), async ({ withDb }) =>
      withDb(async () => ({ body: {}, cacheControl: "no-store" })),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it("a signed-in route answers 503 unavailable", async () => {
    const response = await authedRoute(new Request("http://localhost/api/v1/x"), "x", async () => {
      throw new Error("timeout exceeded when trying to connect");
    });
    expect(response.status).toBe(503);
  });
});

describe("database conflicts", () => {
  const failWith = (error: unknown) =>
    authedRoute(new Request("http://localhost/api/v1/x"), "x", async () => {
      throw error;
    });

  it.each(["40P01", "40001", "55P03", "57014"])("%s answers 503 with Retry-After, wrapped or not (admin routes: admin-handlers.test.ts)", async (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = Object.assign(new Error("deadlock detected; secret-row-text"), { code });
    const wrapped = new Error("Failed query", { cause: raw });
    for (const error of [raw, wrapped]) {
      const response = await failWith(error);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      const text = await response.text();
      expect(JSON.parse(text).error.code).toBe("unavailable");
      expect(text).not.toContain("secret-row-text");
      expect(JSON.parse(String(warn.mock.lastCall?.[0]))).toMatchObject({ event: "api_busy", code });
      expect(String(warn.mock.lastCall?.[0])).not.toContain("secret-row-text");
    }
  });

  it("other database errors stay 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failWith(Object.assign(new Error("x"), { code: "23505" }))).status).toBe(500);
  });
});

describe("onDuplicate", () => {
  const dup = (constraint?: string) => new Error("Failed query", { cause: Object.assign(new Error("dup"), { code: "23505", constraint }) });

  it("runs the whole transaction once more on the named constraint only", async () => {
    const run = vi.fn().mockRejectedValueOnce(dup("post_key")).mockResolvedValueOnce("stored");
    expect(await onDuplicate("post_key", run)).toBe("stored");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("a second violation is thrown, not retried again", async () => {
    const run = vi.fn().mockRejectedValue(dup("post_key"));
    await expect(onDuplicate("post_key", run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it.each([dup("other_key"), dup(undefined), Object.assign(new Error("x"), { code: "23503", constraint: "post_key" }), new Error("boom")])(
    "never retries anything else (%#)",
    async (error) => {
      const run = vi.fn().mockRejectedValue(error);
      await expect(onDuplicate("post_key", run)).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );
  it("with a recover step, the original is not run twice (toggles)", async () => {
    const run = vi.fn().mockRejectedValue(dup("reaction_pkey"));
    expect(await onDuplicate("reaction_pkey", run, async () => "read")).toBe("read");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
