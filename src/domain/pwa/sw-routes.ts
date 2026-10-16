// The service worker's allow-list (spec §3.11, Task 12), as pure functions so every rule is
// unit-tested (tests/unit/sw-routes.test.ts) and the worker (src/app/sw.ts) only wires them to
// Serwist strategies. Nothing here touches the network or a cache.
import { LINES_FORMAT_VERSION } from "../api/lines-format";
//
// Rules:
//  - Build assets, icons, the manifest and public files (/theme-init.js) are precached by Serwist
//    from the build output; they never reach these rules.
//  - Navigations to the static shells: NetworkFirst (3 s), falling back to the copy cached at
//    install. Any other navigation: network, falling back to /offline. HTML is never cached at
//    runtime (dynamic pages are `private, no-store`). Navigations to /api/**, /admin/** and
//    /account/** are not touched at all (auth redirect flows bypass the worker).
//  - Runtime data caches, GET and same-origin only: the immutable snapshot and search index of a
//    revision (CacheFirst, 3 revisions each; the approximate paths too, in a cache keyed by the
//    lines format version as well as the build), the published head (NetworkFirst, 2 s), and the
//    reference reads (StaleWhileRevalidate, 200 entries, 30 days).
//  - Everything else is network-only and never touches a cache: POST /api/v1/plan (coordinates),
//    /api/v1/stops?bbox=, /api/auth/**, /api/csp-report, RSC requests, /admin/**, /account/**,
//    and every cross-origin request (map tiles are never cached: MapTiler terms, no offline map).
//  - A response is stored only when it is a 200 without `private` or `no-store`.

/**
 * The static shells, cached at install and served offline (cold start of /app, /app/saved, …).
 * Search is one too: its index is cached per revision, so it works offline from a cold start.
 */
export const SHELL_PATHS = ["/app", "/app/saved", "/app/more", "/app/help", "/app/explore", "/app/mynaga", "/app/search", "/offline"] as const;
export type ShellPath = (typeof SHELL_PATHS)[number];
export const OFFLINE_PATH = "/offline";

export const NAVIGATION_TIMEOUT_S = 3;
export const HEAD_TIMEOUT_S = 2;
export const REVISIONS_KEPT = 3;
export const REFERENCE_MAX_ENTRIES = 200;
export const REFERENCE_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Every cache ParaNaga's worker creates starts with this; the build id is appended. */
export const CACHE_PREFIX = "pn-";
export const CACHE_KINDS = ["shell", "head", "snapshot", "search-index", "lines", "reference"] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];

export type SwRoute =
  | { kind: "shell"; path: ShellPath }
  | { kind: "navigate" }
  | { kind: "cache-first"; cache: "snapshot" | "search-index" | "lines" }
  | { kind: "network-first"; cache: "head" }
  | { kind: "stale-while-revalidate"; cache: "reference" }
  | { kind: "network-only" };

export type SwRequestInfo = {
  method: string;
  /** The request URL. */
  url: URL;
  /** The worker's own origin (self.location.origin). */
  origin: string;
  /** Request.mode: "navigate" for document navigations. */
  mode: string;
  headers: { get(name: string): string | null };
};

const NETWORK_ONLY: SwRoute = { kind: "network-only" };
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SNAPSHOT = new RegExp(`^/api/v1/network/snapshot/${UUID}$`);
const SEARCH_INDEX = new RegExp(`^/api/v1/network/search-index/${UUID}$`);
const LINES = new RegExp(`^/api/v1/network/lines/${UUID}$`);
const REFERENCE = [/^\/api\/v1\/stops\/[^/]+$/, /^\/api\/v1\/routes$/, /^\/api\/v1\/routes\/[^/]+$/, /^\/api\/v1\/terminals\/[^/]+$/, /^\/api\/v1\/sources$/];
const PRIVATE_SECTIONS = /^\/(admin|account)(\/|$)/;

const trimSlash = (path: string) => (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path);

/** The static shell a path is, or null. The query string never matters (?tab=places). */
export function shellFor(pathname: string): ShellPath | null {
  const path = trimSlash(pathname);
  return (SHELL_PATHS as readonly string[]).includes(path) ? (path as ShellPath) : null;
}

/** True for a React Server Components request (soft navigation or prefetch): never cached. */
export function isRscRequest(info: Pick<SwRequestInfo, "url" | "headers">): boolean {
  return info.headers.get("RSC") === "1" || info.url.searchParams.has("_rsc") || info.headers.get("Next-Router-Prefetch") === "1";
}

export function classifyRequest(info: SwRequestInfo): SwRoute {
  if (info.url.origin !== info.origin) return NETWORK_ONLY; // tiles and every other host
  if (info.method !== "GET") return NETWORK_ONLY; // POST /api/v1/plan, Server Actions, reports
  const path = info.url.pathname;
  if (isRscRequest(info)) return NETWORK_ONLY;
  if (info.mode === "navigate") {
    // Auth redirects (/api/auth/** callbacks), admin and account never pass through the worker.
    if (PRIVATE_SECTIONS.test(path) || path.startsWith("/api/")) return NETWORK_ONLY;
    const shell = shellFor(path);
    return shell ? { kind: "shell", path: shell } : { kind: "navigate" };
  }
  if (!path.startsWith("/api/v1/")) return NETWORK_ONLY;
  // A query string on a data URL is never ours (e.g. /api/v1/stops?bbox=, which carries a map view).
  if (info.url.search !== "") return NETWORK_ONLY;
  if (SNAPSHOT.test(path)) return { kind: "cache-first", cache: "snapshot" };
  if (SEARCH_INDEX.test(path)) return { kind: "cache-first", cache: "search-index" };
  if (LINES.test(path)) return { kind: "cache-first", cache: "lines" };
  if (path === "/api/v1/network/head") return { kind: "network-first", cache: "head" };
  if (REFERENCE.some((re) => re.test(path))) return { kind: "stale-while-revalidate", cache: "reference" };
  return NETWORK_ONLY;
}

/** Only a complete 200 that is neither `private` nor `no-store` is ever stored. */
export function isCacheableResponse(response: { status: number; headers: { get(name: string): string | null } }): boolean {
  if (response.status !== 200) return false;
  const cacheControl = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  return !/(^|[\s,])(private|no-store)([\s,=]|$)/.test(cacheControl);
}

/** The lines cache also names LINES_FORMAT_VERSION: a format bump starts an empty cache (a refetch). */
export function cacheName(kind: CacheKind, buildId: string): string {
  if (kind === "lines") return `${CACHE_PREFIX}lines-f${LINES_FORMAT_VERSION}-${buildId}`;
  return `${CACHE_PREFIX}${kind}-${buildId}`;
}

/** ParaNaga caches of another build (removed when this build's worker activates). */
export function outdatedCaches(names: readonly string[], buildId: string): string[] {
  const current = new Set(CACHE_KINDS.map((k) => cacheName(k, buildId)));
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && !current.has(n));
}

/**
 * What "Clear data on this device" deletes: every cache except the app code itself (Serwist's
 * precache of build assets, and the static shells), so the app still opens offline afterwards
 * but keeps no network data.
 */
export function cachesToClear(names: readonly string[]): string[] {
  return names.filter((n) => !n.includes("precache") && !n.startsWith(`${CACHE_PREFIX}shell-`));
}

/**
 * The build id, read from the precache manifest (Next writes /_next/static/{buildId}/_buildManifest.js).
 * Caches are keyed by it, so a deploy that changes a response shape never reads an old copy.
 * Falls back to a hash of the manifest when that file is missing.
 */
export function buildIdFromManifest(entries: readonly (string | { url: string; revision?: string | null })[]): string {
  const urls = entries.map((e) => (typeof e === "string" ? e : `${e.url}#${e.revision ?? ""}`));
  for (const url of urls) {
    const match = /\/_next\/static\/([^/]+)\/_buildManifest\.js/.exec(url);
    if (match) return match[1]!;
  }
  // FNV-1a over the sorted manifest: stable for one build, different for another.
  let hash = 0x811c9dc5;
  for (const ch of [...urls].sort().join("\n")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `m${hash.toString(36)}`;
}

/**
 * The app icons as the HTML links them: Next serves src/app/icon.svg (and favicon.ico,
 * apple-icon.png) at "/icon.svg?icon.{hash}.svg" and copies the file to
 * "/_next/static/media/icon.{hash}.svg". For each such copy in the precache manifest, the linked URL
 * is precached too (it carries the content hash, so it needs no revision).
 */
export function linkedIconUrls(manifestUrls: readonly string[]): string[] {
  const out: string[] = [];
  for (const url of manifestUrls) {
    // Matched on the end only: at build time the manifest still names the dist dir (".next/static/…").
    const m = /\/static\/media\/(favicon|icon|apple-icon)\.([^/]+)\.(ico|svg|png)$/.exec(url);
    if (m) out.push(`/${m[1]}.${m[3]}?${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

/** The page's copies of data it fetched before the worker controlled it (see data-handoff.ts). */
export const HANDOFF_MESSAGE = "STORE_FETCHED_DATA";
export const HANDOFF_MAX_BYTES = 2_000_000;
export type HandoffEntry = { url: string; body: string; cacheControl: string };
export type AcceptedHandoff = HandoffEntry & { cache: "head" | "snapshot" | "search-index" | "lines" };

/**
 * Checks one entry the page offers: a same-origin URL that the allow-list would store as the
 * head, a snapshot or a search index, a JSON body of bounded size, and a Cache-Control that may be
 * stored. Anything else is refused (null), so the handoff can never widen what is cached.
 */
export function acceptHandoff(entry: unknown, origin: string): AcceptedHandoff | null {
  if (!entry || typeof entry !== "object") return null;
  const { url, body, cacheControl } = entry as Record<string, unknown>;
  if (typeof url !== "string" || typeof body !== "string" || typeof cacheControl !== "string") return null;
  if (body.length > HANDOFF_MAX_BYTES) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return null;
  }
  const route = classifyRequest({ method: "GET", url: parsed, origin, mode: "cors", headers: { get: () => null } });
  const cache = route.kind === "cache-first" ? route.cache : route.kind === "network-first" ? route.cache : null;
  if (!cache) return null;
  if (!isCacheableResponse({ status: 200, headers: { get: (n: string) => (n.toLowerCase() === "cache-control" ? cacheControl : null) } })) return null;
  try {
    JSON.parse(body);
  } catch {
    return null;
  }
  return { url: parsed.href, body, cacheControl, cache };
}
