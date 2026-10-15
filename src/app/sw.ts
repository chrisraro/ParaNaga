/// <reference lib="webworker" />
// ParaNaga's service worker (Task 12, decision D6: Serwist through its Turbopack integration).
// Bundled by esbuild in src/app/serwist/[path]/route.ts and served at /serwist/sw.js (scope /).
//
// Which request goes where is decided by the pure allow-list in src/domain/pwa/sw-routes.ts
// (unit-tested); this file only wires it to Serwist:
//  - precache: build assets, icons, public files (/theme-init.js) from the build manifest;
//  - the static shells (/app, /app/saved, …, /offline) cached at install, served NetworkFirst (3 s);
//    any other navigation goes to the network and falls back to /offline;
//  - data caches keyed by revision (in the URL) AND build id (in the cache name), so a deploy that
//    changes a response shape never reads an old copy;
//  - everything else never touches a cache (POST /api/v1/plan, RSC, auth, admin, tiles).
// A new worker waits until the app asks it to take over (the "Reload" card, never mid-guidance).
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate, type PrecacheEntry, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";
import {
  buildIdFromManifest,
  cacheName,
  classifyRequest,
  HEAD_TIMEOUT_S,
  isCacheableResponse,
  NAVIGATION_TIMEOUT_S,
  OFFLINE_PATH,
  outdatedCaches,
  REFERENCE_MAX_AGE_S,
  REFERENCE_MAX_ENTRIES,
  REVISIONS_KEPT,
  SHELL_PATHS,
  type SwRoute,
} from "@/domain/pwa/sw-routes";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const manifest = self.__SW_MANIFEST ?? [];
const BUILD_ID = buildIdFromManifest(manifest);
const SHELL_CACHE = cacheName("shell", BUILD_ID);

/** Stores only a 200 that is neither private nor no-store. */
const onlyCacheable: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) => (isCacheableResponse(response) ? response : null),
};

const strategies = {
  snapshot: new CacheFirst({
    cacheName: cacheName("snapshot", BUILD_ID),
    plugins: [onlyCacheable, new ExpirationPlugin({ maxEntries: REVISIONS_KEPT })],
  }),
  "search-index": new CacheFirst({
    cacheName: cacheName("search-index", BUILD_ID),
    plugins: [onlyCacheable, new ExpirationPlugin({ maxEntries: REVISIONS_KEPT })],
  }),
  head: new NetworkFirst({
    cacheName: cacheName("head", BUILD_ID),
    networkTimeoutSeconds: HEAD_TIMEOUT_S,
    plugins: [onlyCacheable, new ExpirationPlugin({ maxEntries: 1 })],
  }),
  reference: new StaleWhileRevalidate({
    cacheName: cacheName("reference", BUILD_ID),
    plugins: [onlyCacheable, new ExpirationPlugin({ maxEntries: REFERENCE_MAX_ENTRIES, maxAgeSeconds: REFERENCE_MAX_AGE_S })],
  }),
};

async function cachedShell(path: string): Promise<Response | undefined> {
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(path, { ignoreSearch: true });
}

async function offlinePage(): Promise<Response> {
  return (await cachedShell(OFFLINE_PATH)) ?? Response.error();
}

/** NetworkFirst with a timeout for a static shell; its install-time copy when the network fails. */
async function shellNavigation(request: Request, path: string): Promise<Response> {
  const network = fetch(request);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_S * 1000));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // offline: fall through to the cached copy
  }
  const cached = await cachedShell(path);
  if (cached) return cached;
  // No copy (should not happen after install): wait for the network after all, else /offline.
  return network.catch(() => offlinePage());
}

async function otherNavigation(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return offlinePage();
  }
}

const serwist = new Serwist({
  precacheEntries: manifest,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) => {
        const route = classifyRequest({ method: request.method, url, origin: self.location.origin, mode: request.mode, headers: request.headers });
        return route.kind === "network-only" ? false : route;
      },
      handler: async (options) => {
        const route = options.params as unknown as SwRoute;
        const request = options.request;
        switch (route.kind) {
          case "shell":
            return shellNavigation(request, route.path);
          case "navigate":
            return otherNavigation(request);
          case "cache-first":
            return strategies[route.cache].handle(options);
          case "network-first":
            return strategies.head.handle(options);
          case "stale-while-revalidate":
            return strategies.reference.handle(options);
          default:
            return fetch(request);
        }
      },
    },
  ],
});

/**
 * Best effort at install: the published head, its snapshot and its search index, through the same
 * strategies (and so the same allow-list, expiry and cache names), so the map, its pins, search
 * and offline planning work offline after the very first visit (the page's own requests on that
 * visit happened before this worker controlled it). Never fails the install.
 */
async function warmNetworkData(event: ExtendableEvent): Promise<void> {
  const get = (url: string) => new Request(url, { headers: { accept: "application/json" } });
  try {
    const head = (await (await strategies.head.handle({ event, request: get("/api/v1/network/head") })).json()) as { revisionId?: unknown };
    if (typeof head.revisionId !== "string") return;
    const id = encodeURIComponent(head.revisionId);
    await Promise.all([
      strategies.snapshot.handle({ event, request: get(`/api/v1/network/snapshot/${id}`) }),
      strategies["search-index"].handle({ event, request: get(`/api/v1/network/search-index/${id}`) }),
    ]);
  } catch {
    // Offline or a server error: the caches fill as the app is used.
  }
}

self.addEventListener("install", (event) => {
  // The shells of THIS build (they reference this build's chunks), bypassing the HTTP cache.
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PATHS.map((p) => new Request(p, { cache: "reload" })))),
      warmNetworkData(event),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(outdatedCaches(names, BUILD_ID).map((n) => caches.delete(n)))));
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === "SKIP_WAITING") void self.skipWaiting();
});

serwist.addEventListeners();
