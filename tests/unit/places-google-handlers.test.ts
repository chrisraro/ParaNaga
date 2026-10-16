// POST /api/v1/places/suggest and /api/v1/places/resolve: the Google Places proxy and its cost
// guard. Google is a fake server (a stubbed fetch that answers only places.googleapis.com); the
// guard repository (rate limit, cache, daily cap) is an in-memory fake. Nothing here reaches
// the network or a database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_DAILY_CAP, resolveResponseSchema, suggestResponseSchema } from "@/domain/places/google";

const env = vi.hoisted(() => ({ GOOGLE_PLACES_API_KEY: "fake-key-for-tests" as string | undefined, PLACES_GOOGLE_ENABLED: "true" as string | undefined }));
vi.mock("@/server/env", () => ({ serverEnv: () => env }));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn({}),
}));

const store = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  cache: new Map<string, unknown>(),
  calls: 0,
}));
vi.mock("@/server/repos/places-guard-repo", () => ({
  countRequest: async (_db: unknown, key: string) => {
    const n = (store.counts.get(key) ?? 0) + 1;
    store.counts.set(key, n);
    return n;
  },
  readCache: async (_db: unknown, key: string) => store.cache.get(key) ?? null,
  writeCache: async (_db: unknown, key: string, payload: unknown) => void store.cache.set(key, payload),
  // The real cap (300) lives in SQL (ops.places_take_call); the fake mirrors it.
  takeGoogleCall: async () => {
    if (store.calls >= 300) return false;
    store.calls += 1;
    return true;
  },
}));

const { POST: suggest } = await import("@/app/api/v1/places/suggest/route");
const { POST: resolve } = await import("@/app/api/v1/places/resolve/route");

const TOKEN = "3f2c1a4e-8b7d-4c6e-9f10-2a3b4c5d6e7f";
const SM = { latitude: 13.6262, longitude: 123.1873 };

type Seen = { url: string; method: string; headers: Headers; body: string | null };
let seen: Seen[] = [];
let googleDown = false;

function fakeGoogle() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "places.googleapis.com") throw new Error(`unexpected host ${url.hostname}`);
    seen.push({ url: url.toString(), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: (init?.body as string) ?? null });
    if (googleDown) return new Response("{}", { status: 500 });
    if (url.pathname === "/v1/places:autocomplete") {
      return Response.json({ suggestions: [{ placePrediction: { placeId: "ChIJsm", structuredFormat: { mainText: { text: "SM City Naga" }, secondaryText: { text: "Naga, Camarines Sur" } } } }] });
    }
    if (url.pathname === "/v1/places/ChIJsm") return Response.json({ location: SM });
    if (url.pathname === "/v1/places/ChIJfar") return Response.json({ location: { latitude: 14.5995, longitude: 120.9842 } });
    return new Response("{}", { status: 404 });
  });
}

const post = (fn: (r: Request) => Promise<Response>, path: string, body: unknown, ip = "203.0.113.7") =>
  fn(new Request(`http://localhost/api/v1/places/${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-real-ip": ip } }));
const ask = (query: string, ip?: string) => post(suggest, "suggest", { query, sessionToken: TOKEN }, ip);
const pick = (placeId: string) => post(resolve, "resolve", { placeId, sessionToken: TOKEN });

let logs: string[] = [];
beforeEach(() => {
  env.GOOGLE_PLACES_API_KEY = "fake-key-for-tests";
  env.PLACES_GOOGLE_ENABLED = "true";
  store.counts.clear();
  store.cache.clear();
  store.calls = 0;
  seen = [];
  googleDown = false;
  logs = [];
  vi.stubGlobal("fetch", fakeGoogle());
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/v1/places/suggest", () => {
  it("asks Google once with the key in a header, a session token, Naga only and a minimal field mask", async () => {
    const res = await ask("SM  City");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(suggestResponseSchema.parse(await res.json())).toEqual({
      status: "ok",
      suggestions: [{ placeId: "ChIJsm", title: "SM City Naga", subtitle: "Naga, Camarines Sur" }],
    });
    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(call.headers.get("x-goog-api-key")).toBe("fake-key-for-tests");
    expect(call.headers.get("x-goog-fieldmask")).toBe("suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat");
    const body = JSON.parse(call.body!);
    expect(body.input).toBe("sm city");
    expect(body.sessionToken).toBe(TOKEN);
    expect(body.locationRestriction.rectangle.low.latitude).toBeGreaterThan(13.5);
    expect(body.locationRestriction.rectangle.high.longitude).toBeLessThan(123.4);
    expect(body.includedRegionCodes).toEqual(["ph"]);
  });

  it("serves a repeated (normalized) query from the cache without calling Google again", async () => {
    await ask("sm city");
    const again = await ask("  SM CITY ");
    expect(suggestResponseSchema.parse(await again.json()).status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(store.calls).toBe(1);
    // The cache key is a keyed hash: no query text is stored.
    for (const key of store.cache.keys()) expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 'unavailable' without touching Google when the key or the switch is missing", async () => {
    for (const [key, flag] of [[undefined, "true"], ["k", undefined], ["k", "TRUE"], ["k", "1"]] as const) {
      env.GOOGLE_PLACES_API_KEY = key;
      env.PLACES_GOOGLE_ENABLED = flag;
      const res = await ask("sm city");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "unavailable" });
    }
    expect(seen).toEqual([]);
    expect(store.counts.size).toBe(0);
  });

  it("never falls back to the public embed key when the server key is missing", async () => {
    env.GOOGLE_PLACES_API_KEY = undefined;
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "public-embed-key");
    try {
      expect(await (await ask("sm city")).json()).toEqual({ status: "unavailable" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(seen).toEqual([]);
  });

  it("stops at the daily cap of 300 Google calls with 'capped' (HTTP 200)", async () => {
    store.calls = GOOGLE_DAILY_CAP;
    const res = await ask("bigg's diner");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "capped" });
    expect(seen).toEqual([]);
  });

  it("rate-limits one address (30 requests per window) without affecting another", async () => {
    for (let i = 0; i < 30; i++) expect((await (await ask(`query ${i}`)).json()).status).toBe("ok");
    expect(await (await ask("one more")).json()).toEqual({ status: "rate_limited" });
    expect((await (await ask("other address", "198.51.100.1")).json()).status).toBe("ok");
    // Addresses are stored only as keyed hashes.
    for (const key of store.counts.keys()) expect(key).not.toContain("203.0.113.7");
  });

  it("rate-limits an IPv6 /64 as one address; IPv4 stays per address", async () => {
    for (let i = 0; i < 30; i++) await ask(`v6 query ${i}`, `2001:db8:1:2::${(i + 1).toString(16)}`);
    expect(await (await ask("same prefix", "2001:db8:1:2:ffff:ffff:ffff:ffff")).json()).toEqual({ status: "rate_limited" });
    expect((await (await ask("next prefix", "2001:db8:1:3::1")).json()).status).toBe("ok");
    expect((await (await ask("ipv4 neighbour", "203.0.113.8")).json()).status).toBe("ok");
  });

  it("refuses bad bodies with 400 before any guard or Google work", async () => {
    for (const body of [{ query: "ab", sessionToken: TOKEN }, { query: "x".repeat(81), sessionToken: TOKEN }, { query: "abc" }, { query: "abc", sessionToken: TOKEN, key: "x" }]) {
      const res = await post(suggest, "suggest", body);
      expect(res.status).toBe(400);
    }
    expect(seen).toEqual([]);
    expect(store.counts.size).toBe(0);
  });

  it("answers 'unavailable' when Google fails, and never logs the query or the key", async () => {
    googleDown = true;
    expect(await (await ask("secret street name")).json()).toEqual({ status: "unavailable" });
    const all = logs.join("\n");
    expect(all).not.toContain("secret street name");
    expect(all).not.toContain("fake-key-for-tests");
  });
});

describe("POST /api/v1/places/resolve", () => {
  it("resolves a place id to a point with the cheapest details field mask (location only)", async () => {
    const res = await pick("ChIJsm");
    expect(resolveResponseSchema.parse(await res.json())).toEqual({ status: "ok", point: { lat: SM.latitude, lng: SM.longitude } });
    const call = seen[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`https://places.googleapis.com/v1/places/ChIJsm?sessionToken=${TOKEN}`);
    expect(call.headers.get("x-goog-fieldmask")).toBe("location");
    // Cached by place id: a second pick costs nothing.
    await pick("ChIJsm");
    expect(seen).toHaveLength(1);
  });

  it("refuses a place outside Naga City", async () => {
    expect(await (await pick("ChIJfar")).json()).toEqual({ status: "outside" });
  });

  it("refuses a place id that could change the Google URL", async () => {
    for (const placeId of ["../places:autocomplete", "a/b", "a?x=1", "a#b"]) expect((await pick(placeId)).status).toBe(400);
    expect(seen).toEqual([]);
  });
});
