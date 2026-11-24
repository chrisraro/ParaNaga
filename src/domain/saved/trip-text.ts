// A saved trip as plain text steps, for the /offline page (Task 12), where the map cannot load.
// Pure. Same honesty as guidance: straight-line walk estimates ("path not verified"), pin order
// only (a pinless ride reads "along the approximate path"), no times, the driver badge on every ride,
// fares as reported-rule estimates; a tricycle or padyak leg is its one guidance step line.
// In the UI language (`copy`, English by default): the phone may be offline with a Filipino reader.
import { guidanceSteps } from "../guidance/steps";
import { directionText, formatDistance, freeAlightText } from "../trip/present";
import { en, type Dict } from "@/i18n/dict";
import type { SavedTrip } from "./saved";

export function savedTripSteps(trip: SavedTrip, copy: Dict = en): string[] {
  const p = copy.pwa;
  const badge = copy.trip.unverifiedBadge;
  const steps = guidanceSteps(
    {
      option: trip.option,
      stops: trip.stops,
      variants: trip.variants.map((v) => ({ variantId: v.variantId, loopDirection: v.loopDirection ?? null })),
      destinationLabel: trip.destination.label,
    },
    copy.guidance,
    copy,
  );
  const distance = (meters: number) => formatDistance(meters, copy.geo);
  return steps.map((step) => {
    switch (step.kind) {
      case "walk_to_board":
        return step.negligible ? p.stepStartAt(step.target.label) : p.stepWalkTo(distance(step.estimateMeters), step.target.label);
      case "street_ride":
        return `${step.text}.`;
      case "ride": {
        if (!step.pinned) {
          return p.stepRideFree(step.ride.routeChip, step.board.label, freeAlightText(step.alight.label, copy.trip), badge);
        }
        const direction = directionText(step.ride.loopDirection, "short", step.ride.routeChip, copy.trip);
        return p.stepRidePinned(step.ride.routeChip, direction, step.board.label, step.alight.label, copy.guidance.stopsCount(step.stopsToRide), badge);
      }
      case "transfer":
        return step.negligible ? p.stepTransferAt(step.target.label) : p.stepTransferWalk(distance(step.estimateMeters), step.target.label);
      case "walk_to_destination":
        return step.negligible ? p.stepArriveAt(step.target.name) : p.stepArriveWalk(distance(step.estimateMeters), step.target.name);
    }
  });
}
