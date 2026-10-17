import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FLAGS } from "@/domain/moderation/policy";
import { createInMemoryBudget, createJevClient, type JevConfig } from "@/server/adapters/jev/client";

const MODEL = "typesafe/jev-1.13-20260917";
const KEY = "test-key-not-real";
const config: JevConfig = {
  url: "https://jev.test/decisions",
  apiKey: KEY,
  modelId: MODEL,
  policyVersion: "paranaga-community-v1",
  timeoutMs: 1000,
  dailyBudget: 2,
};
const good = { id: "r1", model: MODEL, recommendation: "human_review", confidence: 0.7 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const input = { kind: "community" as const, text: "Where is the Magsaysay stop?", flags: DEFAULT_FLAGS };

function client(fetchImpl: typeof fetch, over: Partial<JevConfig> = {}) {
  return createJevClient({ config: { ...config, ...over }, fetch: fetchImpl, budget: createInMemoryBudget() });
}

describe("Jev client", () => {
  it("returns a verdict and sends bearer auth, pinned model and policy version", async () => {
    const f = vi.fn(async () => json(good));
    const out = await client(f as unknown as typeof fetch).classify(input);
    expect(out).toEqual({ status: "ok", verdict: { recommendation: "human_review", confidence: 0.7 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.url);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MODEL);
    expect(body.policy_version).toBe("paranaga-community-v1");
  });

  it("maps a timeout to unavailable", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const out = await client(f as unknown as typeof fetch, { timeoutMs: 20 }).classify(input);
    expect(out).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it.each([
    [500, "server_error"],
    [503, "server_error"],
    [429, "rate_limited"],
    [401, "auth"],
    [402, "auth"],
    [400, "client_error"],
    [404, "client_error"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    const out = await client((async () => json({}, status)) as unknown as typeof fetch).classify(input);
    expect(out).toEqual({ status: "unavailable", reason });
  });

  it("maps a network error to unavailable", async () => {
    const out = await client((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch).classify(input);
    expect(out).toEqual({ status: "unavailable", reason: "network" });
  });

  it("maps malformed JSON and schema mismatches to malformed", async () => {
    const bad = [
      async () => new Response("not json", { status: 200 }),
      async () => json({ ...good, confidence: 1.2 }),
      async () => json({ ...good, recommendation: "approve" }),
      async () => json({ ...good, extra: true }),
      async () => json({ id: "x" }),
    ];
    for (const f of bad) {
      expect(await client(f as unknown as typeof fetch).classify(input)).toEqual({ status: "unavailable", reason: "malformed" });
    }
  });

  it("discards a response from a different build", async () => {
    const out = await client((async () => json({ ...good, model: "typesafe/jev-1.14-20261001" })) as unknown as typeof fetch).classify(input);
    expect(out).toEqual({ status: "unavailable", reason: "model_mismatch" });
  });

  it("stops calling once the daily budget is used", async () => {
    const f = vi.fn(async () => json(good));
    const c = client(f as unknown as typeof fetch);
    await c.classify(input);
    await c.classify(input);
    expect(await c.classify(input)).toEqual({ status: "unavailable", reason: "budget_exhausted" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not call without an API key", async () => {
    const f = vi.fn(async () => json(good));
    const out = await client(f as unknown as typeof fetch, { apiKey: undefined }).classify(input);
    expect(out).toEqual({ status: "unavailable", reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("never sends complaint text unless both complaint switches are on", async () => {
    const f = vi.fn(async () => json(good));
    const c = client(f as unknown as typeof fetch);
    const complaint = { kind: "complaint" as const, text: "driver named X did Y" };
    for (const flags of [
      DEFAULT_FLAGS,
      { ...DEFAULT_FLAGS, complaintsEnabled: true },
      { ...DEFAULT_FLAGS, complaintsLegalClearance: true },
    ]) {
      expect(await c.classify({ ...complaint, flags })).toEqual({ status: "unavailable", reason: "complaints_not_classified" });
    }
    expect(f).not.toHaveBeenCalled();
    const enabled = { ...DEFAULT_FLAGS, complaintsEnabled: true, complaintsLegalClearance: true };
    expect((await c.classify({ ...complaint, flags: enabled }))?.status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("logs nothing (no key or text leaks)", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await client((async () => json({}, 500)) as unknown as typeof fetch).classify(input);
    spies.forEach((s) => { expect(s).not.toHaveBeenCalled(); s.mockRestore(); });
  });
});
