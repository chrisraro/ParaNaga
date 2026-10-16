// Ride notes (plan E §A, §E). Pure. A reviewed route note with `near` applies when the board or
// alight point, or the destination, lies within its radius; a note without `near` always applies
// to the ride (route and ride detail). A flagged Lines path adds FLAGGED_PATH_NOTE. Order: near
// notes, then general notes, then the flagged-path note (the card shows the first line only).
import type { RouteNote } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";

export const FLAGGED_PATH_NOTE =
  "Part of this approximate path disagrees with the street map (one-way or off the street list); the jeepney's real street may differ.";

export function rideNotes(notes: readonly RouteNote[], points: readonly LatLng[], flagged: boolean): string[] {
  const near = notes.filter((n) => n.near && points.some((p) => haversineMeters(p, n.near!) <= n.near!.radiusM));
  const general = notes.filter((n) => !n.near);
  return [...near, ...general].map((n) => n.text).concat(flagged ? [FLAGGED_PATH_NOTE] : []);
}
