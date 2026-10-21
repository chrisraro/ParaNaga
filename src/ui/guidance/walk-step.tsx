"use client";

// Walk step (artboard Walk): to the first boarding stop, or from the last stop to the destination.
// The artboard's "[m] to Plaza Rizal stop", boarding side "toward Centro, beside [landmark]" and
// the landmark check are replaced by the view's honest copy: a straight-line distance (GPS) or the
// plan's estimate ("path not verified"), "Boarding side isn't mapped…", and "You look close to …"
// only as a proposal; the person confirms with "I'm at the stop" / "I've arrived" (shown only once a
// fix was within 100 m of the destination: view.ts).

import { UnverifiedBadge } from "@/ui/trip/trip-parts";
import type { WalkView } from "@/domain/guidance/view";
import { useT } from "@/i18n/provider";
import { GuidanceButtons, GuidanceNotes, LocationOffer, UndoButton, type StepProps } from "./guidance-parts";

export function WalkDistance({ view }: { view: WalkView }) {
  const proposal = view.proposal;
  return (
    <>
      {view.remainingTime ? (
        <p className="pn-guide__time" data-testid="guidance-time">
          {view.remainingTime}
        </p>
      ) : null}
      {view.distanceText ? (
        <p className="pn-guide__distance" data-testid="guidance-distance">
          {view.distanceText}
          {view.directionText ? <span className="pn-guide__direction">, {view.directionText}</span> : null}
        </p>
      ) : null}
      {view.locationNote ? (
        <p className="pn-guide__card pn-guide__card--warn" data-testid="guidance-location-note">
          {view.locationNote}
        </p>
      ) : null}
      {proposal ? (
        <p className="pn-guide__card pn-guide__card--near" data-testid="guidance-proposal">
          {proposal}
        </p>
      ) : null}
    </>
  );
}

/** The one caution on a step that leads to a ride: the full badge (the route is named in the title and the note). */
export function NextRide() {
  return <UnverifiedBadge />;
}

export function WalkStep({ view, onSend, location, headingRef }: StepProps<WalkView>) {
  const g = useT().guidance;
  const manual = view.stepKind === "walk_to_destination" ? undefined : g.atStop;
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-walk">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <WalkDistance view={view} />
      <LocationOffer location={location} manual={manual} />
      <GuidanceNotes notes={view.notes} />
      {view.nextRide ? <NextRide /> : null}
      <GuidanceButtons actions={view.actions} onSend={onSend} />
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
