"use client";

// Explore's directory of what is on file, for now the 11 routes of the approved plan from
// GET /api/v1/routes (decision D5: the OpenStreetMap places and the rest of the directory arrive
// with the search index). Each route opens its detail panel.

import { useNetworkResource } from "@/client/network/use-network-resource";
import { routeListSchema, type RouteSummary } from "@/domain/api/schemas";
import { routeChipLabel } from "@/domain/trip/present";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";

function RouteIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
    </svg>
  );
}

/** "R3 · Documented only", "R8-A · Loop A · Provisional stops · Trial circuit on file". */
export function routeSub(route: RouteSummary): string {
  const chip = routeChipLabel(route.code, route.name);
  return [
    route.code,
    chip === route.code ? null : chip,
    route.hasProvisionalStops ? "Provisional stops" : "Documented only",
    route.hasTrial ? "Trial circuit on file" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RouteDirectory() {
  const resource = useNetworkResource("/api/v1/routes", routeListSchema);

  if (resource.status === "loading") {
    return (
      <div className="pn-detail__stack" role="status" aria-label="Loading routes" data-testid="explore-loading">
        <div className="pn-skeleton" style={{ width: "40%" }} />
        <div className="pn-skeleton" style={{ height: 180 }} />
      </div>
    );
  }
  if (resource.status !== "ready") {
    const offline = resource.status === "error" && resource.offline;
    return (
      <div className="pn-detail__stack" data-testid="explore-error">
        <p role="alert" className="pn-footnote">
          {offline ? "You are offline. Check your connection, then try again." : "Could not load the routes. Try again."}
        </p>
        <button type="button" className="pn-detail__retry" onClick={resource.retry}>
          Try again
        </button>
      </div>
    );
  }

  const routes = resource.data.groups.flatMap((g) => g.routes);
  return (
    <>
      <ListGroup title={`Routes · ${routes.length}`} testId="explore-routes">
        {routes.map((r) => (
          <ListCell key={r.code} href={`/app/routes/${encodeURIComponent(r.code)}`} icon={<RouteIcon />} title={r.name} sub={routeSub(r)} />
        ))}
      </ListGroup>
      <Note>Street order from the approved route plan. Route shapes and stops are not yet surveyed.</Note>
    </>
  );
}
