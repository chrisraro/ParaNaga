// Request-interception fixtures for the public network API (tests only). The JSON files next to
// this one are REAL responses of /api/v1/stops?bbox=, /api/v1/stops/:id and /api/v1/routes/:code,
// captured from a throwaway Neon branch with the Naga import applied (revision
// provisional-loops-2026-10-15); the client validates them with the shared schemas, so a schema
// drift fails the run. No e2e test reaches a database.
import type { Page, Route } from "@playwright/test";
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
import stopA1 from "./network/stop-a1.json" with { type: "json" };
import stopB18 from "./network/stop-b18.json" with { type: "json" };
import stopCFirst from "./network/stop-c-first.json" with { type: "json" };
import stopsAll from "./network/stops-all.json" with { type: "json" };

export const STOPS_ALL = stopsAll;
export const STOP_A1 = stopA1;
export const ROUTE_R3 = routeR3;
export const ROUTE_R8A = routeR8A;

const STOPS = new Map([stopA1, stopB18, stopCFirst].map((s) => [s.stop.id, s]));
/** All 11 routes of the approved plan, as captured. */
export const ALL_ROUTES = [routeR1, routeR2, routeR3, routeR4, routeR5, routeR6, routeR7, routeR8A, routeR8B, routeR8C, routeR8D];
const ROUTES = new Map(ALL_ROUTES.map((r) => [r.route.code, r]));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

const notFound = (route: Route) => json(route, { error: { code: "not_found", message: "Not found.", requestId: "e2e" } }, 404);

export type NetworkCalls = { bboxes: string[]; stops: string[]; routes: string[] };

/**
 * Answers /api/v1/stops?bbox= (the real 128 pins filtered to the box), /api/v1/stops/:id for the
 * captured stops and /api/v1/routes/:code for the captured routes; anything else is a 404.
 */
export async function routeNetwork(page: Page): Promise<NetworkCalls> {
  const calls: NetworkCalls = { bboxes: [], stops: [], routes: [] };
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
  await page.route(/\/api\/v1\/routes\/[^/?]+/, async (route) => {
    const code = decodeURIComponent(/\/api\/v1\/routes\/([^/?]+)/.exec(new URL(route.request().url()).pathname)![1]!).toUpperCase();
    calls.routes.push(code);
    const body = ROUTES.get(code);
    return body ? json(route, body) : notFound(route);
  });
  return calls;
}
