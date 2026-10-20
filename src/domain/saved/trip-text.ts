// A saved trip as plain text steps, for the /offline page (Task 12), where the map cannot load.
// Pure. Same honesty as guidance: straight-line walk estimates ("path not verified"), pin order
// only (a pinless ride reads "along the approximate path"), no times, the driver badge on every ride,
// fares as reported-rule estimates; a tricycle or padyak leg is its one guidance step line.
import { guidanceSteps } from "../guidance/steps";
import { UNVERIFIED_ROUTE_BADGE } from "../planner/labels";
import { directionText, formatDistance, freeAlightText } from "../trip/present";
import type { SavedTrip } from "./saved";

const walk = (meters: number) => `Walk ${formatDistance(meters)}`;

export function savedTripSteps(trip: SavedTrip): string[] {
  const steps = guidanceSteps({
    option: trip.option,
    stops: trip.stops,
    variants: trip.variants.map((v) => ({ variantId: v.variantId, loopDirection: v.loopDirection ?? null })),
    destinationLabel: trip.destination.label,
  });
  return steps.map((step) => {
    switch (step.kind) {
      case "walk_to_board":
        return step.negligible
          ? `Start at ${step.target.label}.`
          : `${walk(step.estimateMeters)} to ${step.target.label} (path not verified).`;
      case "street_ride":
        return `${step.text}.`;
      case "ride": {
        if (!step.pinned) {
          return `Ride ${step.ride.routeChip} along the approximate path from ${step.board.label}. ${freeAlightText(step.alight.label)}. ${UNVERIFIED_ROUTE_BADGE}.`;
        }
        const direction = directionText(step.ride.loopDirection, "short", step.ride.routeChip);
        const stops = step.stopsToRide === 1 ? "1 stop" : `${step.stopsToRide} stops`;
        return `Ride ${step.ride.routeChip}${direction ? `, ${direction}` : ""}, from ${step.board.label} to ${step.alight.label}: ${stops} by pin order. ${UNVERIFIED_ROUTE_BADGE}.`;
      }
      case "transfer":
        return step.negligible
          ? `Transfer at ${step.target.label}.`
          : `${walk(step.estimateMeters)} to ${step.target.label} to transfer (path not verified).`;
      case "walk_to_destination":
        return step.negligible ? `Arrive at ${step.target.name}.` : `${walk(step.estimateMeters)} to ${step.target.name} (path not verified).`;
    }
  });
}
