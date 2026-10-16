// The service worker allow-list (src/domain/pwa/sw-routes.ts): every allow-listed and denied
// pattern of the Task 12 brief.
import { describe, expect, it } from "vitest";
import { LINES_FORMAT_VERSION } from "@/domain/api/lines-format";
import {
  buildIdFromManifest,
  cacheName,
  cachesToClear,
  classifyRequest,
  isCacheableResponse,
  outdatedCaches,
  revisionsKept,
  shellFor,
  SHELL_PATHS,
  type SwRequestInfo,
} from "@/domain/pwa/sw-routes";

const ORIGIN = "https://paranaga.example";
const REV = "67e56657-7542-462e-b57c-eb14439a0c7a";

function req(path: string, init: { method?: string; mode?: string; headers?: Record<string, string>; origin?: string } = {}): SwRequestInfo {
  const headers = new Headers(init.headers);
  return { method: init.method ?? "GET", url: new URL(path, init.origin ?? ORIGIN), origin: ORIGIN, mode: init.mode ?? "cors", headers };
}
const nav = (path: string) => req(path, { mode: "navigate" });

describe("classifyRequest: navigations", () => {
  it("serves every static shell NetworkFirst with its install-time copy, whatever the query", () => {
    for (const path of SHELL_PATHS) expect(classifyRequest(nav(path))).toEqual({ kind: "shell", path });
    expect(classifyRequest(nav("/app/saved?tab=places"))).toEqual({ kind: "shell", path: "/app/saved" });
    expect(classifyRequest(nav("/app/help/?tab=safety"))).toEqual({ kind: "shell", path: "/app/help" });
    // The Task 14 Help articles (time estimates, vehicle types) open offline from a cold start.
    expect(SHELL_PATHS).toEqual(expect.arrayContaining(["/app/help/how-times-are-estimated", "/app/help/vehicle-types-in-naga", "/app/help/sources"]));
  });

  it("sends any other navigation to the network, with /offline as the fallback", () => {
    for (const path of [`/app/stops/${REV}`, "/app/routes/R8-A", "/"]) {
      expect(classifyRequest(nav(path)), path).toEqual({ kind: "navigate" });
    }
  });

  it("leaves navigations to /api/** (auth callbacks), /admin and /account to the browser", () => {
    for (const path of ["/admin", "/admin/revisions", "/account/me", "/api/auth/callback/google?code=x", "/api/v1/sources"]) {
      expect(classifyRequest(nav(path)), path).toEqual({ kind: "network-only" });
    }
  });
});

describe("classifyRequest: runtime data caches", () => {
  it("caches the immutable snapshot and search index of a revision CacheFirst", () => {
    expect(classifyRequest(req(`/api/v1/network/snapshot/${REV}`))).toEqual({ kind: "cache-first", cache: "snapshot" });
    expect(classifyRequest(req(`/api/v1/network/search-index/${REV}`))).toEqual({ kind: "cache-first", cache: "search-index" });
    expect(classifyRequest(req("/api/v1/network/snapshot/not-a-uuid"))).toEqual({ kind: "network-only" });
  });

  it("caches a revision's approximate paths CacheFirst in a cache keyed by the lines format version", () => {
    expect(classifyRequest(req(`/api/v1/network/lines/${REV}`))).toEqual({ kind: "cache-first", cache: "lines" });
    expect(classifyRequest(req("/api/v1/network/lines/not-a-uuid"))).toEqual({ kind: "network-only" });
    expect(cacheName("lines", "b1")).toBe(`pn-lines-f${LINES_FORMAT_VERSION}-b1`);
    expect(outdatedCaches([cacheName("lines", "b1"), "pn-lines-f0-b1", "pn-lines-b1"], "b1")).toEqual(["pn-lines-f0-b1", "pn-lines-b1"]);
  });

  it("caches a revision's walk graph CacheFirst in its own cache (Task 15)", () => {
    expect(classifyRequest(req(`/api/v1/network/walk-graph/${REV}`))).toEqual({ kind: "cache-first", cache: "walk-graph" });
    expect(classifyRequest(req("/api/v1/network/walk-graph/not-a-uuid"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/walk-graph/${REV}/x`))).toEqual({ kind: "network-only" });
    expect(cacheName("walk-graph", "b1")).toBe("pn-walk-graph-b1");
    expect(outdatedCaches([cacheName("walk-graph", "b1"), "pn-walk-graph-b0"], "b1")).toEqual(["pn-walk-graph-b0"]);
  });

  it("keeps fewer walk graph revisions than the other data caches (its size)", () => {
    expect(revisionsKept("walk-graph")).toBe(2);
    expect(revisionsKept("lines")).toBe(3);
    expect(revisionsKept("snapshot")).toBe(3);
    expect(revisionsKept("search-index")).toBe(3);
  });

  it("serves the published head NetworkFirst with a cached fallback", () => {
    expect(classifyRequest(req("/api/v1/network/head"))).toEqual({ kind: "network-first", cache: "head" });
  });

  it("keeps the reference reads StaleWhileRevalidate", () => {
    for (const path of [`/api/v1/stops/${REV}`, "/api/v1/routes", "/api/v1/routes/R8-A", "/api/v1/terminals/T01", "/api/v1/sources"]) {
      expect(classifyRequest(req(path)), path).toEqual({ kind: "stale-while-revalidate", cache: "reference" });
    }
  });
});

describe("classifyRequest: never cached", () => {
  it("POST /api/v1/plan (coordinates) and every non-GET", () => {
    expect(classifyRequest(req("/api/v1/plan", { method: "POST" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/api/v1/plan"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/app", { method: "POST", mode: "navigate" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/api/v1/sources", { method: "HEAD" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/lines/${REV}`, { method: "POST" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/walk-graph/${REV}`, { method: "POST" }))).toEqual({ kind: "network-only" });
  });

  it("/api/v1/stops?bbox= and any data URL with a query string", () => {
    expect(classifyRequest(req("/api/v1/stops?bbox=123.17,13.6,123.2,13.64"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/api/v1/stops"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/api/v1/routes?x=1"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/snapshot/${REV}?v=2`))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/lines/${REV}?v=2`))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`/api/v1/network/walk-graph/${REV}?lat=13.62&lng=123.18`))).toEqual({ kind: "network-only" });
  });

  it("/api/auth/**, /api/csp-report, /api/health, /admin/**, /account/**", () => {
    for (const path of ["/api/auth/session", "/api/auth/sign-in/email", "/api/csp-report", "/api/health", "/admin", "/admin/x", "/account", "/account/settings"]) {
      expect(classifyRequest(req(path)), path).toEqual({ kind: "network-only" });
    }
    expect(classifyRequest(req("/api/csp-report", { method: "POST" }))).toEqual({ kind: "network-only" });
  });

  it("RSC requests: ?_rsc= and the RSC / prefetch headers, even for a shell or a data path", () => {
    expect(classifyRequest(req("/app/saved?_rsc=abc12"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/app/saved", { headers: { RSC: "1" } }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/app/explore", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/app", { mode: "navigate", headers: { RSC: "1" } }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/api/v1/sources", { headers: { RSC: "1" } }))).toEqual({ kind: "network-only" });
  });

  it("every cross-origin request, map tiles included", () => {
    expect(classifyRequest(req("https://tile.openstreetmap.org/15/27000/15000.png", { origin: "https://tile.openstreetmap.org" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("https://api.maptiler.com/maps/streets/1/2/3.png?key=k", { origin: "https://api.maptiler.com" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req(`https://evil.example/api/v1/network/snapshot/${REV}`, { origin: "https://evil.example" }))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("https://evil.example/app", { origin: "https://evil.example", mode: "navigate" }))).toEqual({ kind: "network-only" });
  });

  it("static files and pages fetched without navigation are left to the precache or the network", () => {
    expect(classifyRequest(req("/theme-init.js"))).toEqual({ kind: "network-only" });
    expect(classifyRequest(req("/app"))).toEqual({ kind: "network-only" });
  });
});

describe("isCacheableResponse", () => {
  const res = (status: number, cacheControl?: string) => ({ status, headers: new Headers(cacheControl ? { "Cache-Control": cacheControl } : {}) });
  it("stores a public 200", () => {
    expect(isCacheableResponse(res(200, "public, s-maxage=31536000, immutable"))).toBe(true);
    expect(isCacheableResponse(res(200, "public, s-maxage=30"))).toBe(true);
    expect(isCacheableResponse(res(200, "public, s-maxage=300, stale-while-revalidate=600"))).toBe(true);
    expect(isCacheableResponse(res(200))).toBe(true);
  });
  it("never stores private, no-store or a non-200", () => {
    expect(isCacheableResponse(res(200, "private, no-cache, no-store, max-age=0, must-revalidate"))).toBe(false);
    expect(isCacheableResponse(res(200, "no-store"))).toBe(false);
    expect(isCacheableResponse(res(200, "Private"))).toBe(false);
    expect(isCacheableResponse(res(200, "private=set-cookie"))).toBe(false);
    expect(isCacheableResponse(res(404, "public"))).toBe(false);
    expect(isCacheableResponse(res(503))).toBe(false);
    expect(isCacheableResponse(res(206, "public"))).toBe(false);
  });
});

describe("cache names", () => {
  it("are keyed by the build; another build's ParaNaga caches are outdated, nothing else is", () => {
    expect(cacheName("snapshot", "b1")).toBe("pn-snapshot-b1");
    expect(outdatedCaches(["pn-snapshot-b1", "pn-snapshot-b0", "pn-shell-b0", "pn-head-b1", "serwist-precache-v2-x", "other"], "b1")).toEqual(["pn-snapshot-b0", "pn-shell-b0"]);
  });

  it("clearing data removes every data cache but keeps the app code (precache, shells)", () => {
    expect(cachesToClear(["serwist-precache-v2-https://x/", "pn-shell-b1", "pn-head-b1", "pn-snapshot-b1", "pn-search-index-b1", "pn-reference-b1", "pn-snapshot-b0", "legacy"])).toEqual([
      "pn-head-b1", "pn-snapshot-b1", "pn-search-index-b1", "pn-reference-b1", "pn-snapshot-b0", "legacy",
    ]);
    // Task 15: the approximate paths and the walk graph go too.
    const lines = cacheName("lines", "b1");
    const walk = cacheName("walk-graph", "b1");
    expect(cachesToClear(["pn-shell-b1", lines, walk, "serwist-precache-v2-https://x/"])).toEqual([lines, walk]);
  });

  it("reads the build id from the precache manifest, with a stable hash fallback", () => {
    expect(buildIdFromManifest([{ url: "/_next/static/chunks/a.js", revision: null }, { url: "/_next/static/5DCJHIUc/_buildManifest.js", revision: null }])).toBe("5DCJHIUc");
    const a = buildIdFromManifest([{ url: "/x.js", revision: "1" }, "/y.js"]);
    expect(a).toBe(buildIdFromManifest(["/y.js", { url: "/x.js", revision: "1" }]));
    expect(a).not.toBe(buildIdFromManifest([{ url: "/x.js", revision: "2" }, "/y.js"]));
  });
});

describe("shellFor", () => {
  it("matches exact shell paths only", () => {
    expect(shellFor("/app/")).toBe("/app");
    expect(shellFor("/app/saved/x")).toBeNull();
    expect(shellFor("/apps")).toBeNull();
  });
});

describe("linkedIconUrls", () => {
  it("maps the static copies of the app icons to the URLs the HTML links", async () => {
    const { linkedIconUrls } = await import("@/domain/pwa/sw-routes");
    expect(
      linkedIconUrls([
        "/_next/static/media/favicon.0fl-w0s_qt298.ico",
        "/_next/static/media/icon.25hlxt1g3l7pc.svg",
        "/_next/static/media/apple-icon.3wkkerl5waqa4.png",
        "/_next/static/media/layers.3muxcl8sz6330.png",
        "/_next/static/chunks/a.js",
      ]),
    ).toEqual(["/favicon.ico?favicon.0fl-w0s_qt298.ico", "/icon.svg?icon.25hlxt1g3l7pc.svg", "/apple-icon.png?apple-icon.3wkkerl5waqa4.png"]);
    // At build time the manifest still names the dist dir.
    expect(linkedIconUrls([".next-e2e/static/media/icon.25hlxt1g3l7pc.svg"])).toEqual(["/icon.svg?icon.25hlxt1g3l7pc.svg"]);
  });
});

describe("acceptHandoff", () => {
  it("accepts the head, a snapshot and a search index the page already fetched", async () => {
    const { acceptHandoff } = await import("@/domain/pwa/sw-routes");
    const ok = (url: string, cacheControl = "public, s-maxage=31536000, immutable") => acceptHandoff({ url, body: "{}", cacheControl }, ORIGIN);
    expect(ok(`/api/v1/network/snapshot/${REV}`)?.cache).toBe("snapshot");
    expect(ok(`/api/v1/network/search-index/${REV}`)?.cache).toBe("search-index");
    expect(ok(`/api/v1/network/lines/${REV}`)?.cache).toBe("lines");
    expect(ok(`/api/v1/network/walk-graph/${REV}`)?.cache).toBe("walk-graph");
    expect(ok("/api/v1/network/head", "public, s-maxage=30")).toEqual({ url: `${ORIGIN}/api/v1/network/head`, body: "{}", cacheControl: "public, s-maxage=30", cache: "head" });
  });

  it("refuses anything the allow-list would not store that way", async () => {
    const { acceptHandoff } = await import("@/domain/pwa/sw-routes");
    const try_ = (e: unknown) => acceptHandoff(e, ORIGIN);
    expect(try_({ url: "/api/v1/plan", body: "{}", cacheControl: "public" })).toBeNull();
    expect(try_({ url: "/api/v1/sources", body: "{}", cacheControl: "public" })).toBeNull(); // SWR, fetched normally
    expect(try_({ url: `https://evil.example/api/v1/network/snapshot/${REV}`, body: "{}", cacheControl: "public" })).toBeNull();
    expect(try_({ url: `/api/v1/network/snapshot/${REV}?x=1`, body: "{}", cacheControl: "public" })).toBeNull();
    expect(try_({ url: `/api/v1/network/snapshot/${REV}`, body: "{}", cacheControl: "no-store" })).toBeNull();
    expect(try_({ url: `/api/v1/network/snapshot/${REV}`, body: "<html>", cacheControl: "public" })).toBeNull();
    expect(try_({ url: `/api/v1/network/snapshot/${REV}`, body: "x".repeat(2_000_001), cacheControl: "public" })).toBeNull();
    // A walk graph larger than the handoff bound (3 MB) is refused; the worker fetches it itself.
    expect(try_({ url: `/api/v1/network/walk-graph/${REV}`, body: `"${"x".repeat(3_000_000)}"`, cacheControl: "public" })).toBeNull();
    expect(try_({ url: `/api/v1/network/walk-graph/${REV}?x=1`, body: "{}", cacheControl: "public" })).toBeNull();
    expect(try_(null)).toBeNull();
    expect(try_({ url: 1 })).toBeNull();
  });
});
