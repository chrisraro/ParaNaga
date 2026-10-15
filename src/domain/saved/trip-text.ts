// A saved trip as plain text steps, for the /offline page (Task 12), where the map cannot load.
// Pure. Same honesty as guidance: straight-line walk estimates ("path not verified"), pin order
// only, no times, the driver badge on every ride, fares as reported-rule estimates.
import { guidanceSteps } from "../guidance/steps";
import { UNVERIFIED_ROUTE_BADGE } from "../planner/labels";
import { directionText, formatDistance } from "../trip/present";
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
      case "ride": {
        const direction = directionText(step.ride.loopDirection, "short");
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
