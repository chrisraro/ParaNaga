/// <reference lib="webworker" />
// ParaNaga's service worker (Task 12, decision D6: Serwist through its Turbopack integration).
// Bundled by esbuild in src/app/serwist/[path]/route.ts and served at /serwist/sw.js (scope /).
//
// Which request goes where is decided by the pure allow-list in src/domain/pwa/sw-routes.ts
// (unit-tested); this file only wires it to Serwist:
//  - precache: build assets, icons, public files (/theme-init.js) from the build manifest;
//  - the static shells (/app, /app/saved, …, /offline) cached at install (each checked storable),
//    served NetworkFirst (3 s);
//    any other navigation goes to the network and falls back to /offline;
//  - data caches keyed by revision (in the URL) AND build id (in the cache name), so a deploy that
//    changes a response shape never reads an old copy; no data is downloaded at install: the page
//    hands over the copies it fetched before this worker controlled it (STORE_FETCHED_DATA);
//  - everything else never touches a cache (POST /api/v1/plan, RSC, auth, admin, tiles).
// A new worker waits until the app asks it to take over (the "Reload" card, never mid-guidance).
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate, type PrecacheEntry, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";
import {
  acceptHandoff,
  buildIdFromManifest,
  HANDOFF_MESSAGE,
  cacheName,
  classifyRequest,
  HEAD_TIMEOUT_S,
  isCacheableResponse,
  NAVIGATION_TIMEOUT_S,
  OFFLINE_PATH,
  outdatedCaches,
  REFERENCE_MAX_AGE_S,
  REFERENCE_MAX_ENTRIES,
  revisionsKept,
  SHELL_PATHS,
  type RevisionCache,
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

/** An immutable per-revision file: CacheFirst, keeping the last few revisions. */
const revisionCache = (cache: RevisionCache) =>
  new CacheFirst({
    cacheName: cacheName(cache, BUILD_ID),
    plugins: [onlyCacheable, new ExpirationPlugin({ maxEntries: revisionsKept(cache) })],
  });

const strategies = {
  snapshot: revisionCache("snapshot"),
  "search-index": revisionCache("search-index"),
  "search-places": revisionCache("search-places"),
  lines: revisionCache("lines"),
  "walk-graph": revisionCache("walk-graph"),
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
  // A failed fetch resolves to null (never an unhandled rejection, even after the timeout won).
  const network = fetch(request).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_S * 1000);
  });
  const first = await Promise.race([network, timeout]);
  clearTimeout(timer);
  if (first) return first;
  const cached = await cachedShell(path);
  if (cached) return cached;
  // No copy (should not happen after install): wait for the network after all, else /offline.
  return (await network) ?? offlinePage();
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
 * The shells of THIS build (they reference this build's chunks), bypassing the HTTP cache. Each
 * must be storable (a 200 that is neither private nor no-store): otherwise the install fails
 * loudly instead of storing per-request HTML.
 */
async function cacheShells(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_PATHS.map(async (path) => {
      const response = await fetch(new Request(path, { cache: "reload" }));
      if (!isCacheableResponse(response)) {
        throw new Error(`Shell ${path} cannot be cached (status ${response.status}, Cache-Control ${response.headers.get("Cache-Control")})`);
      }
      await cache.put(path, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  // No data is downloaded at install (low-data friendly): the page hands over what it already
  // fetched before this worker controlled it (STORE_FETCHED_DATA below), and everything else is
  // cached as it is used (the search index on the first search).
  event.waitUntil(cacheShells());
});

/** Stores the page's copies of the head / snapshot / search index / lines / walk graph unless one is cached already. */
async function storeHandoff(entries: unknown): Promise<void> {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const accepted = acceptHandoff(entry, self.location.origin);
    if (!accepted) continue;
    const cache = await caches.open(cacheName(accepted.cache, BUILD_ID));
    if (accepted.cache !== "head" && (await cache.match(accepted.url))) continue;
    const headers = { "Content-Type": "application/json", "Cache-Control": accepted.cacheControl, Date: new Date().toUTCString() };
    await cache.put(accepted.url, new Response(accepted.body, { status: 200, headers }));
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(outdatedCaches(names, BUILD_ID).map((n) => caches.delete(n)))));
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; entries?: unknown } | null;
  if (data?.type === "SKIP_WAITING") void self.skipWaiting();
  // Only from a page of this origin (a WindowClient); anything else is ignored.
  if (data?.type === HANDOFF_MESSAGE && event.source && "url" in event.source && new URL(event.source.url).origin === self.location.origin) {
    event.waitUntil(storeHandoff(data.entries));
  }
});

// A tap on the Para / arrival notification brings the running app forward (or opens it).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow("/app");
    }),
  );
});

serwist.addEventListeners();
