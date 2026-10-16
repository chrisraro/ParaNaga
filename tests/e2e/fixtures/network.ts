// Request-interception fixtures for the public network API (tests only). The JSON files next to
// this one are REAL responses of /api/v1/stops?bbox=, /api/v1/stops/:id, /api/v1/routes, /api/v1/routes/:code,
// /api/v1/network/search-index/:revisionId, /api/v1/terminals/T01 and /api/v1/sources, captured from a
// throwaway branch of Neon main (CAPTURE_E2E_FIXTURES=1 with tests/integration/reference-api.test.ts),
// all naming main's published revision osm-places-2026-10-15; network/head answers with that same
// revision, and /api/v1/network/snapshot/:revisionId with the captured snapshot (Task 12: the home
// pins and offline plans come from it). The client validates them with the shared schemas, so a schema drift fails the run.
// /api/v1/network/lines/:revisionId answers with the captured lines (Task 7), and
// /api/v1/network/walk-graph/:revisionId with walk-graph.json: a SYNTHETIC small extract around Centro
// (flagged in its `fixture` header; tests/unit/walk-graph-e2e-fixture.test.ts rebuilds it).
// No e2e test reaches a database.
import type { BrowserContext, Page, Route } from "@playwright/test";
import routeR1 from "./network/route-r1.json" with { type: "json" };
import routeR2 from "./network/route-r2.json" with { type: "json" };
import routeR3 from "./network/route-r3.json" with { type: "json" };
import routeR4 from "./network/route-r4.json" with { type: "json" };
import routeR5 from "./network/route-r5.json" with { type: "json" };
import routeR6 from "./network/route-r6.json" with { type: "json" };
import routeR7 from "./network/route-r7.json" with { type: "json" };
import routeR8A from "./network/route-r8-a.json" with { type: "json" };
import routeR8B from "./network/route-r8-b.json" with { type: "json" };
import routeR8C from "./network/route-r8-c.json" with { type: "json" };
import routeR8D from "./network/route-r8-d.json" with { type: "json" };
import routesList from "./network/routes.json" with { type: "json" };
import searchIndex from "./network/search-index.json" with { type: "json" };
// SYNTHETIC lazy chunk (Task 14): fake named places (restaurant, cafe, pharmacy, bank, hotel …) for the e2e suite.
import searchPlaces from "./network/search-places.json" with { type: "json" };
import snapshot from "./network/snapshot.json" with { type: "json" };
import lines from "./network/lines.json" with { type: "json" };
import walkGraph from "./network/walk-graph.json" with { type: "json" };
import stopA1 from "./network/stop-a1.json" with { type: "json" };
import stopB18 from "./network/stop-b18.json" with { type: "json" };
import stopCFirst from "./network/stop-c-first.json" with { type: "json" };
import stopsAll from "./network/stops-all.json" with { type: "json" };
import sourcesList from "./network/sources.json" with { type: "json" };
import terminalT01 from "./network/terminal-t01.json" with { type: "json" };
// T06 is built from Data_Sets/naga_transport_seed.json and the captured sources until the next
// capture run writes it (tests/integration/reference-api.test.ts saves it too).
import terminalT06 from "./network/terminal-t06.json" with { type: "json" };
import terminalT14 from "./network/terminal-t14.json" with { type: "json" };

export const STOPS_ALL = stopsAll;
export const STOP_A1 = stopA1;
export const ROUTE_R3 = routeR3;
export const ROUTE_R8A = routeR8A;

const STOPS = new Map([stopA1, stopB18, stopCFirst].map((s) => [s.stop.id, s]));
/** All 11 routes of the approved plan, as captured. */
export const ALL_ROUTES = [routeR1, routeR2, routeR3, routeR4, routeR5, routeR6, routeR7, routeR8A, routeR8B, routeR8C, routeR8D];
const ROUTES = new Map(ALL_ROUTES.map((r) => [r.route.code, r]));

/** The production Cache-Control of each endpoint (src/server/api/http.ts CACHE), for the offline suite. */
export const REAL_CACHE = {
  head: "public, s-maxage=30",
  immutable: "public, s-maxage=31536000, immutable",
  short: "public, s-maxage=300",
  reference: "public, s-maxage=300, stale-while-revalidate=600",
} as const;
type CacheKind = keyof typeof REAL_CACHE;

/** A JSON answer: "no-store" unless `real` asks for the production header of `kind`. */
const reply = (real: boolean) => (route: Route, body: unknown, status = 200, kind: CacheKind = "short") =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": real && status === 200 ? REAL_CACHE[kind] : "no-store" },
    body: JSON.stringify(body),
  });

const notFound = (route: Route) => reply(false)(route, { error: { code: "not_found", message: "Not found.", requestId: "e2e" } }, 404);

export const ROUTES_LIST = routesList;
/** The captured search index of the published revision (233 OSM places, 47 mapped-pin places …). */
export const SEARCH_INDEX = searchIndex;
/** The synthetic lazy places chunk served at /api/v1/network/search-places/:revisionId. */
export const SEARCH_PLACES = searchPlaces;

export const TERMINAL_T01 = terminalT01;
export const TERMINAL_T06 = terminalT06;
export const TERMINAL_T14 = terminalT14;
export const SOURCES = sourcesList;
const TERMINALS = new Map([terminalT01, terminalT06, terminalT14].map((t) => [t.terminal.code, t]));

/** The captured snapshot of the published revision (128 pins, Loops A and B, fare rules F01–F04). */
export const SNAPSHOT = snapshot;
/** The captured approximate paths of the published revision (18 drawn, 3 untraced feeders). */
export const LINES = lines;
/** A synthetic walk graph extract around Centro, served for the published revision. */
export const WALK_GRAPH = walkGraph;

export type NetworkCalls = {
  bboxes: string[];
  stops: string[];
  routes: string[];
  routeLists: number;
  searchIndexes: string[];
  searchPlaces: string[];
  snapshots: string[];
  heads: number;
  terminals: string[];
  lines: string[];
  walkGraphs: string[];
};

/**
 * Answers /api/v1/stops?bbox= (the real 128 pins filtered to the box), /api/v1/stops/:id for the
 * captured stops, /api/v1/routes (the captured list of 11), /api/v1/routes/:code for the
 * captured routes, /api/v1/network/head (the captured revision),
 * /api/v1/network/search-index/:revisionId (that revision only), /api/v1/terminals/:code (T01,
 * T06), /api/v1/sources and /api/v1/network/snapshot/:revisionId; anything else is a 404.
 *
 * `target` is a page, or a browser context for the offline suite: context routes also answer the
 * service worker's own requests. `realCacheHeaders` answers with production Cache-Control headers
 * (otherwise no-store), so the service worker's allow-list really stores them.
 */
export async function routeNetwork(target: Page | BrowserContext, opts: { realCacheHeaders?: boolean } = {}): Promise<NetworkCalls> {
  // Passed to every handler through this closure: each call keeps its own setting.
  const json = reply(opts.realCacheHeaders ?? false);
  const page = target;
  const calls: NetworkCalls = { bboxes: [], stops: [], routes: [], routeLists: 0, searchIndexes: [], searchPlaces: [], snapshots: [], heads: 0, terminals: [],
    lines: [], walkGraphs: [] };
  await page.route(/\/api\/v1\/stops(\?|\/|$)/, async (route) => {
    const url = new URL(route.request().url());
    const id = /\/api\/v1\/stops\/([^/?]+)/.exec(url.pathname)?.[1];
    if (id) {
      calls.stops.push(id);
      const stop = STOPS.get(decodeURIComponent(id));
      return stop ? json(route, stop) : notFound(route);
    }
    const bbox = url.searchParams.get("bbox") ?? "";
    calls.bboxes.push(bbox);
    const [w, s, e, n] = bbox.split(",").map(Number) as [number, number, number, number];
    const stops = stopsAll.stops.filter((p) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n);
    return json(route, { revision: stopsAll.revision, stops });
  });
  // The published revision (Settings → About): the revision every captured response names.
  await page.route(/\/api\/v1\/network\/head(\?.*)?$/, (route) => {
    calls.heads += 1;
    return json(route, stopsAll.revision, 200, "head");
  });
  await page.route(/\/api\/v1\/network\/snapshot\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(/snapshot\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!);
    calls.snapshots.push(id);
    return id === snapshot.revision.revisionId ? json(route, snapshot, 200, "immutable") : notFound(route);
  });
  await page.route(/\/api\/v1\/network\/search-index\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(/search-index\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!);
    calls.searchIndexes.push(id);
    return id === searchIndex.revision.revisionId ? json(route, searchIndex, 200, "immutable") : notFound(route);
  });
  await page.route(/\/api\/v1\/network\/search-places\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(/search-places\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!);
    calls.searchPlaces.push(id);
    return id === searchPlaces.revision.revisionId ? json(route, searchPlaces, 200, "immutable") : notFound(route);
  });
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(/lines\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!);
    calls.lines.push(id);
    return id === lines.revision.revisionId ? json(route, lines, 200, "immutable") : notFound(route);
  });
  await page.route(/\/api\/v1\/network\/walk-graph\/[^/?]+$/, (route) => {
    const id = decodeURIComponent(/walk-graph\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!);
    calls.walkGraphs.push(id);
    return id === snapshot.revision.revisionId ? json(route, walkGraph, 200, "immutable") : notFound(route);
  });
  await page.route(/\/api\/v1\/routes(\?.*)?$/, async (route) => {
    calls.routeLists += 1;
    return json(route, routesList, 200, "short");
  });
  await page.route(/\/api\/v1\/routes\/[^/?]+/, async (route) => {
    const code = decodeURIComponent(/\/api\/v1\/routes\/([^/?]+)/.exec(new URL(route.request().url()).pathname)![1]!).toUpperCase();
    calls.routes.push(code);
    const body = ROUTES.get(code);
    return body ? json(route, body, 200, "short") : notFound(route);
  });
  await page.route(/\/api\/v1\/terminals\/[^/?]+$/, (route) => {
    const code = decodeURIComponent(/\/api\/v1\/terminals\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)![1]!).toUpperCase();
    calls.terminals.push(code);
    const body = TERMINALS.get(code);
    return body ? json(route, body, 200, "reference") : notFound(route);
  });
  await page.route(/\/api\/v1\/sources(\?.*)?$/, (route) => json(route, sourcesList, 200, "reference"));
  return calls;
}
